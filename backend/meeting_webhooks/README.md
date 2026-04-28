# meeting-webhooks

A FastAPI microservice that auto-ingests meeting recordings from external
platforms (Microsoft Teams, Zoom, …) into AUSTIN-Lang's transcription
pipeline. Users click "Connect" once on the Integrations page; from then on
every recording the platform finishes processing is downloaded, transcribed,
and surfaced in their file list with the source platform attributed on the
row.

Design background lives at
[`docs/07 Integration CAA 27APR2026/meeting_recording_webhooks.md`](../../docs/07%20Integration%20CAA%2027APR2026/meeting_recording_webhooks.md).

## Layout

```
app/
├── main.py            # FastAPI bootstrap; mounts the three route modules
├── config.py          # pydantic-settings, env-driven
├── db.py              # SQLite — connections, subscriptions, dedupe
├── orchestrator.py    # POST audio → transcription-orchestrator:8001
├── worker.py          # background-task entrypoint (download + ingest)
├── routes_connect.py  # frontend-facing: list / connect / disconnect
├── routes_webhook.py  # provider-facing: POST /webhooks/{provider}
├── routes_lifecycle.py# Graph subscription lifecycle
├── renewal.py        # asyncio task: renews Graph subscriptions at half-life
└── providers/
    ├── base.py        # abstract BaseProvider + registry
    ├── teams.py       # Microsoft Teams (Graph callRecording)
    ├── zoom.py        # Zoom (Marketplace S2S OAuth + recording.completed)
    ├── google_meet.py # Google Meet — pattern stub, raises 501 on the unimplemented bits
    └── generic.py     # Pluggable HMAC-signed webhook for any platform that can POST JSON
```

## Adding a provider

The factory pattern: subclass `BaseProvider`, decorate with
`@register_provider`, add a one-line import. Routes, dedupe, the renewal
cron, and the transcription handoff all pick the new provider up
automatically.

```python
# app/providers/slack_huddle.py
from .base import BaseProvider, ConnectInitResponse, RecordingEvent, WebhookVerification, register_provider


@register_provider
class SlackHuddleProvider(BaseProvider):
    id = "slack_huddle"
    display_name = "Slack Huddles"
    supports_oauth_redirect = True

    async def start_connect(self, *, user_id, redirect_uri):
        # Return ConnectInitResponse(redirect_url=…) for OAuth, or
        # ConnectInitResponse(instructions="…") for admin-only flows.
        ...

    async def complete_connect(self, *, user_id, params):
        # Persist the connection via app.db.upsert_connection.
        ...

    async def verify_webhook(self, request):
        # Inspect headers + signature, return WebhookVerification(ok=True, payload=…)
        # or fail with WebhookVerification(ok=False, response_status=401, error="…").
        # Slack uses an X-Slack-Signature header — easy to mirror the Zoom
        # implementation.
        ...

    async def extract_recording_events(self, payload):
        # Walk the verified payload and emit one RecordingEvent per audio
        # asset. Set fetch_context to whatever download_recording needs.
        return []

    async def download_recording(self, *, connection_credentials, event):
        # async generator — yield audio bytes in chunks. Never buffer.
        async for chunk in some_streaming_client.iter():
            yield chunk

    # Optional. Override only if your platform has long-lived subscriptions
    # that need PATCH-renewal (Graph callRecording, Drive push channels, …).
    # Default impl raises NotImplementedError and the renewal cron skips it.
    # async def renew_subscription(self, subscription_external_id): ...
```

Then add the import:

```python
# app/providers/__init__.py
from . import slack_huddle  # noqa: F401
```

That's it. The frontend integrations page will list it on next load
(the catalogue is `GET /providers` — it iterates the registry); webhook
deliveries land at `/webhooks/slack_huddle`; the worker dedupes by
`(provider="slack_huddle", external_recording_id=…)`.

### Reference implementations

- **Real, full pipeline:** `providers/teams.py` — admin-consent OAuth, Graph
  subscription create + renew, validation handshake, clientState
  enforcement, app-only token refresh, streaming download.
- **Real, single-secret signing:** `providers/zoom.py` — Marketplace S2S
  OAuth, URL-validation handshake, HMAC-SHA256 + replay-window check,
  per-event Bearer download with S2S fallback.
