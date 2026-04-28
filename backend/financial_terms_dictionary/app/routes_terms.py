"""Term CRUD + moderation routes.

Auth pattern matches sibling services (meeting_webhooks, training_orchestrator):
trust X-User-Id / X-User-Role headers from the FE proxy on the internal
compose network. Harden when ops splits the network.

Role gates:
  - submit (POST /terms)            : reviewer / engineer / admin
  - read   (GET  /terms[, /{id}])   : any authenticated
  - moderate (PATCH /terms/{id})    : admin only
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query

from . import db
from .models import TermModerate, TermResponse, TermSubmit


log = logging.getLogger(__name__)
router = APIRouter()


SUBMITTER_ROLES = {"reviewer", "engineer", "admin"}
MODERATOR_ROLES = {"admin"}


def _require_user(x_user_id: Optional[str]) -> str:
    if not x_user_id:
        raise HTTPException(status_code=401, detail="missing X-User-Id header")
    return x_user_id


def _require_role(x_user_role: Optional[str], allowed: set[str]) -> str:
    role = (x_user_role or "").lower()
    if role not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"role {role!r} not permitted; need one of {sorted(allowed)}",
        )
    return role


@router.post("/terms", response_model=TermResponse, status_code=201)
def submit_term(
    body: TermSubmit,
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
) -> dict:
    user_id = _require_user(x_user_id)
    _require_role(x_user_role, SUBMITTER_ROLES)
    try:
        return db.submit_term(
            term=body.term,
            submitted_by=user_id,
            category=body.category,
            definition=body.definition,
            source_file_id=body.source_file_id,
            notes=body.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/terms", response_model=list[TermResponse])
def list_terms(
    status: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    x_user_id: Optional[str] = Header(default=None),
) -> list[dict]:
    _require_user(x_user_id)
    try:
        return db.list_terms(
            status=status, category=category, q=q,
            limit=limit, offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/terms/{term_id}", response_model=TermResponse)
def get_term(
    term_id: int,
    x_user_id: Optional[str] = Header(default=None),
) -> dict:
    _require_user(x_user_id)
    row = db.get_term(term_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"term {term_id} not found")
    return row


@router.patch("/terms/{term_id}", response_model=TermResponse)
def moderate_term(
    term_id: int,
    body: TermModerate,
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
) -> dict:
    moderator_id = _require_user(x_user_id)
    _require_role(x_user_role, MODERATOR_ROLES)

    if body.status is None and body.category is None and body.definition is None and body.notes is None:
        raise HTTPException(status_code=400, detail="no fields to update")

    # Default new_status to the existing value if the patch only touches
    # metadata. db.moderate_term still validates the status enum.
    if body.status is None:
        existing = db.get_term(term_id)
        if existing is None:
            raise HTTPException(status_code=404, detail=f"term {term_id} not found")
        new_status = existing["status"]
    else:
        new_status = body.status

    try:
        updated = db.moderate_term(
            term_id,
            new_status=new_status,
            moderator_id=moderator_id,
            category=body.category,
            definition=body.definition,
            notes=body.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if updated is None:
        raise HTTPException(status_code=404, detail=f"term {term_id} not found")
    return updated
