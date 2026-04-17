"""
HTTP surface for the pseudonymisation orchestrator. Five endpoints from §8
of the implementation plan.

Caller role is read from the X-User-Role header. In prod this is enforced
by an upstream auth proxy; the orchestrator just trusts the header. The
`approve` endpoint guards on the load-bearing rule: every span must have a
non-null decision before the transcript can be marked completed.
"""

import datetime as dt
import os
from typing import List, Literal, Optional

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import storage
from .crypto import decrypt
from .gliner_client import (
    GlinerBadInput,
    GlinerInferenceFailure,
    pseudonymise_segments,
)
from .labels import LABEL_SET_VERSION, MODEL_VERSION
from .masking import (
    assign_placeholders,
    drop_model_spans_overlapping_manual,
    find_manual_masks,
    render_masked_text,
    resolve_overlaps,
)
from .worker import SegmentInput, run_pseudonymisation

app = FastAPI(
    title="AUSTIN-Lang Pseudonymisation Orchestrator",
    description="Submission-time NER masking + reviewer sign-off.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    storage.init_db()


# ── Inbound shapes ───────────────────────────────────────────────────────

class SegmentIn(BaseModel):
    id: str
    text: str
    lang: Optional[str] = None


class SubmitForReviewBody(BaseModel):
    submitter_id: str
    reviewer_id: Optional[str] = None
    segments: List[SegmentIn]


class SpanDecisionBody(BaseModel):
    decision: Literal["accepted", "rejected"]
    note: Optional[str] = None


class RequestChangesBody(BaseModel):
    flagged_span_ids: List[str] = Field(default_factory=list)
    reason: Optional[str] = None


# ── Outbound shapes ──────────────────────────────────────────────────────

class SpanOut(BaseModel):
    span_id: str
    segment_id: str
    start_char: int
    end_char: int
    original_text: Optional[str]   # only populated for reviewer/admin
    entity_type: str
    placeholder: str
    confidence: float
    source: str
    decision: Optional[str]
    reviewer_id: Optional[str]
    reviewer_decided_at: Optional[str]
    reviewer_note: Optional[str]


class RunOut(BaseModel):
    run_id: str
    status: str
    model_version: str
    label_set_version: str
    started_at: str
    completed_at: Optional[str]
    attempts: int
    error: Optional[dict]
    spans: List[SpanOut]


# ── Status integration ───────────────────────────────────────────────────
#
# In dev / single-process mode, status lives in the same SQLite. In prod
# this is an HTTP call to the transcription orchestrator. Keeping it
# behind a small adapter lets the worker stay backend-agnostic.

TRANSCRIPT_STATUS_URL = os.getenv("TRANSCRIPT_STATUS_URL")


def _update_transcript_status(transcript_id: str, status: str) -> None:
    if not TRANSCRIPT_STATUS_URL:
        print(f"[status] {transcript_id} → {status}")
        return
    import httpx
    with httpx.Client(timeout=5) as client:
        client.post(
            f"{TRANSCRIPT_STATUS_URL}/transcripts/{transcript_id}/status",
            json={"status": status},
        )


def _notify_reviewer(reviewer_id: str, kind: str) -> None:
    # Hooks into addReviewActionNotification on the JS side. Stubbed for now.
    print(f"[notify] reviewer={reviewer_id} kind={kind}")


# ── Endpoints ────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "healthy"}


# ── Sync masking endpoint ────────────────────────────────────────────────
#
# Stateless companion to /transcripts/:id/submit-for-review. Used by the
# frontend submit-for-review path to grab the masked segments in one round
# trip (no DB writes, no reviewer-decision loop). Failure surfaces as 5xx
# so the caller can decide whether to block or pass through unmasked.

class PseudonymiseSegmentIn(BaseModel):
    id: str
    text: str
    lang: Optional[str] = None


class PseudonymiseNowBody(BaseModel):
    segments: List[PseudonymiseSegmentIn]


class MaskedSegmentOut(BaseModel):
    id: str
    text: str          # masked text (placeholders substituted in)


class PseudonymiseNowResponse(BaseModel):
    model_version: str
    label_set_version: str
    masked_segments: List[MaskedSegmentOut]
    spans_count: int


@app.post("/pseudonymise-now", response_model=PseudonymiseNowResponse)
async def pseudonymise_now(body: PseudonymiseNowBody):
    if not body.segments:
        return PseudonymiseNowResponse(
            model_version=MODEL_VERSION,
            label_set_version=LABEL_SET_VERSION,
            masked_segments=[],
            spans_count=0,
        )

    manual_by_segment = {
        seg.id: find_manual_masks(seg.id, seg.text) for seg in body.segments
    }

    try:
        gliner_result = pseudonymise_segments([
            {"id": s.id, "text": s.text, "lang": s.lang} for s in body.segments
        ])
    except GlinerBadInput as exc:
        raise HTTPException(status_code=400, detail=f"bad input to gliner: {exc}")
    except GlinerInferenceFailure as exc:
        raise HTTPException(status_code=503, detail=f"gliner unavailable: {exc}")

    model_spans = drop_model_spans_overlapping_manual(
        gliner_result.spans, manual_by_segment
    )
    model_spans = resolve_overlaps(model_spans)

    segment_text = {seg.id: seg.text for seg in body.segments}
    manual_spans = [m for ms in manual_by_segment.values() for m in ms]
    finals = assign_placeholders(model_spans, manual_spans, segment_text)

    finals_by_segment: dict = {}
    for f in finals:
        finals_by_segment.setdefault(f.segment_id, []).append(f)

    masked = [
        MaskedSegmentOut(
            id=seg.id,
            text=render_masked_text(seg.text, finals_by_segment.get(seg.id, [])),
        )
        for seg in body.segments
    ]

    return PseudonymiseNowResponse(
        model_version=MODEL_VERSION,
        label_set_version=LABEL_SET_VERSION,
        masked_segments=masked,
        spans_count=len(finals),
    )


@app.post("/transcripts/{transcript_id}/submit-for-review")
async def submit_for_review(
    transcript_id: str,
    body: SubmitForReviewBody,
    background: BackgroundTasks,
):
    """Enqueue pseudonymisation, transition to 'pseudonymising', return run_id."""
    segments = [SegmentInput(id=s.id, text=s.text, lang=s.lang) for s in body.segments]

    # Run inline as a background task so the HTTP response returns fast.
    # Swap to Celery / RQ when the project standardises on a queue.
    def _job():
        run_pseudonymisation(
            transcript_id=transcript_id,
            submitter_id=body.submitter_id,
            segments=segments,
            update_status=_update_transcript_status,
            notify_reviewer=_notify_reviewer,
            reviewer_id=body.reviewer_id,
        )

    background.add_task(_job)
    # Pre-write a placeholder run row? No — the worker writes it as the
    # first thing it does. We can return the eventual status without an id
    # and let the client poll GET .../pseudonymisation for the latest run.
    return {"status": "pseudonymising"}


@app.get("/transcripts/{transcript_id}/pseudonymisation", response_model=RunOut)
async def get_pseudonymisation(
    transcript_id: str,
    x_user_role: Optional[str] = Header(default=None),
):
    run = storage.latest_run_for_transcript(transcript_id)
    if not run:
        raise HTTPException(status_code=404, detail="no run for transcript")

    spans = storage.list_spans(run.id)
    show_originals = (x_user_role or "").lower() in {"reviewer", "admin"}

    return RunOut(
        run_id=run.id,
        status=run.status,
        model_version=run.model_version,
        label_set_version=run.label_set_version,
        started_at=run.started_at,
        completed_at=run.completed_at,
        attempts=run.attempts,
        error=(
            {"code": run.error_code, "message": run.error_message}
            if run.error_code else None
        ),
        spans=[
            SpanOut(
                span_id=s.id,
                segment_id=s.segment_id,
                start_char=s.start_char,
                end_char=s.end_char,
                original_text=(decrypt(s.original_text) if show_originals else None),
                entity_type=s.entity_type,
                placeholder=s.placeholder,
                confidence=s.confidence,
                source=s.source,
                decision=s.decision,
                reviewer_id=s.reviewer_id,
                reviewer_decided_at=s.reviewer_decided_at,
                reviewer_note=s.reviewer_note,
            )
            for s in spans
        ],
    )


@app.post("/transcripts/{transcript_id}/pseudonymisation/spans/{span_id}/decision")
async def decide_span(
    transcript_id: str,
    span_id: str,
    body: SpanDecisionBody,
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    if (x_user_role or "").lower() != "reviewer":
        raise HTTPException(status_code=403, detail="reviewer role required")
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header required")

    decided_at = _now_iso()
    rows = storage.update_span_decision(
        span_id=span_id, decision=body.decision, reviewer_id=x_user_id,
        reviewer_decided_at=decided_at, note=body.note,
    )
    if rows == 0:
        raise HTTPException(status_code=404, detail="span not found")
    return {"span_id": span_id, "decision": body.decision, "decided_at": decided_at}


@app.post("/transcripts/{transcript_id}/approve")
async def approve(
    transcript_id: str,
    x_user_role: Optional[str] = Header(default=None),
):
    if (x_user_role or "").lower() != "reviewer":
        raise HTTPException(status_code=403, detail="reviewer role required")

    run = storage.latest_run_for_transcript(transcript_id)
    if not run:
        raise HTTPException(status_code=409, detail="no pseudonymisation run")
    if run.status != "done":
        raise HTTPException(status_code=409, detail=f"run status is {run.status}")
    if not storage.all_spans_decided(run.id):
        raise HTTPException(
            status_code=409,
            detail="every span must have a decision before approval",
        )

    _update_transcript_status(transcript_id, "completed")
    return {"transcript_id": transcript_id, "status": "completed"}


@app.post("/transcripts/{transcript_id}/request-changes")
async def request_changes(
    transcript_id: str,
    body: RequestChangesBody,
    x_user_role: Optional[str] = Header(default=None),
):
    if (x_user_role or "").lower() != "reviewer":
        raise HTTPException(status_code=403, detail="reviewer role required")
    _update_transcript_status(transcript_id, "needs action")
    return {
        "transcript_id": transcript_id,
        "status": "needs action",
        "flagged_span_ids": body.flagged_span_ids,
    }


def _now_iso() -> str:
    return dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PSEUDONYM_ORCHESTRATOR_PORT", 5002))
    uvicorn.run(app, host="0.0.0.0", port=port)
