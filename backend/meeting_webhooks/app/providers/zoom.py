"""Zoom provider — stub.

The shape of every method matches Teams so the registry is genuinely
extensible: when someone wires Zoom up properly they fill these in without
touching the routes layer or the worker. Methods that aren't safe to ship
unimplemented raise NotImplementedError; the routes layer maps that to a
501 Not Implemented response.

What's implemented:
- `verify_webhook` does the full Zoom URL-validation handshake and HMAC
  signature check (so an admin can already point Zoom at /webhooks/zoom and
  see it pass validation).
- `start_connect` returns instructions for the Zoom Marketplace S2S OAuth
  install.

What's TODO:
- `complete_connect`: persist client_id/client_secret/account_id + scopes.
- `extract_recording_events`: walk payload.object.recording_files[] and emit
  one RecordingEvent per M4A asset.
- `download_recording`: stream `download_url` with Bearer download_token.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any, AsyncIterator

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
        # TODO: wire when Zoom is enabled. The payload shape is documented in
        # docs/07 Integration CAA 27APR2026/meeting_recording_webhooks.md §2.2.
        # Filter recording_files[] by file_type == "M4A", emit one event each,
        # stash download_token from the envelope into fetch_context.
        return []

    async def download_recording(
        self, *, connection_credentials: dict[str, Any], event: RecordingEvent,
    ) -> AsyncIterator[bytes]:
        raise NotImplementedError("Zoom download not implemented yet")
        yield b""  # pragma: no cover  (makes the function an async generator)
