"""Pydantic request / response shapes.

Kept separate from db.py so the wire contract is reviewable without
reading the SQL helpers.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ── Term ───────────────────────────────────────────────────────────────────


class TermSubmit(BaseModel):
    """POST /terms body."""
    term: str = Field(..., min_length=1, max_length=200)
    category: Optional[str] = Field(None, max_length=64)
    definition: Optional[str] = Field(None, max_length=2048)
    source_file_id: Optional[str] = Field(None, max_length=64)
    notes: Optional[str] = Field(None, max_length=1024)


class TermModerate(BaseModel):
    """PATCH /terms/{id} body. `status` is the new lifecycle state; the
    other fields let the moderator fix metadata at the same moment."""
    status: Optional[str] = Field(
        None, pattern="^(pending|approved|rejected|retired)$",
    )
    category: Optional[str] = Field(None, max_length=64)
    definition: Optional[str] = Field(None, max_length=2048)
    notes: Optional[str] = Field(None, max_length=1024)


class TermResponse(BaseModel):
    id: int
    term: str
    term_normalized: str
    category: Optional[str]
    definition: Optional[str]
    status: str
    submitted_by: Optional[str]
    submitted_at: str
    approved_by: Optional[str]
    approved_at: Optional[str]
    source_file_id: Optional[str]
    notes: Optional[str]


# ── Occurrence ─────────────────────────────────────────────────────────────


class OccurrenceSubmit(BaseModel):
    """POST /occurrences body. Service-internal — written by the FE save
    path's auto-trail hook (slice 5) when a reviewer corrects a word
    that's in the approved dictionary."""
    term_id: int
    audio_file_external_id: str = Field(..., min_length=1, max_length=64)
    correctly_transcribed: bool


class OccurrenceResponse(BaseModel):
    id: int
    term_id: int
    audio_file_external_id: str
    appeared_at: str
    correctly_transcribed: int


# ── Stats ──────────────────────────────────────────────────────────────────


class TermStatRow(BaseModel):
    id: int
    term: str
    category: Optional[str]
    status: str
    occurrences: int
    wrong_count: Optional[int] = None
    right_count: Optional[int] = None


# ── Snapshot ───────────────────────────────────────────────────────────────


class SnapshotTerm(BaseModel):
    id: int
    term: str
    term_normalized: str
    category: Optional[str]
    definition: Optional[str]


class SnapshotResponse(BaseModel):
    version: Optional[str]
    term_count: int
    terms: list[SnapshotTerm]
