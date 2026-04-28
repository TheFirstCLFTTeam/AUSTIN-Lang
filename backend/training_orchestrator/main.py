"""training-orchestrator HTTP surface.

Owns the lifecycle of an ML engineer's training job: takes a submission
from the FE's New-Train-Job dialog, persists it, exposes status reads
and lifecycle controls. Worker-side execution + heartbeat + log SSE land
in follow-up slices — see docs/07 Integration CAA 27APR2026/training-job-
pipeline.md §4.1.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from real_worker import start_real_worker
from sse import stream_job_events
from storage import JobError, JobStore, TrainingJobRecord
from worker import (
    DEFAULT_POLL_INTERVAL_SECONDS,
    DEFAULT_SIMULATED_DURATION_SECONDS,
    start_background_worker,
)


load_dotenv()

app = FastAPI(title="AUSTIN-Lang Training Orchestrator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In prod, restrict via ALLOWED_ORIGINS / F9.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = JobStore()
_worker = None


def _truthy(env_value: Optional[str]) -> bool:
    if env_value is None:
        return False
    return env_value.strip().lower() in ("1", "true", "yes", "on")


@app.on_event("startup")
def _maybe_start_worker() -> None:
    """Spawn a worker on a daemon thread when WORKER_ENABLED.

    Two modes, switched via WORKER_MODE:

    - "simulated" (default): walks jobs through the state machine in ~30s
      with no real training. Closes the orchestrator loop end-to-end so
      the LAUNCH button → detail page render path is exercisable in dev /
      tests. See worker.py module docstring.

    - "real": invokes backend/retraining-pipeline/cloud_train_sync.sh as a
      subprocess; parses stdout for state markers + HF Trainer progress;
      terminates the subprocess on cancel. Requires the orchestrator
      container to have an SSH key + outbound network so the script can
      reach the GPU box. See real_worker.py.

    Flip WORKER_ENABLED=false to disable both — useful when a separate
    worker container takes over the queue.
    """
    global _worker
    if not _truthy(os.getenv("WORKER_ENABLED", "true")):
        return

    mode = (os.getenv("WORKER_MODE", "simulated") or "simulated").strip().lower()
    poll = float(os.getenv("WORKER_POLL_INTERVAL_SECONDS", DEFAULT_POLL_INTERVAL_SECONDS))

    if mode == "real":
        _worker = start_real_worker(
            store,
            script_path=os.getenv(
                "TRAINING_SCRIPT_PATH",
                "/app/retraining-pipeline/cloud_train_sync.sh",
            ),
            working_dir=os.getenv(
                "TRAINING_SCRIPT_CWD",
                "/app/retraining-pipeline",
            ),
            log_dir=os.getenv("TRAINING_LOG_DIR", "/app/data/logs"),
            poll_interval_seconds=poll,
        )
        return

    if mode != "simulated":
        # Unknown mode — fail loudly rather than silently fall through.
        raise RuntimeError(
            f"unknown WORKER_MODE={mode!r}; expected 'simulated' or 'real'"
        )

    _worker = start_background_worker(
        store,
        poll_interval_seconds=poll,
        simulated_duration_seconds=float(
            os.getenv("WORKER_SIMULATED_DURATION_SECONDS", DEFAULT_SIMULATED_DURATION_SECONDS)
        ),
    )


@app.on_event("shutdown")
def _stop_worker() -> None:
    global _worker
    if _worker is not None:
        _worker.stop()
        _worker = None


# ---------------------------------------------------------------------------
# Request / response shapes
# ---------------------------------------------------------------------------

class SubmitJobRequest(BaseModel):
    name: str
    submitted_by: str
    target: str = Field(..., description="cloud | local | federated")
    base_model: str
    dataset_ref: str
    env: Dict[str, Any] = Field(default_factory=dict)
    data_zone: str = "green"
    fl_enabled: bool = False
    dp_enabled: bool = False


class TransitionRequest(BaseModel):
    failure_reason: Optional[str] = None
    progress_pct: Optional[float] = None


class JobResponse(BaseModel):
    id: str
    name: str
    submitted_by: str
    submitted_at: str
    status: str
    target: str
    base_model: str
    dataset_ref: str
    data_zone: str
    env: Dict[str, Any]
    fl_enabled: bool
    dp_enabled: bool
    progress_pct: Optional[float]
    started_at: Optional[str]
    finished_at: Optional[str]
    failure_reason: Optional[str]


def _to_response(record: TrainingJobRecord) -> JobResponse:
    return JobResponse(**record.to_dict())


def _handle_job_error(err: JobError) -> HTTPException:
    return HTTPException(status_code=err.status_code, detail=str(err))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/jobs", response_model=JobResponse, status_code=201)
async def submit_job(req: SubmitJobRequest):
    try:
        record = store.submit(
            name=req.name,
            submitted_by=req.submitted_by,
            target=req.target,
            base_model=req.base_model,
            dataset_ref=req.dataset_ref,
            env=req.env,
            data_zone=req.data_zone,
            fl_enabled=req.fl_enabled,
            dp_enabled=req.dp_enabled,
        )
    except JobError as err:
        raise _handle_job_error(err)
    return _to_response(record)


@app.get("/jobs", response_model=List[JobResponse])
async def list_jobs(
    submitter: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
):
    records = store.list(submitter=submitter, status=status, limit=limit)
    return [_to_response(r) for r in records]


@app.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    record = store.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"job {job_id!r} not found")
    return _to_response(record)


@app.post("/jobs/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(job_id: str):
    try:
        record = store.cancel(job_id)
    except JobError as err:
        raise _handle_job_error(err)
    return _to_response(record)


@app.get("/jobs/{job_id}/logs")
async def stream_logs(job_id: str):
    """SSE stream of log lines + state transitions for a single job.

    Replays existing log content first, then tails until the job hits a
    terminal state (published / cancelled / failed). See sse.py for the
    event shape.
    """
    record = store.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"job {job_id!r} not found")

    log_dir = os.getenv("TRAINING_LOG_DIR", "/app/data/logs")

    def event_stream():
        yield from stream_job_events(store, job_id, log_dir=log_dir)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # nginx: don't buffer
            "Connection": "keep-alive",
        },
    )


@app.post("/jobs/{job_id}/transitions/{new_status}", response_model=JobResponse)
async def transition_job(job_id: str, new_status: str, req: TransitionRequest):
    """Worker-side hook for state machine transitions.

    Not exposed via the FE proxy — the orchestrator's own worker (or a
    future SSE bridge) drives this. Listed here so test infra can drive
    state without poking at the DB directly.
    """
    try:
        record = store.transition(
            job_id,
            new_status,
            failure_reason=req.failure_reason,
            progress_pct=req.progress_pct,
        )
    except JobError as err:
        raise _handle_job_error(err)
    return _to_response(record)


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("TRAINING_ORCHESTRATOR_PORT", 8008))
    uvicorn.run(app, host="0.0.0.0", port=port)
