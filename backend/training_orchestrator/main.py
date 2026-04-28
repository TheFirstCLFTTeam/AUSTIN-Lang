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
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from real_worker import start_real_worker
from registry import (
    ArtifactStore,
    BaseModelRecord,
    BaseModelStore,
    RegistryError,
    TrainingArtifactRecord,
)
from script_storage import ScriptRejected, store_script
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
base_models = BaseModelStore(db_path=store.db_path)
artifacts = ArtifactStore(db_path=store.db_path)
_worker = None


@app.on_event("startup")
def _seed_base_model_registry() -> None:
    """Ensure the four vendor entries exist on every boot. Idempotent —
    seeds rows by id, so a vendor displayed in `BASE_MODELS` on the FE
    that's missing from a long-running DB will be back-filled on next
    restart without touching engineer-derived rows."""
    try:
        base_models.seed_vendors()
    except Exception:
        # Don't crash the orchestrator boot on a registry seed failure —
        # GET /base-models can return an empty list and the FE falls back
        # to its hard-coded BASE_MODELS array. Logged for ops; not raised.
        import logging
        logging.exception("base_model registry seed failed")


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
    script_filename: Optional[str] = None
    script_sha256: Optional[str] = None
    script_size_bytes: Optional[int] = None
    script_uploaded_at: Optional[str] = None


class ScriptUploadResponse(BaseModel):
    job_id: str
    filename: str
    sha256: str
    size_bytes: int
    uploaded_at: str


class BaseModelResponse(BaseModel):
    id: str
    family: str
    display_name: str
    hf_id: Optional[str]
    owner_user_id: Optional[str]
    parent_base_model_id: Optional[str]
    architecture_fingerprint: Optional[str]
    weights_uri: Optional[str]
    data_zone: str
    created_at: str


class TrainingArtifactResponse(BaseModel):
    id: str
    job_id: str
    kind: str
    base_model_id: Optional[str]
    uri: str
    sha256: str
    size_bytes: int
    arch_fp: Optional[str]
    weight_fp: Optional[str]
    adapter_fp: Optional[str]
    promotion_note: Optional[str]
    created_at: str


def _to_base_model(record: BaseModelRecord) -> BaseModelResponse:
    return BaseModelResponse(**record.to_dict())


def _to_artifact(record: TrainingArtifactRecord) -> TrainingArtifactResponse:
    return TrainingArtifactResponse(**record.to_dict())


def _handle_registry_error(err: RegistryError) -> HTTPException:
    return HTTPException(status_code=err.status_code, detail=str(err))


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


@app.post(
    "/jobs/{job_id}/script",
    response_model=ScriptUploadResponse,
    status_code=200,
)
async def upload_script(job_id: str, file: UploadFile = File(...)):
    """Attach a Python training script to a queued job.

    Multipart upload — single field `file`. Validates size + declared
    MIME + extension + magic-byte sniff (see `script_storage.py`),
    persists the file under `TRAINING_SCRIPT_DIR/{job_id}/script.py`,
    and stamps `script_filename` / `script_sha256` / `script_size_bytes`
    / `script_uploaded_at` on the job row.

    Re-uploads are allowed while the job is still queued (the prior file
    on disk is replaced atomically via temp-file + rename). Once a worker
    picks up the job, the script is frozen — `attach_script` raises 409.
    """
    # 404 cheaply before reading the upload — no point streaming bytes
    # into memory just to reject them on a missing job id.
    record = store.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"job {job_id!r} not found")
    if record.status != "queued":
        raise HTTPException(
            status_code=409,
            detail=(
                f"script can only be uploaded while job is queued; "
                f"job {job_id!r} is {record.status!r}"
            ),
        )

    raw = await file.read()
    try:
        stored = store_script(
            job_id=job_id,
            filename=file.filename,
            declared_mime=file.content_type,
            raw_bytes=raw,
        )
    except ScriptRejected as rej:
        raise HTTPException(status_code=rej.status_code, detail=rej.detail)

    try:
        updated = store.attach_script(
            job_id,
            filename=stored.filename,
            sha256=stored.sha256,
            size_bytes=stored.size_bytes,
        )
    except JobError as err:
        raise _handle_job_error(err)

    return ScriptUploadResponse(
        job_id=stored.job_id,
        filename=stored.filename,
        sha256=stored.sha256,
        size_bytes=stored.size_bytes,
        uploaded_at=updated.script_uploaded_at or "",
    )


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


# ---------------------------------------------------------------------------
# Base-model registry + artifact reads (read-only for now — slice A of #4)
# ---------------------------------------------------------------------------

@app.get("/base-models", response_model=List[BaseModelResponse])
async def list_base_models(
    family: Optional[str] = None,
    owner_user_id: Optional[str] = None,
    include_vendor: bool = True,
    limit: int = 100,
):
    """List base models. Vendor entries (`owner_user_id IS NULL`) plus,
    when `owner_user_id` is supplied, that user's derived bases. Set
    `include_vendor=false` to suppress the vendor list and see only
    derived entries.

    The FE's training dialog should call this at mount time and fall
    back to its hard-coded `BASE_MODELS` array on 502/504 (mirrors the
    pattern in `services/training-jobs.js::refreshJobs`). Once the
    dialog reads this list, the constant array on the page can go.
    """
    records = base_models.list(
        family=family,
        owner_user_id=owner_user_id,
        include_vendor=include_vendor,
        limit=limit,
    )
    return [_to_base_model(r) for r in records]


@app.get("/base-models/{base_model_id}", response_model=BaseModelResponse)
async def get_base_model(base_model_id: str):
    record = base_models.get(base_model_id)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail=f"base model {base_model_id!r} not found",
        )
    return _to_base_model(record)


@app.get(
    "/jobs/{job_id}/artifacts",
    response_model=List[TrainingArtifactResponse],
)
async def list_artifacts_for_job(job_id: str):
    """Per-job artifact list. Today this returns an empty list for
    every job — the artifact-upload contract (`POST /jobs/{id}/
    artifacts` from training-job-pipeline.md §4.1) is slice B and
    needs torch + transformers to compute the orchestrator-side
    fingerprint. The endpoint ships now so the leaderboard endpoint
    on metrics-service has something to query against once slice B
    starts writing rows."""
    if store.get(job_id) is None:
        raise HTTPException(status_code=404, detail=f"job {job_id!r} not found")
    return [_to_artifact(r) for r in artifacts.list_for_job(job_id)]


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("TRAINING_ORCHESTRATOR_PORT", 8008))
    uvicorn.run(app, host="0.0.0.0", port=port)
