"""Graph subscription lifecycle endpoints.

Microsoft Graph delivers `reauthorizationRequired` / `subscriptionRemoved`
/ `missed` events to the URL we set as `lifecycleNotificationUrl`. This
route handles them so renewal / re-auth happens without manual ops.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response

from .db import get_db
from .providers.base import get_provider

log = logging.getLogger(__name__)
router = APIRouter()


@router.api_route("/lifecycle/{provider_id}", methods=["GET", "POST"])
async def lifecycle(
    provider_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
) -> Response:
    # Validation handshake reuses the same ?validationToken=… format on both
    # the notification URL and the lifecycle URL. Reply 200 text/plain.
    validation_token = request.query_params.get("validationToken")
    if validation_token is not None:
        return Response(
            content=validation_token.encode("utf-8"),
            media_type="text/plain",
        )

    if provider_id != "teams":
        raise HTTPException(status_code=404, detail=f"no lifecycle for {provider_id}")

    try:
        payload: dict[str, Any] = json.loads(await request.body() or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="malformed JSON")

    teams = get_provider("teams")
    for item in payload.get("value", []):
        sub_id = item.get("subscriptionId")
        kind = item.get("lifecycleEvent")
        if not sub_id or not kind:
            continue
        if kind == "reauthorizationRequired":
            background_tasks.add_task(_renew_safely, sub_id, teams)
        elif kind == "subscriptionRemoved":
            log.warning("subscription %s removed by Graph", sub_id)
            get_db().execute(
                "DELETE FROM subscription WHERE provider = ? AND external_id = ?",
                ("teams", sub_id),
            )
        elif kind == "missed":
            # We dropped some events — surface to a metrics counter when we
            # have one; for now log loudly so an operator notices.
            log.error("subscription %s missed events; backfill required", sub_id)
        else:
            log.info("unhandled lifecycle event %s for %s", kind, sub_id)

    return Response(status_code=202)


async def _renew_safely(sub_id: str, teams) -> None:
    try:
        new_expiry = await teams.renew_subscription(sub_id)
        log.info("renewed subscription %s -> %s", sub_id, new_expiry)
        get_db().execute(
            """UPDATE subscription
                  SET expires_at = ?, last_renewed_at = datetime('now')
                WHERE provider = 'teams' AND external_id = ?""",
            (new_expiry, sub_id),
        )
    except Exception:
        log.exception("subscription renewal failed for %s", sub_id)
