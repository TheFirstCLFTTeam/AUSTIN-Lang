"""Settings, all driven by environment variables.

Compose injects the per-provider secrets; locally `.env` works via
`pydantic-settings`. We deliberately avoid hard-coding any tenant or
account ID — multi-tenant deployments will set these per environment.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Where this service runs and where it talks to the rest of the platform.
    port: int = 8007
    db_path: str = "/app/data/meeting_webhooks.db"
    transcription_orchestrator_url: str = "http://transcription-orchestrator:8001"
    # The frontend exposes /api/integrations/ingest — we POST there with the
    # orchestrator's response so the row is mirrored into platform.db with
    # provider attribution. Optional: leave empty to skip the mirror step.
    frontend_ingest_url: str = ""
    frontend_ingest_secret: str = "dev-meeting-webhooks-ingest"

    # Public base URL for THIS service — used to build notification/redirect
    # URLs we hand to providers. Must be reachable from Microsoft / Zoom
    # (i.e. behind an HTTPS tunnel in dev — ngrok, cloudflared, etc.).
    public_base_url: str = "http://localhost:8007"

    # ── Microsoft Teams ────────────────────────────────────────────────────
    teams_tenant_id: str = ""
    teams_client_id: str = ""
    teams_client_secret: str = ""
    # A 32+ char shared secret echoed by Graph in every notification batch.
    # We generate one per connection and persist it; this default is only the
    # initial seed when no per-connection state exists yet.
    teams_default_client_state: str = "austin-meeting-webhooks-dev"
    # Subscription resource — tenant-wide by default. Override per connection.
    teams_subscription_resource: str = "communications/onlineMeetings/getAllRecordings"
    # In dev we omit includeResourceData so we don't have to plumb an X.509
    # cert. The notification handler does a follow-up GET on `resource`.
    teams_include_resource_data: bool = False

    # ── Zoom ───────────────────────────────────────────────────────────────
    zoom_account_id: str = ""
    zoom_client_id: str = ""
    zoom_client_secret: str = ""
    zoom_webhook_secret_token: str = ""

    # Allow connecting in mock mode without real credentials. This lets the
    # frontend exercise the full Connect flow end-to-end against a fake
    # provider. Off by default so production deploys can't accidentally
    # short-circuit the security-critical paths.
    allow_mock_connect: bool = True


settings = Settings()
