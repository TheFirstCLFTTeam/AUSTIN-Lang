"""
Async-style worker that drives a single submission through the pipeline:

  load segments
    → find manual masks
    → call gliner on un-masked text
    → drop model spans overlapping manual masks (user intent wins)
    → resolve overlapping model spans (longest-first)
    → assign stable placeholders
    → encrypt + persist run + spans
    → transition transcript status to 'in review'

Run inline from a request handler today (`asyncio.create_task` keeps the
HTTP response fast). When the project adopts a real queue (Celery/RQ —
existing transcription pipeline already uses one), swap the entrypoint
without touching the body of `run_pseudonymisation`.
"""

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from . import storage
from .crypto import encrypt
from .gliner_client import (
    GlinerBadInput,
    GlinerInferenceFailure,
    pseudonymise_segments,
)
from .labels import LABEL_SET_VERSION, MODEL_VERSION
from .masking import (
    ModelSpan,
    assign_placeholders,
    drop_model_spans_overlapping_manual,
    find_manual_masks,
    resolve_overlaps,
)


@dataclass
class SegmentInput:
    id: str
    text: str
    lang: Optional[str] = None


# Hook point: orchestrator wires this to the existing status-transition
# helper (lib/statusFlow.js on the JS side; mirror it on the Python side).
StatusUpdater = Callable[[str, str], None]
NotifyReviewer = Callable[[str, str], None]


def run_pseudonymisation(
    transcript_id: str,
    submitter_id: str,
    segments: List[SegmentInput],
    update_status: StatusUpdater,
    notify_reviewer: NotifyReviewer,
    reviewer_id: Optional[str] = None,
) -> str:
    """Execute one pseudonymisation run end-to-end. Returns the run_id."""
    run_id = f"pr-{dt.datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6]}"
    started_at = _now_iso()

    storage.insert_run(storage.RunRecord(
        id=run_id, transcript_id=transcript_id,
        model_version=MODEL_VERSION, label_set_version=LABEL_SET_VERSION,
        started_at=started_at, completed_at=None, status="running",
        actor_id="system", attempts=1,
    ))
    update_status(transcript_id, "pseudonymising")

    try:
        spans = _execute(transcript_id, segments)
    except GlinerBadInput as exc:
        # 4xx — schema drift, do NOT retry. Park for admin.
        storage.update_run_status(
            run_id, "failed", completed_at=_now_iso(),
            error_code="bad_input", error_message=str(exc),
        )
        update_status(transcript_id, "needs action")
        return run_id
    except GlinerInferenceFailure as exc:
        storage.update_run_status(
            run_id, "failed", completed_at=_now_iso(),
            error_code="inference_failed", error_message=str(exc),
            attempts=3,
        )
        update_status(transcript_id, "needs action")
        return run_id

    # Persist spans (encrypting original_text on the way in).
    span_records = [
        storage.SpanRecord(
            id=f"sp-{run_id[3:]}-{i:02d}",
            run_id=run_id,
            segment_id=fs.segment_id,
            start_char=fs.start,
            end_char=fs.end,
            original_text=encrypt(fs.original_text),
            entity_type=fs.entity_id,
            placeholder=fs.placeholder,
            confidence=fs.confidence,
            source=fs.source,
        )
        for i, fs in enumerate(spans, start=1)
    ]
    storage.insert_spans(span_records)
    storage.update_run_status(run_id, "done", completed_at=_now_iso())

    update_status(transcript_id, "in review")
    if reviewer_id:
        notify_reviewer(reviewer_id, "pseudonymisation_done")

    return run_id


def _execute(transcript_id: str, segments: List[SegmentInput]):
    """Pure pipeline — no DB or status side effects. Easier to unit-test."""
    # 1. Locate manual masks per segment.
    manual_by_segment = {
        seg.id: find_manual_masks(seg.id, seg.text) for seg in segments
    }

    # 2. Call gliner on segment text (it's fine to send the full text — model
    # spans landing inside a manual mask get dropped in step 3).
    gliner_result = pseudonymise_segments([
        {"id": seg.id, "text": seg.text, "lang": seg.lang} for seg in segments
    ])

    # 3. Drop model spans that overlap any manual mask.
    model_spans = drop_model_spans_overlapping_manual(
        gliner_result.spans, manual_by_segment
    )

    # 4. Resolve model-span overlaps (longest-first).
    model_spans = resolve_overlaps(model_spans)

    # 5. Assign placeholders.
    segment_text = {seg.id: seg.text for seg in segments}
    manual_spans = [m for ms in manual_by_segment.values() for m in ms]
    return assign_placeholders(model_spans, manual_spans, segment_text)


def _now_iso() -> str:
    return dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
