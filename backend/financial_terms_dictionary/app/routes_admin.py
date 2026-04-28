"""Admin-only utility routes.

Currently just `POST /terms/bulk-import` for re-running the CSV importer
on demand. Out of band of normal moderation flow — the boot-time auto-
seed already handles the common case (fresh container picks up the
shipped CSV); this endpoint is for ops scenarios like "I dropped a
fresh CSV at /app/financialTerms.csv and want to re-import without
restarting the container."
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from .config import settings
from .routes_terms import MODERATOR_ROLES, _require_role, _require_user
from .seed import import_csv


log = logging.getLogger(__name__)
router = APIRouter()


class BulkImportRequest(BaseModel):
    csv_path: Optional[str] = None


@router.post("/terms/bulk-import")
def bulk_import(
    body: Optional[BulkImportRequest] = None,
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
) -> dict:
    user_id = _require_user(x_user_id)
    _require_role(x_user_role, MODERATOR_ROLES)

    csv_path = (body.csv_path if body else None) or settings.seed_csv_path
    try:
        counts = import_csv(csv_path, submitted_by=user_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 — surface any cleaner / SQL crash
        log.exception("bulk-import failed")
        raise HTTPException(status_code=500, detail=f"import failed: {exc}")
    return {"csv_path": csv_path, "counts": counts}
