"""Abstract provider interface and registry.

Adding a new platform (Google Meet, Webex, BlueJeans, …) means subclassing
`BaseProvider`, decorating with `@register_provider`, and importing the
module from `providers/__init__.py`. The rest of the service — connect /
disconnect / webhook routes, dedupe, transcription handoff — is provider-
agnostic.

Naming follows React Aria's "action" model: `start_connect` / `complete_connect`
are the OAuth bookends; `verify_webhook` and `extract_recording_events` are
called by the inbound webhook handler.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, ClassVar, Optional

from fastapi import Request


@dataclass
class ConnectInitResponse:
    """What `start_connect` returns to the frontend."""
    # If non-None, the frontend redirects the browser here (OAuth consent URL).
    redirect_url: Optional[str] = None
    # Otherwise, the frontend can show this message and link the user through
    # whatever out-of-band setup the provider needs (e.g. admin Marketplace
    # install for Zoom Server-to-Server OAuth).
    instructions: Optional[str] = None
    # Echoed back to /complete so we can correlate the OAuth callback.
    state: Optional[str] = None


@dataclass
class RecordingEvent:
    """A single recording referenced by an inbound webhook event."""
    external_recording_id: str        # provider-side unique ID — dedupe key
    external_meeting_id: Optional[str] = None
    organiser_external_id: Optional[str] = None  # AAD object ID / Zoom user UUID
    organiser_email: Optional[str] = None
    topic: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    file_extension: str = "m4a"
    # Provider-specific fetch context — opaque to the orchestrator. Examples:
    #   Teams: {"recording_content_url": "users/.../recordings('VjI...')/content"}
    #   Zoom:  {"download_url": "...", "download_token": "..."}
    fetch_context: dict[str, Any] = field(default_factory=dict)


@dataclass
class WebhookVerification:
    """Outcome of `verify_webhook`."""
    # If True, the request is valid and `events` may be processed.
    ok: bool
    # If the provider's protocol requires us to return a body (e.g. Teams
    # validation token, Zoom URL-validation challenge) put it here. Routes
    # return this verbatim with the matching content type.
    response_body: Optional[bytes] = None
    response_status: int = 200
    response_content_type: str = "application/json"
    # Verified payload (decoded JSON for normal events, None for handshakes).
    payload: Optional[dict[str, Any]] = None
    error: Optional[str] = None


class BaseProvider(ABC):
    """Contract every provider must implement."""

    id: ClassVar[str]                # short slug, e.g. "teams"
    display_name: ClassVar[str]      # human-readable label
    # Whether the provider supports an OAuth-redirect Connect flow. Zoom S2S
    # OAuth, for example, is admin-only and doesn't need a per-user redirect.
    supports_oauth_redirect: ClassVar[bool] = True

    # ── Connect lifecycle ───────────────────────────────────────────────

    @abstractmethod
    async def start_connect(
        self, *, user_id: str, redirect_uri: str,
    ) -> ConnectInitResponse: ...

    @abstractmethod
    async def complete_connect(
        self, *, user_id: str, params: dict[str, Any],
    ) -> dict[str, Any]:
        """Persist a connection and return its public shape."""

    async def disconnect(self, *, user_id: str) -> None:
        """Delete the connection. Default impl handled by the routes layer
        via db.disconnect; override only if the provider needs cleanup
        (e.g. Graph DELETE /subscriptions/{id})."""

    # ── Webhook ingest ──────────────────────────────────────────────────

    @abstractmethod
    async def verify_webhook(self, request: Request) -> WebhookVerification:
        """Validate signature / handshake. Pure — no side effects on success."""

    @abstractmethod
    async def extract_recording_events(
        self, payload: dict[str, Any],
    ) -> list[RecordingEvent]: ...

    # ── Media fetch ─────────────────────────────────────────────────────

    @abstractmethod
    async def download_recording(
        self, *, connection_credentials: dict[str, Any], event: RecordingEvent,
    ) -> AsyncIterator[bytes]:
        """Async iterator of audio bytes. Stream — never buffer the whole MP4."""

    # ── Subscription lifecycle (override only if the provider has them) ──

    async def renew_subscription(self, subscription_external_id: str) -> str:
        """Extend a long-lived subscription. Returns the new ISO expiry.

        Default: providers without server-side subscriptions (Zoom S2S,
        generic, Google Meet via push channel re-creation) raise
        NotImplementedError and the renewal cron skips them.
        """
        raise NotImplementedError(
            f"{type(self).__name__} does not support subscription renewal"
        )


# ── Registry ────────────────────────────────────────────────────────────────

_REGISTRY: dict[str, BaseProvider] = {}


def register_provider(cls: type[BaseProvider]) -> type[BaseProvider]:
    instance = cls()
    if instance.id in _REGISTRY:
        raise RuntimeError(f"provider id collision: {instance.id}")
    _REGISTRY[instance.id] = instance
    return cls


def get_provider(provider_id: str) -> BaseProvider:
    if provider_id not in _REGISTRY:
        raise KeyError(f"unknown provider: {provider_id}")
    return _REGISTRY[provider_id]


def list_providers() -> list[BaseProvider]:
    return sorted(_REGISTRY.values(), key=lambda p: p.id)
