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
└── providers/
    ├── base.py        # abstract BaseProvider + registry
    ├── teams.py       # Microsoft Teams (Graph callRecording)
    └── zoom.py        # Zoom (signature/handshake done; ingest TODO)
```

## Adding a provider

```python
from .base import BaseProvider, register_provider

@register_provider
class GoogleMeetProvider(BaseProvider):
    id = "google_meet"
    display_name = "Google Meet"
    supports_oauth_redirect = True

    async def start_connect(self, *, user_id, redirect_uri): ...
    async def complete_connect(self, *, user_id, params): ...
    async def verify_webhook(self, request): ...
    async def extract_recording_events(self, payload): ...
    async def download_recording(self, *, connection_credentials, event): ...
```

Then add `from . import google_meet` to `app/providers/__init__.py`. Routes,
dedupe, and the transcription handoff need no changes.

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

## What still has to happen for production

- **Teams**: encrypted resource data (`includeResourceData: true`) — wire an
  X.509 keypair through `app/config.py` and the cert path inside
  `providers/teams.py::create_subscription`.
- **Teams**: a renewal cron — there's a query helper
  (`db.list_subscriptions_for_renewal`) ready, but no scheduler runs it yet.
  Pick a cron container (or APScheduler on FastAPI startup) and have it
  call `MicrosoftTeamsProvider.renew_subscription` every ~6 h.
- **Zoom**: implement `extract_recording_events` and `download_recording`
  in `providers/zoom.py` — handshake + signature verification are already
  done.
- **Background queue**: replace FastAPI `BackgroundTasks` in
  `routes_webhook.py` with Celery/RQ for durable retries.
- **Token at rest**: the `connection.credentials_json` column is
  base64/JSON. KMS-wrap it in production.
