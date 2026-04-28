"""Provider registry + Zoom + generic provider contract tests.

Run from backend/meeting_webhooks/:
    python -m unittest discover -s tests

Uses stdlib only so no extra deps. Tests live next to the service so the
imports stay relative.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import unittest
from unittest.mock import AsyncMock

# Configure env BEFORE any app imports so settings.* sees test values.
os.environ.setdefault("DB_PATH", ":memory:")  # not used by these tests
os.environ.setdefault("ZOOM_WEBHOOK_SECRET_TOKEN", "zoom-test-secret")
os.environ.setdefault("GENERIC_WEBHOOK_SECRET", "generic-test-secret")
os.environ.setdefault("ALLOW_MOCK_CONNECT", "true")

# Force config + provider modules to re-read env. Importing the package
# eagerly registers all providers via providers/__init__.py.
import importlib  # noqa: E402
from app import config as _config_module  # noqa: E402
importlib.reload(_config_module)
from app import providers as _providers  # noqa: E402, F401
from app.providers.base import (  # noqa: E402
    BaseProvider,
    RecordingEvent,
    get_provider,
    list_providers,
    register_provider,
)


# ── Provider registry ──────────────────────────────────────────────────────

class RegistryTests(unittest.TestCase):
    def test_known_providers_registered(self):
        ids = {p.id for p in list_providers()}
        self.assertIn("teams", ids)
        self.assertIn("zoom", ids)
        self.assertIn("google_meet", ids)
        self.assertIn("generic", ids)

    def test_unknown_provider_raises(self):
        with self.assertRaises(KeyError):
            get_provider("nonexistent")

    def test_register_provider_rejects_duplicate_id(self):
        with self.assertRaises(RuntimeError):
            @register_provider
            class DuplicateZoom(BaseProvider):
                id = "zoom"
                display_name = "Zoom (dupe)"
                async def start_connect(self, *, user_id, redirect_uri):
                    raise NotImplementedError
                async def complete_connect(self, *, user_id, params):
                    raise NotImplementedError
                async def verify_webhook(self, request):
                    raise NotImplementedError
                async def extract_recording_events(self, payload):
                    return []
                async def download_recording(self, *, connection_credentials, event):
                    raise NotImplementedError
                    yield b""  # pragma: no cover


# ── Zoom — handshake + signature + event extraction ────────────────────────

def _fake_request(*, body: bytes, headers: dict[str, str], query: dict[str, str] | None = None):
    """Bare-minimum stand-in for fastapi.Request used by verify_webhook."""
    class _FakeReq:
        def __init__(self):
            self.headers = headers
            self.query_params = query or {}
        async def body(self):
            return body
    return _FakeReq()


class ZoomTests(unittest.IsolatedAsyncioTestCase):
    async def test_url_validation_handshake(self):
        zoom = get_provider("zoom")
        body = json.dumps({
            "event": "endpoint.url_validation",
            "payload": {"plainToken": "abc-123"},
        }).encode("utf-8")
        verification = await zoom.verify_webhook(
            _fake_request(body=body, headers={}),
        )
        self.assertTrue(verification.ok)
        self.assertIsNotNone(verification.response_body)
        out = json.loads(verification.response_body)
        self.assertEqual(out["plainToken"], "abc-123")
        expected = hmac.new(
            b"zoom-test-secret", b"abc-123", hashlib.sha256,
        ).hexdigest()
        self.assertEqual(out["encryptedToken"], expected)

    async def test_signed_event_succeeds(self):
        zoom = get_provider("zoom")
        body = json.dumps({"event": "recording.completed", "payload": {}}).encode("utf-8")
        ts = str(int(time.time()))
        message = b"v0:" + ts.encode() + b":" + body
        sig = "v0=" + hmac.new(
            b"zoom-test-secret", message, hashlib.sha256,
        ).hexdigest()
        verification = await zoom.verify_webhook(_fake_request(
            body=body,
            headers={
                "x-zm-request-timestamp": ts,
                "x-zm-signature": sig,
            },
        ))
        self.assertTrue(verification.ok, verification.error)
        self.assertEqual(verification.payload["event"], "recording.completed")

    async def test_replay_window_rejected(self):
        zoom = get_provider("zoom")
        body = b'{"event":"recording.completed","payload":{}}'
        old_ts = str(int(time.time()) - 10 * 60)  # 10 min old
        message = b"v0:" + old_ts.encode() + b":" + body
        sig = "v0=" + hmac.new(
            b"zoom-test-secret", message, hashlib.sha256,
        ).hexdigest()
        v = await zoom.verify_webhook(_fake_request(
            body=body,
            headers={"x-zm-request-timestamp": old_ts, "x-zm-signature": sig},
        ))
        self.assertFalse(v.ok)
        self.assertEqual(v.response_status, 401)

    async def test_signature_mismatch_rejected(self):
        zoom = get_provider("zoom")
        body = b'{"event":"recording.completed","payload":{}}'
        ts = str(int(time.time()))
        v = await zoom.verify_webhook(_fake_request(
            body=body,
            headers={"x-zm-request-timestamp": ts, "x-zm-signature": "v0=deadbeef"},
        ))
        self.assertFalse(v.ok)

    async def test_extract_recording_events_filters_to_m4a(self):
        zoom = get_provider("zoom")
        payload = {
            "event": "recording.completed",
            "download_token": "tok-xyz",
            "payload": {
                "account_id": "acct-1",
                "object": {
                    "uuid": "abc/XYZdef==",
                    "host_id": "u_abcdef",
                    "host_email": "alice@example.com",
                    "topic": "Customer call",
                    "start_time": "2026-04-27T02:00:00Z",
                    "recording_files": [
                        {"id": "file-1", "file_type": "M4A", "status": "completed",
                         "download_url": "https://zoom.us/rec/download/audio",
                         "recording_start": "2026-04-27T02:00:11Z",
                         "recording_end":   "2026-04-27T02:47:03Z"},
                        {"id": "file-2", "file_type": "MP4", "status": "completed",
                         "download_url": "https://zoom.us/rec/download/video"},
                        {"id": "file-3", "file_type": "TRANSCRIPT", "status": "completed",
                         "download_url": "https://zoom.us/rec/download/vtt"},
                        {"id": "file-4", "file_type": "M4A", "status": "processing",
                         "download_url": "https://zoom.us/rec/download/incomplete"},
                    ],
                },
            },
        }
        events = await zoom.extract_recording_events(payload)
        self.assertEqual(len(events), 1)
        e = events[0]
        self.assertEqual(e.external_recording_id, "file-1")
        self.assertEqual(e.external_meeting_id, "abc/XYZdef==")
        self.assertEqual(e.organiser_external_id, "u_abcdef")
        self.assertEqual(e.organiser_email, "alice@example.com")
        self.assertEqual(e.fetch_context["download_url"], "https://zoom.us/rec/download/audio")
        self.assertEqual(e.fetch_context["download_token"], "tok-xyz")
        self.assertEqual(e.fetch_context["account_id"], "acct-1")
        self.assertEqual(e.file_extension, "m4a")

    async def test_extract_recording_events_skips_non_recording_event(self):
        zoom = get_provider("zoom")
        events = await zoom.extract_recording_events({"event": "meeting.ended", "payload": {}})
        self.assertEqual(events, [])


# ── Generic provider ───────────────────────────────────────────────────────

class GenericProviderTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _signed_request(body_dict: dict) -> tuple[bytes, dict[str, str]]:
        body = json.dumps(body_dict).encode("utf-8")
        ts = str(int(time.time()))
        message = b"v0:" + ts.encode() + b":" + body
        sig = hmac.new(
            b"generic-test-secret", message, hashlib.sha256,
        ).hexdigest()
        return body, {"x-austin-timestamp": ts, "x-austin-signature": sig}

    async def test_signed_request_passes(self):
        generic = get_provider("generic")
        body, headers = self._signed_request({
            "recording_id": "abc",
            "audio_url": "https://example.com/a.mp3",
        })
        v = await generic.verify_webhook(_fake_request(body=body, headers=headers))
        self.assertTrue(v.ok, v.error)
        self.assertEqual(v.payload["recording_id"], "abc")

    async def test_tampered_body_rejected(self):
        generic = get_provider("generic")
        body, headers = self._signed_request({
            "recording_id": "abc",
            "audio_url": "https://example.com/a.mp3",
        })
        # Tamper with the body but keep the headers.
        tampered = body.replace(b"abc", b"xyz")
        v = await generic.verify_webhook(_fake_request(body=tampered, headers=headers))
        self.assertFalse(v.ok)
        self.assertEqual(v.response_status, 401)

    async def test_missing_headers_rejected(self):
        generic = get_provider("generic")
        v = await generic.verify_webhook(_fake_request(body=b"{}", headers={}))
        self.assertFalse(v.ok)
        self.assertEqual(v.response_status, 401)

    async def test_extract_recording_events_minimal(self):
        generic = get_provider("generic")
        events = await generic.extract_recording_events({
            "recording_id": "rec-42",
            "audio_url": "https://example.com/a.wav",
        })
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].external_recording_id, "rec-42")
        self.assertEqual(events[0].file_extension, "wav")

    async def test_extract_drops_event_without_required_fields(self):
        generic = get_provider("generic")
        events = await generic.extract_recording_events({"recording_id": "x"})
        self.assertEqual(events, [])


# ── Renewal cron skips providers without subscription support ──────────────

class RenewalSkipTests(unittest.IsolatedAsyncioTestCase):
    async def test_default_renew_subscription_raises(self):
        zoom = get_provider("zoom")
        with self.assertRaises(NotImplementedError):
            await zoom.renew_subscription("any-id")

    async def test_teams_overrides_renew_subscription(self):
        # Just verify the method is overridden — calling it would hit Graph.
        teams = get_provider("teams")
        self.assertIsNot(
            type(teams).renew_subscription, BaseProvider.renew_subscription
        )


if __name__ == "__main__":
    unittest.main()
