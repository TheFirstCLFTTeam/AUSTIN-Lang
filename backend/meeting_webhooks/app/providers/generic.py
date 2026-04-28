"""Generic HMAC-signed webhook provider.

Use this when a platform we want to ingest from is willing to POST a JSON
body to a URL, but doesn't fit the Zoom / Teams / Google Meet shape (Slack
Huddles via a custom bot, Discord recording bots like Craig, an internal
recording service, a Lambda forwarding S3 events, anything where you
control both ends).

Contract:
  POST /webhooks/generic
  Headers:
    X-Austin-Signature: hex(HMAC-SHA256(secret, raw_body))
    X-Austin-Timestamp: unix-seconds
  Body (JSON):
    {
      "recording_id":   "abc-123",                  // required, unique per recording
      "audio_url":      "https://…/file.mp3",       // required, GET-able by us
      "audio_url_auth": { "header": "Authorization",
                          "value":  "Bearer xyz" }, // optional, attached on download
      "meeting_id":     "room-7",                   // optional
      "organiser_email":"alice@example.com",        // optional, mapped to internal user
      "topic":          "Customer call",            // optional
      "started_at":     "2026-04-28T10:00:00Z",     // optional
      "file_extension": "mp3"                        // optional, defaults to extension of audio_url
    }

The signature uses the same `v0:{timestamp}:{rawBody}` canonical form as
Zoom — easy to reason about, hard to forge, and lets the upstream client
reuse Zoom-style signing code if they have it.

Set `GENERIC_WEBHOOK_SECRET` to enable. When unset the provider stays in
the registry but rejects every request with 503 so an accidentally-public
endpoint can't be misused.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from typing import Any, AsyncIterator, Optional
from urllib.parse import urlparse

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


def _generic_secret() -> str:
    return os.getenv("GENERIC_WEBHOOK_SECRET", "")


@register_provider
class GenericProvider(BaseProvider):
    id = "generic"
    display_name = "Generic webhook"
    # No OAuth — the upstream client signs requests with a shared secret.
    supports_oauth_redirect = False

    async def start_connect(
        self, *, user_id: str, redirect_uri: str,
    ) -> ConnectInitResponse:
        if settings.allow_mock_connect and not _generic_secret():
            from ..db import upsert_connection
            upsert_connection(
                user_id=user_id, provider=self.id, status="connected_mock",
                external_account="mock-generic",
                credentials={"mock": True},
            )
            return ConnectInitResponse(
                instructions=(
                    "Mock-mode generic webhook connection created. To enable "
                    "real ingestion: set GENERIC_WEBHOOK_SECRET in backend/.env "
                    "and configure your upstream platform to POST to "
                    f"{settings.public_base_url}/webhooks/generic with the "
                    "X-Austin-Signature / X-Austin-Timestamp headers documented "
                    "in providers/generic.py."
                ),
            )
        return ConnectInitResponse(
            instructions=(
                "Configure your upstream service to POST recording-finished "
                f"events to {settings.public_base_url}/webhooks/generic, "
                "signing each request with HMAC-SHA256 of "
                "`v0:{unix-ts}:{raw-body}` keyed by GENERIC_WEBHOOK_SECRET. "
                "Body shape is documented in app/providers/generic.py."
            ),
        )

    async def complete_connect(
        self, *, user_id: str, params: dict[str, Any],
    ) -> dict[str, Any]:
        from ..db import get_connection
        row = get_connection(user_id=user_id, provider=self.id)
        if not row:
            raise NotImplementedError(
                "Generic webhook does not have a per-user OAuth callback. "
                "Connect via /connect/generic to register the user → secret "
                "mapping, then point the upstream service at the webhook URL."
            )
        return {
            "id": row["id"], "provider": self.id, "status": row["status"],
            "external_account": row["external_account"],
        }

    async def verify_webhook(self, request: Request) -> WebhookVerification:
        secret = _generic_secret()
        if not secret:
            return WebhookVerification(
                ok=False, response_status=503,
                error="GENERIC_WEBHOOK_SECRET not configured",
            )

        ts = request.headers.get("x-austin-timestamp", "")
        sig = request.headers.get("x-austin-signature", "")
        if not ts or not sig:
            return WebhookVerification(
                ok=False, response_status=401,
                error="missing X-Austin-Signature / X-Austin-Timestamp",
            )
        try:
            if abs(time.time() - int(ts)) > 5 * 60:
                return WebhookVerification(
                    ok=False, response_status=401,
                    error="timestamp outside ±5 minute window",
                )
        except ValueError:
            return WebhookVerification(
                ok=False, response_status=401, error="malformed timestamp",
            )

        body = await request.body()
        message = b"v0:" + ts.encode("utf-8") + b":" + body
        expected = hmac.new(
            secret.encode("utf-8"), message, hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return WebhookVerification(
                ok=False, response_status=401, error="signature mismatch",
            )

        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError as exc:
            return WebhookVerification(ok=False, response_status=400, error=str(exc))
        return WebhookVerification(ok=True, payload=payload)

    async def extract_recording_events(
        self, payload: dict[str, Any],
    ) -> list[RecordingEvent]:
        recording_id = payload.get("recording_id")
        audio_url = payload.get("audio_url")
        if not recording_id or not audio_url:
            return []

        ext = payload.get("file_extension") or _ext_from_url(audio_url) or "mp3"
        return [RecordingEvent(
            external_recording_id=str(recording_id),
            external_meeting_id=payload.get("meeting_id"),
            organiser_email=payload.get("organiser_email"),
            topic=payload.get("topic"),
            started_at=payload.get("started_at"),
            ended_at=payload.get("ended_at"),
            file_extension=ext,
            fetch_context={
                "audio_url": audio_url,
                "audio_url_auth": payload.get("audio_url_auth"),
            },
        )]

    async def download_recording(
        self, *, connection_credentials: dict[str, Any], event: RecordingEvent,
    ) -> AsyncIterator[bytes]:
        url = (event.fetch_context or {}).get("audio_url")
        if not url:
            raise RuntimeError("generic event has no audio_url")

        headers: dict[str, str] = {"Accept": "*/*"}
        auth = (event.fetch_context or {}).get("audio_url_auth")
        if isinstance(auth, dict) and auth.get("header") and auth.get("value"):
            headers[str(auth["header"])] = str(auth["value"])

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "GET", url, headers=headers, follow_redirects=True,
            ) as r:
                r.raise_for_status()
                async for chunk in r.aiter_bytes(chunk_size=64 * 1024):
                    yield chunk


def _ext_from_url(url: str) -> Optional[str]:
    try:
        path = urlparse(url).path
    except Exception:
        return None
    if "." not in path:
        return None
    return path.rsplit(".", 1)[-1].lower() or None
