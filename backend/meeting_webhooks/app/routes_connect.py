"""Connect / disconnect / list endpoints.

These are called by the Next.js frontend (under /api/integrations/...).
The frontend runs auth in front of them — this service trusts the user_id
header it forwards. In a hardened deployment we'd verify a service-to-
service signature on top of that, but for now the service binds to the
internal compose network only.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request

from .db import disconnect, list_connections
from .providers.base import get_provider, list_providers

log = logging.getLogger(__name__)
router = APIRouter()


def _require_user(x_user_id: str | None) -> str:
    if not x_user_id:
        raise HTTPException(status_code=401, detail="missing X-User-Id header")
    return x_user_id


@router.get("/providers")
def get_providers() -> list[dict[str, Any]]:
    """Static catalogue — what's pluggable in this build."""
    return [
        {
            "id": p.id,
            "display_name": p.display_name,
            "supports_oauth_redirect": p.supports_oauth_redirect,
        }
        for p in list_providers()
    ]


@router.get("/connections")
def get_connections(x_user_id: str | None = Header(default=None)) -> list[dict[str, Any]]:
    user_id = _require_user(x_user_id)
    return list_connections(user_id)


@router.post("/connect/{provider_id}")
async def connect(
    provider_id: str,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _require_user(x_user_id)
    try:
        provider = get_provider(provider_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown provider: {provider_id}")

    body = await _safe_json(request)
    redirect_uri = (
        body.get("redirect_uri")
        if isinstance(body, dict)
        else None
    ) or ""
    init = await provider.start_connect(user_id=user_id, redirect_uri=redirect_uri)
    return {
        "provider": provider_id,
        "redirect_url": init.redirect_url,
        "instructions": init.instructions,
        "state": init.state,
    }


@router.post("/connect/{provider_id}/complete")
async def complete(
    provider_id: str,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _require_user(x_user_id)
    try:
        provider = get_provider(provider_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown provider: {provider_id}")
    params = await _safe_json(request) or {}
    if not isinstance(params, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")
    try:
        return await provider.complete_connect(user_id=user_id, params=params)
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/connect/{provider_id}")
def disconnect_route(
    provider_id: str,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _require_user(x_user_id)
    try:
        get_provider(provider_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown provider: {provider_id}")
    removed = disconnect(user_id=user_id, provider=provider_id)
    return {"provider": provider_id, "removed": removed}


async def _safe_json(request: Request) -> Any:
    try:
        return await request.json()
    except Exception:
        return None
