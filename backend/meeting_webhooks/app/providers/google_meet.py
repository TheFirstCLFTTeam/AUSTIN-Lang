"""Google Meet provider — stub demonstrating the factory pattern.

Adding a third real provider takes one file and one line in __init__.py:

    # providers/__init__.py
    from . import google_meet  # noqa: F401

The class below shows every method a provider must implement, with the
real Google API endpoints documented inline. Methods that are unsafe to
ship empty raise NotImplementedError; the routes layer maps that to a
501 response, so the rest of the service (registry, dedupe, transcription
hand-off, frontend integrations page) keeps working while this provider
is half-done.

API references:
- Drive Activity API for "recording added" events:
  https://developers.google.com/drive/activity/v2
- Drive API v3 for media download (recordings live in a 'Meet Recordings'
  folder on the organiser's Drive): https://developers.google.com/drive/api/v3/manage-downloads
- Push notifications (the webhook surface):
  https://developers.google.com/drive/api/guides/push
"""
from __future__ import annotations

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
class GoogleMeetProvider(BaseProvider):
    id = "google_meet"
    display_name = "Google Meet"
    supports_oauth_redirect = True

    async def start_connect(
        self, *, user_id: str, redirect_uri: str,
    ) -> ConnectInitResponse:
        if settings.allow_mock_connect:
            from ..db import upsert_connection
            upsert_connection(
                user_id=user_id, provider=self.id, status="connected_mock",
                external_account="mock-google-workspace",
                credentials={"mock": True},
            )
            return ConnectInitResponse(
                instructions=(
                    "Mock-mode Google Meet connection created. Real ingestion "
                    "requires a Google Workspace OAuth app with the "
                    "drive.metadata.readonly + drive.readonly scopes, plus a "
                    "Drive API push channel pointed at "
                    f"{settings.public_base_url}/webhooks/google_meet."
                ),
            )
        # Real flow: redirect the admin to Google's OAuth consent screen for
        # an app-level (delegated) credential. After consent we'd POST to
        # https://www.googleapis.com/drive/v3/files/watch to set up a push
        # channel on the 'Meet Recordings' folder.
        raise NotImplementedError(
            "Google Meet OAuth not implemented yet — see TODO at top of file."
        )

    async def complete_connect(
        self, *, user_id: str, params: dict[str, Any],
    ) -> dict[str, Any]:
        # TODO: exchange OAuth code → refresh_token, create the Drive push
        # channel, persist channel_id + resource_id so we can call
        # drive.channels.stop on disconnect.
        from ..db import get_connection
        row = get_connection(user_id=user_id, provider=self.id)
        if row:
            return {
                "id": row["id"], "provider": self.id, "status": row["status"],
                "external_account": row["external_account"],
            }
        raise NotImplementedError("Google Meet OAuth callback not implemented yet.")

    async def verify_webhook(self, request: Request) -> WebhookVerification:
        # Drive push notifications carry a `X-Goog-Channel-Token` header that
        # must equal the token we set when calling /watch. The body is empty
        # — the actual change has to be fetched via the Drive Activity API.
        # TODO: validate X-Goog-Channel-Token, then fetch the activity.
        raise NotImplementedError("Google Meet webhook verification not implemented yet.")

    async def extract_recording_events(
        self, payload: dict[str, Any],
    ) -> list[RecordingEvent]:
        # TODO: query driveactivity.activity.query for the file id mentioned
        # in the push notification, then look up the file's
        # webContentLink + size + name via drive.files.get, and emit a
        # RecordingEvent with the file id as external_recording_id.
        return []

    async def download_recording(
        self, *, connection_credentials: dict[str, Any], event: RecordingEvent,
    ) -> AsyncIterator[bytes]:
        # TODO: GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
        #       Authorization: Bearer {access_token}
        # 302-redirects to a CDN — follow_redirects=True; stream chunks.
        raise NotImplementedError("Google Meet download not implemented yet.")
        yield b""  # pragma: no cover  (makes the function an async generator)
