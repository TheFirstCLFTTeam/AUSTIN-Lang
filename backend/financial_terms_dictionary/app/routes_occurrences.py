"""Occurrence ledger + stats routes.

The occurrence ledger is service-internal — POSTs come from the FE save
path (slice 5's auto-trail hook in writeEditsForFile) and from explicit
"💼 Add to dictionary" actions on the edit popover. Stats endpoints are
read-only and surface in the admin UI.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query

from . import db
from .models import (
    OccurrenceResponse,
    OccurrenceSubmit,
    SnapshotResponse,
    TermStatRow,
)


log = logging.getLogger(__name__)
router = APIRouter()


def _require_user(x_user_id: Optional[str]) -> str:
    if not x_user_id:
        raise HTTPException(status_code=401, detail="missing X-User-Id header")
    return x_user_id


@router.post("/occurrences", response_model=OccurrenceResponse, status_code=201)
def record_occurrence(
    body: OccurrenceSubmit,
    x_user_id: Optional[str] = Header(default=None),
) -> dict:
    _require_user(x_user_id)
    if db.get_term(body.term_id) is None:
        raise HTTPException(status_code=404, detail=f"term {body.term_id} not found")
    return db.record_occurrence(
        term_id=body.term_id,
        audio_file_external_id=body.audio_file_external_id,
        correctly_transcribed=body.correctly_transcribed,
    )


@router.get("/occurrences/stats")
def occurrences_stats(
    kind: str = Query(default="top_wrong", pattern="^(top_wrong|trending)$"),
    limit: int = Query(default=50, ge=1, le=500),
    since: Optional[str] = Query(default=None, description="ISO 8601 lower bound for trending"),
    x_user_id: Optional[str] = Header(default=None),
) -> dict:
    _require_user(x_user_id)
    if kind == "top_wrong":
        rows = db.stats_top_wrong(limit=limit)
    else:
        rows = db.stats_trending(limit=limit, since_iso=since)
    return {
        "kind": kind,
        "limit": limit,
        "since": since,
        "rows": [TermStatRow(**r).model_dump() for r in rows],
    }


# ── Snapshot ──────────────────────────────────────────────────────────────


snapshot_router = APIRouter()


@snapshot_router.get("/dictionary/snapshot", response_model=SnapshotResponse)
def dictionary_snapshot(
    x_user_id: Optional[str] = Header(default=None),
) -> dict:
    """Bulk approved-terms list + version stamp.

    Consumers: metrics-service at eval-manifest build time,
    retraining-pipeline/dataset_builder.py at training-manifest build time.
    See docs/07 Integration CAA 27APR2026/financial-terms-dictionary.md §6.3.
    """
    # Service-internal; still require an X-User-Id so the proxy can't
    # blindly forward unauthenticated calls. Auth on the FE proxy side
    # already gates the user.
    _require_user(x_user_id)
    return db.dictionary_snapshot()