- **Generic / "I just want to ingest a URL":** `providers/generic.py` — for
  Slack/Discord bots, internal recording services, Lambda forwarders. The
  upstream client signs `v0:{ts}:{rawBody}` with a shared secret; body is
  `{ recording_id, audio_url, organiser_email?, … }`. Set
  `GENERIC_WEBHOOK_SECRET` to enable.
- **Stub demonstrating the pattern:** `providers/google_meet.py` — every
  required method is present, raising `NotImplementedError` with inline
  comments pointing at the Drive Activity / Drive v3 endpoints to fill in.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Liveness probe |
| GET | `/providers` | Static catalogue of registered providers |
| GET | `/connections` | Connections owned by `X-User-Id` |
| POST | `/connect/{provider_id}` | Start the connect flow; may return `redirect_url` or `instructions` |
| POST | `/connect/{provider_id}/complete` | Finalise after OAuth callback |
| DELETE | `/connect/{provider_id}` | Disconnect for `X-User-Id` |
| GET/POST | `/webhooks/{provider_id}` | Inbound webhook (validation + events) |
| GET/POST | `/lifecycle/teams` | Graph subscription lifecycle (reauth, removed, missed) |

## Env vars (set in `backend/.env` or compose)

```
PORT=8007
DB_PATH=/app/data/meeting_webhooks.db
TRANSCRIPTION_ORCHESTRATOR_URL=http://transcription-orchestrator:8001
FRONTEND_INGEST_URL=http://frontend:3000/api/integrations/ingest
FRONTEND_INGEST_SECRET=dev-meeting-webhooks-ingest
PUBLIC_BASE_URL=http://localhost:8007       # must be reachable from the providers (use ngrok/cloudflared in dev)
ALLOW_MOCK_CONNECT=true                     # lets the UI exercise Connect without real creds

# Microsoft Teams
TEAMS_TENANT_ID=
TEAMS_CLIENT_ID=
TEAMS_CLIENT_SECRET=

# Zoom
ZOOM_ACCOUNT_ID=
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_WEBHOOK_SECRET_TOKEN=

# Generic provider (Slack bots / Discord bots / custom forwarders)
GENERIC_WEBHOOK_SECRET=

# Renewal cron — disable to run renewal externally as a sidecar instead
WEBHOOK_RENEWAL_ENABLED=true
WEBHOOK_RENEWAL_INTERVAL_SECONDS=1800
```

## Mock mode

Leaving the provider creds blank with `ALLOW_MOCK_CONNECT=true` lets the
frontend Integrations page exercise the full Connect → Disconnect flow
end-to-end. No real Graph subscription gets created. Connections appear
with status `connected_mock` so the UI can flag them.

## Local dev

```bash
docker compose up meeting-webhooks
# or, ad-hoc, from this folder:
pip install -r requirements.txt
PUBLIC_BASE_URL=http://localhost:8007 \
  python -m uvicorn app.main:app --reload --port 8007
```

For real-tenant Teams testing point `PUBLIC_BASE_URL` at an HTTPS tunnel
(`ngrok http 8007`) and put the resulting URL into the Microsoft Graph
subscription's `notificationUrl` (the service does this automatically on
`POST /connect/teams/complete`).

## Tests

```bash
cd backend/meeting_webhooks
python -m unittest discover -s tests
```

16 stdlib `unittest` cases covering: registry duplicate-id rejection, Zoom
URL-validation handshake, Zoom signature pass / replay-window fail / signature
mismatch, Zoom recording-event extraction (M4A filter, status filter,
non-recording events), generic-provider HMAC signing (pass / tampered body /
missing headers), generic-provider event extraction, and renewal-cron
override detection.

## What still has to happen for production

- **Teams**: encrypted resource data (`includeResourceData: true`) — wire an
  X.509 keypair through `app/config.py` and the cert path inside
  `providers/teams.py::create_subscription`.
- **Background queue**: replace FastAPI `BackgroundTasks` in
  `routes_webhook.py` with Celery/RQ for durable retries.
- **Token at rest**: the `connection.credentials_json` column is
  base64/JSON. KMS-wrap it in production.
- **Google Meet**: fill in the methods marked `NotImplementedError` in
  `providers/google_meet.py` against the Drive Activity / Drive v3 APIs
  when prioritized.
