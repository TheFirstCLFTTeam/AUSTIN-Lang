"""Zoom provider.

What's implemented:
- `verify_webhook` — Zoom URL-validation handshake + HMAC-SHA256 signature
  check + 5-min replay window.
- `start_connect` — returns Marketplace S2S OAuth install instructions; in
  mock mode (no client_id), creates a `connected_mock` connection so the
  frontend can demo the flow.
- `extract_recording_events` — walks `payload.object.recording_files[]`,
  filters to `file_type == "M4A"` (audio-only), emits one RecordingEvent
  per asset with `download_url` + `download_token` stashed in fetch_context.
- `download_recording` — streams the download_url with Bearer
  `download_token` (preferred per spec §2.5); falls back to the
  Server-to-Server OAuth access_token if the per-event token is absent
  or expired.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any, AsyncIterator, Optional

import httpx
from fastapi import Request

from ..config import settings
from .base import (
    BaseProvider,
    ConnectInitResponse,
    RecordingEvent,
    WebhookVerification,
    register_provider,
)


@register_provider
class ZoomProvider(BaseProvider):
    id = "zoom"
    display_name = "Zoom"
    # Zoom S2S OAuth is admin-installed via the Marketplace, not a per-user
    # browser redirect. Frontend should render the instructions string.
    supports_oauth_redirect = False

    async def start_connect(
        self, *, user_id: str, redirect_uri: str,
    ) -> ConnectInitResponse:
        if settings.allow_mock_connect and not settings.zoom_client_id:
            from ..db import upsert_connection
            upsert_connection(
                user_id=user_id, provider=self.id, status="connected_mock",
                external_account=settings.zoom_account_id or "mock-zoom-account",
                credentials={"mock": True},
            )
            return ConnectInitResponse(
                instructions=(
                    "Mock-mode Zoom connection created. To enable real "
                    "ingestion: create a Server-to-Server OAuth app in the "
                    "Zoom Marketplace, set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, "
                    "ZOOM_CLIENT_SECRET, ZOOM_WEBHOOK_SECRET_TOKEN in "
                    "backend/.env, and point the app's recording.completed "
                    "event subscription at this service's /webhooks/zoom URL."
                ),
            )
        return ConnectInitResponse(
            instructions=(
                "Zoom uses an admin-installed Server-to-Server OAuth app. "
                "Follow docs/07 Integration CAA 27APR2026/meeting_recording_webhooks.md "
                "§2 to install it, then the connection will appear here."
            ),
        )

    async def complete_connect(
        self, *, user_id: str, params: dict[str, Any],
    ) -> dict[str, Any]:
        # Zoom S2S OAuth doesn't have a user-facing callback — admin install
        # completes out-of-band. This entrypoint is currently only used by
        # the mock-mode flow, which start_connect already finalized.
        from ..db import get_connection
        row = get_connection(user_id=user_id, provider=self.id)
        if not row:
            raise NotImplementedError(
                "Zoom S2S OAuth install must be completed in the Zoom "
                "Marketplace; per-user OAuth callback is not used."
            )
        return {
            "id": row["id"], "provider": self.id, "status": row["status"],
            "external_account": row["external_account"],
        }

    async def verify_webhook(self, request: Request) -> WebhookVerification:
        body = await request.body()
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError as exc:
            return WebhookVerification(ok=False, response_status=400, error=str(exc))

        secret = settings.zoom_webhook_secret_token

        # 1) URL-validation handshake
        if payload.get("event") == "endpoint.url_validation":
            plain_token = (payload.get("payload") or {}).get("plainToken", "")
            if not secret:
                return WebhookVerification(
                    ok=False, response_status=503,
                    error="ZOOM_WEBHOOK_SECRET_TOKEN not configured",
                )
            digest = hmac.new(
                secret.encode("utf-8"), plain_token.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            return WebhookVerification(
                ok=True,
                response_body=json.dumps({
                    "plainToken": plain_token, "encryptedToken": digest,
                }).encode("utf-8"),
                response_content_type="application/json",
            )

        # 2) Per-event signature
        if not secret:
            return WebhookVerification(
                ok=False, response_status=503,
                error="ZOOM_WEBHOOK_SECRET_TOKEN not configured",
            )
        ts = request.headers.get("x-zm-request-timestamp", "")
        sig = request.headers.get("x-zm-signature", "")
        if not ts or not sig:
            return WebhookVerification(
                ok=False, response_status=401, error="missing zoom signature headers",
            )
        try:
            if abs(time.time() - int(ts)) > 5 * 60:
                return WebhookVerification(
                    ok=False, response_status=401, error="signature timestamp too old",
                )
        except ValueError:
            return WebhookVerification(
                ok=False, response_status=401, error="malformed timestamp",
            )

        # rawBody must be byte-exact — that's why we read request.body() above.
        message = b"v0:" + ts.encode("utf-8") + b":" + body
        expected = "v0=" + hmac.new(
            secret.encode("utf-8"), message, hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return WebhookVerification(
                ok=False, response_status=401, error="signature mismatch",
            )
        return WebhookVerification(ok=True, payload=payload)

    async def extract_recording_events(
        self, payload: dict[str, Any],
    ) -> list[RecordingEvent]:
        # Only act on the recording.completed event type — there are sibling
        # events (recording.transcript_completed, phone.recording_completed)
        # that share the meeting webhooks slot. Spec §2.1.
        if payload.get("event") != "recording.completed":
            return []

        envelope = payload.get("payload") or {}
        obj = envelope.get("object") or {}
        download_token = payload.get("download_token")
        meeting_uuid = obj.get("uuid")
        host_id = obj.get("host_id")
        host_email = obj.get("host_email")
        topic = obj.get("topic")
        start_time = obj.get("start_time")

        events: list[RecordingEvent] = []
        for f in obj.get("recording_files") or []:
            # Only audio-only assets — we don't transcribe MP4 video here,
            # and skipping TRANSCRIPT/CC avoids loops with our own pipeline.
            if (f.get("file_type") or "").upper() != "M4A":
                continue
            if (f.get("status") or "").lower() != "completed":
                continue
            recording_id = f.get("id")
            if not recording_id:
                continue

            events.append(RecordingEvent(
                external_recording_id=str(recording_id),
                external_meeting_id=str(meeting_uuid) if meeting_uuid else None,
                organiser_external_id=str(host_id) if host_id else None,
                organiser_email=host_email,
                topic=topic,
                started_at=f.get("recording_start") or start_time,
                ended_at=f.get("recording_end"),
                file_extension="m4a",
                fetch_context={
                    "download_url": f.get("download_url"),
                    "download_token": download_token,
                    # Stash account_id so the worker can fall back to S2S
                    # OAuth if the per-event download_token has expired
                    # (24 h TTL — possible if our queue backed up).
                    "account_id": envelope.get("account_id"),
                },
            ))
        return events

    async def download_recording(
        self, *, connection_credentials: dict[str, Any], event: RecordingEvent,
    ) -> AsyncIterator[bytes]:
        ctx = event.fetch_context or {}
        url = ctx.get("download_url")
        if not url:
            raise RuntimeError("zoom event has no download_url")

        token = ctx.get("download_token")
        # Preferred: per-event Bearer token (spec §2.5). Fallback: mint a
        # fresh S2S OAuth access_token. Either way we set Authorization;
        # passing it as a query string also works but is less hygienic.
        if not token:
            token = await self._mint_s2s_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "audio/m4a, application/octet-stream",
        }

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "GET", url,
                headers=headers, follow_redirects=True,
            ) as r:
                # If the download_token expired in transit, mint a fresh
                # S2S token and retry once. Anything else propagates.
                if r.status_code == 401 and ctx.get("download_token"):
                    s2s = await self._mint_s2s_token()
                    headers["Authorization"] = f"Bearer {s2s}"
                    async with client.stream(
                        "GET", url, headers=headers, follow_redirects=True,
                    ) as r2:
                        r2.raise_for_status()
                        async for chunk in r2.aiter_bytes(chunk_size=64 * 1024):
                            yield chunk
                    return
                r.raise_for_status()
                async for chunk in r.aiter_bytes(chunk_size=64 * 1024):
                    yield chunk

    # ── helpers ─────────────────────────────────────────────────────────

    async def _mint_s2s_token(self) -> str:
        """Server-to-Server OAuth access_token. Required scope:
        cloud_recording:read:list_user_recordings:admin (or the legacy
        recording:read:admin). ~1 h TTL — we don't cache here because
        downloads are rare; cache if call rate climbs."""
        if not (
            settings.zoom_account_id
            and settings.zoom_client_id
            and settings.zoom_client_secret
        ):
            raise RuntimeError("zoom S2S OAuth credentials not configured")
        basic = base64.b64encode(
            f"{settings.zoom_client_id}:{settings.zoom_client_secret}".encode("utf-8")
        ).decode("ascii")
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                "https://zoom.us/oauth/token",
                params={
                    "grant_type": "account_credentials",
                    "account_id": settings.zoom_account_id,
                },
                headers={"Authorization": f"Basic {basic}"},
            )
        if r.status_code >= 400:
            raise RuntimeError(f"zoom S2S token failed: {r.status_code} {r.text[:300]}")
        return r.json()["access_token"]
