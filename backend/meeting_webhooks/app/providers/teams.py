"""Microsoft Teams provider.

Implements the recommended primitive — Graph change notifications on the
`callRecording` resource — per the design notes in
docs/07 Integration CAA 27APR2026/meeting_recording_webhooks.md §3.

The OAuth flow is admin-consent client_credentials (app-only), so
`start_connect` returns an admin-consent URL rather than a per-user OAuth
redirect. After admin consent the connection is marked `connected` and the
service creates a tenant-wide subscription on /complete.

Resource-data encryption (`includeResourceData: true`) is intentionally
deferred — see TODO at `extract_recording_events`. v1 receives the bare
notification, follows the `resource` URL with an app-only token, and reads
the recording metadata + bytes that way. Costs one extra Graph call but
removes a whole class of crypto plumbing from the v1 surface.
"""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Optional
from urllib.parse import urlencode

import httpx
from fastapi import Request

from ..config import settings
from ..db import (
    credentials_of,
    get_connection,
    record_subscription,
    upsert_connection,
)
from .base import (
    BaseProvider,
    ConnectInitResponse,
    RecordingEvent,
    WebhookVerification,
    register_provider,
)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
LOGIN_BASE = "https://login.microsoftonline.com"


@register_provider
class MicrosoftTeamsProvider(BaseProvider):
    id = "teams"
    display_name = "Microsoft Teams"
    supports_oauth_redirect = True

    # ── Connect ─────────────────────────────────────────────────────────

    async def start_connect(
        self, *, user_id: str, redirect_uri: str,
    ) -> ConnectInitResponse:
        if settings.allow_mock_connect and not settings.teams_client_id:
            # Dev-mode: pretend the admin clicked through. No real Graph
            # subscription gets created. The frontend can still see the
            # connection appear in /api/integrations.
            upsert_connection(
                user_id=user_id,
                provider=self.id,
                status="connected_mock",
                external_account=settings.teams_tenant_id or "mock-tenant",
                credentials={"mock": True},
                client_state=secrets.token_urlsafe(24),
            )
            return ConnectInitResponse(
                instructions=(
                    "Mock-mode connection created. Set TEAMS_TENANT_ID, "
                    "TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET in backend/.env "
                    "and redeploy to enable real ingestion."
                ),
            )

        if not settings.teams_tenant_id or not settings.teams_client_id:
            return ConnectInitResponse(
                instructions=(
                    "Teams integration is not configured. An admin must set "
                    "TEAMS_TENANT_ID and TEAMS_CLIENT_ID before connecting."
                ),
            )

        # Admin-consent URL. After consent Microsoft redirects to redirect_uri
        # with `admin_consent=True` and `tenant=<tenant_id>`.
        state = secrets.token_urlsafe(24)
        upsert_connection(
            user_id=user_id, provider=self.id, status="pending",
            client_state=state,
        )
        consent_url = (
            f"{LOGIN_BASE}/{settings.teams_tenant_id}/adminconsent?"
            + urlencode({
                "client_id": settings.teams_client_id,
                "redirect_uri": redirect_uri,
                "state": state,
            })
        )
        return ConnectInitResponse(redirect_url=consent_url, state=state)

    async def complete_connect(
        self, *, user_id: str, params: dict[str, Any],
    ) -> dict[str, Any]:
        # We don't need a code exchange — admin consent grants the app
        # client_credentials access tenant-wide. We just confirm the state
        # we minted at /start and verify we can mint a real Graph token.
        existing = get_connection(user_id=user_id, provider=self.id)
        expected_state = existing["client_state"] if existing else None
        if expected_state and params.get("state") != expected_state:
            raise ValueError("state mismatch on Teams admin-consent callback")

        token = await self._app_token()
        # Sanity ping. If this 401s the consent didn't actually grant our
        # required permissions.
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{GRAPH_BASE}/applications",
                headers={"Authorization": f"Bearer {token}"},
            )
        if r.status_code >= 400 and r.status_code != 403:
            raise RuntimeError(f"graph sanity probe failed: {r.status_code}")

        client_state = secrets.token_urlsafe(24)
        upsert_connection(
            user_id=user_id, provider=self.id, status="connected",
            external_account=settings.teams_tenant_id,
            credentials={"granted_at": datetime.now(timezone.utc).isoformat()},
            client_state=client_state,
        )

        # Best-effort: create the recording subscription. Errors here mark
        # the connection as `degraded` so the UI can surface a "fix me" link.
        try:
            await self.create_subscription(user_id=user_id)
        except Exception as exc:  # pragma: no cover — depends on tenant setup
            upsert_connection(
                user_id=user_id, provider=self.id, status="degraded",
                external_account=settings.teams_tenant_id,
                credentials={"last_subscription_error": str(exc)},
            )

        row = get_connection(user_id=user_id, provider=self.id)
        return {
            "id": row["id"], "provider": self.id, "status": row["status"],
            "external_account": row["external_account"],
        }

    # ── Subscription create / renew ─────────────────────────────────────

    async def create_subscription(self, *, user_id: str) -> str:
        row = get_connection(user_id=user_id, provider=self.id)
        if not row:
            raise RuntimeError("no Teams connection for user")

        token = await self._app_token()
        # Max lifetime for callRecording is 4,320 min (3 days). We request
        # 70 hours so the renewal cron has comfortable headroom.
        expires = datetime.now(timezone.utc) + timedelta(hours=70)
        body = {
            "changeType": "created",
            "notificationUrl": f"{settings.public_base_url}/webhooks/teams",
            "lifecycleNotificationUrl": f"{settings.public_base_url}/lifecycle/teams",
            "resource": settings.teams_subscription_resource,
            "includeResourceData": settings.teams_include_resource_data,
            "expirationDateTime": expires.isoformat().replace("+00:00", "Z"),
            "clientState": row["client_state"],
        }
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{GRAPH_BASE}/subscriptions",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                content=json.dumps(body),
            )
        if r.status_code >= 400:
            raise RuntimeError(f"subscription create failed: {r.status_code} {r.text}")
        sub = r.json()
        record_subscription(
            connection_id=int(row["id"]), provider=self.id,
            external_id=sub["id"], expires_at=sub["expirationDateTime"],
        )
        return sub["id"]

    async def renew_subscription(self, subscription_external_id: str) -> str:
        token = await self._app_token()
        new_expiry = (
            datetime.now(timezone.utc) + timedelta(hours=70)
        ).isoformat().replace("+00:00", "Z")
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.patch(
                f"{GRAPH_BASE}/subscriptions/{subscription_external_id}",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                content=json.dumps({"expirationDateTime": new_expiry}),
            )
        if r.status_code >= 400:
            raise RuntimeError(f"subscription renew failed: {r.status_code} {r.text}")
        return new_expiry

    # ── Webhook receive ─────────────────────────────────────────────────

    async def verify_webhook(self, request: Request) -> WebhookVerification:
        # Validation handshake (subscription create/renewal). Graph hits the
        # endpoint with ?validationToken=…; we must reply 200 text/plain
        # with the URL-decoded token within 10 seconds.
        validation_token = request.query_params.get("validationToken")
        if validation_token is not None:
            return WebhookVerification(
                ok=True,
                response_body=validation_token.encode("utf-8"),
                response_content_type="text/plain",
            )

        body = await request.body()
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError as exc:
            return WebhookVerification(ok=False, response_status=400, error=str(exc))

        # clientState check — every notification carries the secret we
        # supplied at subscription create-time. Reject if any item is wrong.
        for item in payload.get("value", []):
            client_state = item.get("clientState")
            sub_id = item.get("subscriptionId")
            if not sub_id or not client_state:
                return WebhookVerification(
                    ok=False, response_status=401,
                    error="missing subscriptionId/clientState",
                )
            if not self._client_state_matches(sub_id, client_state):
                return WebhookVerification(
                    ok=False, response_status=401,
                    error="clientState mismatch",
                )

        # TODO: validate `validationTokens` JWTs against
        # https://login.microsoftonline.com/common/discovery/v2.0/keys.
        # Not strictly required when clientState is enforced + TLS, but it's
        # the belt-and-braces step we'd add for prod.
        return WebhookVerification(ok=True, payload=payload)

    async def extract_recording_events(
        self, payload: dict[str, Any],
    ) -> list[RecordingEvent]:
        events: list[RecordingEvent] = []
        for item in payload.get("value", []):
            if item.get("changeType") != "created":
                continue
            resource = item.get("resource") or ""
            data = item.get("resourceData") or {}
            recording_id = data.get("id") or item.get("id") or ""

            # Without resource-data encryption we don't have the
            # recordingContentUrl yet — fetch the resource to get it.
            content_url = await self._fetch_recording_content_url(resource)
            if not content_url:
                continue

            events.append(RecordingEvent(
                external_recording_id=recording_id,
                fetch_context={"content_url": content_url, "resource": resource},
                file_extension="mp4",
            ))
        return events

    # ── Media fetch ─────────────────────────────────────────────────────

    async def download_recording(
        self, *, connection_credentials: dict[str, Any], event: RecordingEvent,
    ) -> AsyncIterator[bytes]:
        token = await self._app_token()
        url = event.fetch_context["content_url"]
        if not url.startswith("http"):
            url = f"{GRAPH_BASE}/{url.lstrip('/')}"
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "GET", url,
                headers={"Authorization": f"Bearer {token}"},
                follow_redirects=True,
            ) as r:
                r.raise_for_status()
                async for chunk in r.aiter_bytes(chunk_size=64 * 1024):
                    yield chunk

    # ── helpers ─────────────────────────────────────────────────────────

    async def _app_token(self) -> str:
        if not (settings.teams_tenant_id and settings.teams_client_id and settings.teams_client_secret):
            raise RuntimeError("teams app credentials not configured")
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{LOGIN_BASE}/{settings.teams_tenant_id}/oauth2/v2.0/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": settings.teams_client_id,
                    "client_secret": settings.teams_client_secret,
                    "scope": "https://graph.microsoft.com/.default",
                },
            )
        if r.status_code >= 400:
            raise RuntimeError(f"token request failed: {r.status_code} {r.text}")
        return r.json()["access_token"]

    async def _fetch_recording_content_url(self, resource_path: str) -> Optional[str]:
        if not resource_path:
            return None
        token = await self._app_token()
        url = (
            resource_path if resource_path.startswith("http")
            else f"{GRAPH_BASE}/{resource_path.lstrip('/')}"
        )
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                url, headers={"Authorization": f"Bearer {token}"},
            )
        if r.status_code >= 400:
            return None
        body = r.json()
        return body.get("recordingContentUrl") or body.get("contentUrl")

    def _client_state_matches(self, subscription_id: str, client_state: str) -> bool:
        from ..db import get_db
        row = get_db().execute(
            """SELECT c.client_state
                 FROM subscription s
                 JOIN connection c ON c.id = s.connection_id
                WHERE s.provider = ? AND s.external_id = ?""",
            (self.id, subscription_id),
        ).fetchone()
        if not row:
            # Unknown subscription — could be a stale notification we should
            # politely accept, or a forged one. Reject; renewing the sub if
            # legitimate is cheap.
            return False
        return row["client_state"] == client_state
