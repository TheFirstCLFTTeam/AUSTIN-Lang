"""Inbound webhook endpoints — one per provider.

The route does three things:
  1. Hand off to the provider's verify_webhook for signature/handshake.
  2. If it's a handshake, return the provider's prescribed body verbatim.
  3. If it's a real event, extract recording references and queue a
     background job per recording. ALWAYS respond 200 quickly — Zoom drops
     after 3 retries × 3 s, Graph throttles slow endpoints.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response

from .db import get_connection
from .providers.base import get_provider
from .worker import process_recording_event

log = logging.getLogger(__name__)
router = APIRouter()


@router.api_route("/webhooks/{provider_id}", methods=["GET", "POST"])
async def webhook(
    provider_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
) -> Response:
    try:
        provider = get_provider(provider_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown provider: {provider_id}")

    verification = await provider.verify_webhook(request)

    # Handshakes — return whatever body the provider needs, with the right
    # content type and status code.
    if verification.response_body is not None:
        return Response(
            content=verification.response_body,
            status_code=verification.response_status,
            media_type=verification.response_content_type,
        )

    if not verification.ok:
        log.warning("webhook verify failed (%s): %s", provider_id, verification.error)
        raise HTTPException(
            status_code=verification.response_status,
            detail=verification.error or "verification failed",
        )

    payload = verification.payload or {}
    try:
        events = await provider.extract_recording_events(payload)
    except Exception:
        log.exception("extract_recording_events crashed")
        events = []

    # Map each event to the matching connection. For Teams we look up the
    # subscription → connection. For Zoom we'd resolve via account_id.
    for event in events:
        connection_id = await _resolve_connection_id(provider_id, payload, event)
        if connection_id is None:
            log.warning(
                "no connection for %s event %s — dropping",
                provider_id, event.external_recording_id,
            )
            continue
        background_tasks.add_task(
            _run_safely,
            provider_id=provider_id,
            connection_id=connection_id,
            event_dict=asdict(event),
        )

    return Response(status_code=202)


async def _run_safely(**kwargs) -> None:
    try:
        await process_recording_event(**kwargs)
    except Exception:
        log.exception("background ingest crashed")


async def _resolve_connection_id(
    provider_id: str, payload: dict[str, Any], event: Any,
) -> int | None:
    """Map a webhook event to one of our `connection` rows.

    Teams: the notification carries `subscriptionId`; we joined that to a
    connection at subscription-create time.
    Zoom:  the envelope carries `payload.account_id`; we match on it.
    Other providers: override by adding a branch here, or move into the
    provider class as `find_connection_id_for_event`.
    """
    from .db import get_db

    if provider_id == "teams":
        sub_ids = {
            item.get("subscriptionId")
            for item in payload.get("value", [])
            if item.get("subscriptionId")
        }
        if not sub_ids:
            return None
        placeholders = ",".join("?" * len(sub_ids))
        row = get_db().execute(
            f"""SELECT s.connection_id
                  FROM subscription s
                 WHERE s.provider = ?
                   AND s.external_id IN ({placeholders})
                 LIMIT 1""",
            ("teams", *sub_ids),
        ).fetchone()
        return int(row["connection_id"]) if row else None

    if provider_id == "zoom":
        account_id = (payload.get("payload") or {}).get("account_id")
        if not account_id:
            return None
        row = get_db().execute(
            """SELECT id FROM connection
                WHERE provider = ? AND external_account = ?
                ORDER BY id LIMIT 1""",
            ("zoom", account_id),
        ).fetchone()
        return int(row["id"]) if row else None

    return None
