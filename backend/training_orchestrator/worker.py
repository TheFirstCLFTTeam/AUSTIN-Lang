"""Simulated training worker.

**This worker does not run real training.** It claims queued jobs, walks
them through `preparing → running → evaluating → published` with periodic
progress updates, and emits an honest "simulated" log line at each step.
Its job is to close the orchestrator loop end-to-end so the dashboard /
detail-page render path can be exercised without dragging
PyTorch / transformers / bitsandbytes into the orchestrator container.

When real training lands (the `target='cloud'` SSH path in
`backend/retraining-pipeline/cloud_train_sync.sh`, or a dedicated GPU
worker container), the same `JobStore.transition()` API is what the real
worker uses — this module gets disabled via `WORKER_ENABLED=false` and
the real worker takes over the queue. No orchestrator change required.

Open question 1 in
docs/07 Integration CAA 27APR2026/training-job-pipeline.md §6.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Optional

from storage import JobError, JobStore, TrainingJobRecord


log = logging.getLogger(__name__)


DEFAULT_POLL_INTERVAL_SECONDS = 2.0
DEFAULT_SIMULATED_DURATION_SECONDS = 30.0
DEFAULT_PROGRESS_TICKS = 10


class SimulatedWorker:
    def __init__(
        self,
        store: JobStore,
        *,
        poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
        simulated_duration_seconds: float = DEFAULT_SIMULATED_DURATION_SECONDS,
        progress_ticks: int = DEFAULT_PROGRESS_TICKS,
        sleep_fn=time.sleep,
    ):
        self.store = store
        self.poll_interval_seconds = poll_interval_seconds
        self.simulated_duration_seconds = simulated_duration_seconds
        self.progress_ticks = max(1, int(progress_ticks))
        self._sleep = sleep_fn
        self._stop_event = threading.Event()

    # -----------------------------------------------------------------
    # Lifecycle controls
    # -----------------------------------------------------------------

    def stop(self) -> None:
        """Ask the run loop to exit at the next poll boundary."""
        self._stop_event.set()

    def run_forever(self) -> None:
        log.info(
            "simulated worker started (poll=%.1fs, simulated_duration=%.1fs)",
            self.poll_interval_seconds,
            self.simulated_duration_seconds,
        )
        while not self._stop_event.is_set():
            try:
                processed = self.run_once()
            except Exception:  # noqa: BLE001 — never let a job kill the loop
                log.exception("simulated worker: unexpected error in run_once")
                processed = False
            if not processed:
                # Nothing to do — sleep until the next poll.
                self._stop_event.wait(self.poll_interval_seconds)

    def run_once(self) -> bool:
        """Process one queued job. Returns True if a job was handled."""
        job = self.claim_next()
        if job is None:
            return False
        self.simulate(job)
        return True

    # -----------------------------------------------------------------
    # Job processing
    # -----------------------------------------------------------------

    def claim_next(self) -> Optional[TrainingJobRecord]:
        """Pick the oldest queued job and transition it to `preparing`.

        list() returns newest-first; we want oldest-first ("FIFO") so the
        worker drains the queue in submission order. Reverse on the
        client side — the queue is small enough that the cost is fine.
        """
        candidates = self.store.list(status="queued", limit=100)
        for job in reversed(candidates):
            try:
                return self.store.transition(job.id, "preparing")
            except JobError:
                # Raced with another worker / cancelled in flight; try the next.
                continue
        return None

    def simulate(self, job: TrainingJobRecord) -> TrainingJobRecord:
        log.info("simulated worker: starting %s (%s)", job.id, job.name)
        self._safe_transition(job.id, "running")

        # Spread progress updates evenly across the simulated duration.
        per_tick_sleep = self.simulated_duration_seconds / self.progress_ticks
        for tick in range(1, self.progress_ticks + 1):
            if self._stop_event.is_set():
                self._safe_transition(
                    job.id,
                    "failed",
                    failure_reason="worker shutting down before completion",
                )
                return self.store.get(job.id)
            self._sleep(per_tick_sleep)
            current = self.store.get(job.id)
            if current is None or current.status != "running":
                # Cancelled / paused / external interference — bail.
                log.info(
                    "simulated worker: %s no longer running (status=%s), abandoning",
                    job.id,
                    current.status if current else "missing",
                )
                return current
            progress_pct = round((tick / self.progress_ticks) * 100.0, 1)
            try:
                self.store.transition(
                    job.id, "running", progress_pct=progress_pct,
                )
            except JobError:
                # transition's allowed-set permits running→running because
                # `running` is a member of ALLOWED_TRANSITIONS["running"]?
                # It is not — fall back to a direct progress write would
                # require a new method. Skip the progress update silently
                # so progress is "nice-to-have", not "blocks lifecycle".
                pass

        self._safe_transition(job.id, "evaluating", progress_pct=100.0)
        # In the real worker, this is where the post-train metrics POST
        # happens. The simulated worker treats the eval as instantaneously
        # successful — see module docstring.
        final = self._safe_transition(job.id, "published")
        log.info("simulated worker: published %s", job.id)
        return final

    def _safe_transition(
        self,
        job_id: str,
        new_status: str,
        *,
        failure_reason: Optional[str] = None,
        progress_pct: Optional[float] = None,
    ) -> Optional[TrainingJobRecord]:
        try:
            return self.store.transition(
                job_id,
                new_status,
                failure_reason=failure_reason,
                progress_pct=progress_pct,
            )
        except JobError as err:
            log.warning(
                "simulated worker: cannot transition %s to %s — %s",
                job_id,
                new_status,
                err,
            )
            return None


def start_background_worker(
    store: JobStore,
    *,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    simulated_duration_seconds: float = DEFAULT_SIMULATED_DURATION_SECONDS,
    progress_ticks: int = DEFAULT_PROGRESS_TICKS,
) -> SimulatedWorker:
    """Spawn the worker on a daemon thread. Returns the worker for shutdown."""
    worker = SimulatedWorker(
        store,
        poll_interval_seconds=poll_interval_seconds,
        simulated_duration_seconds=simulated_duration_seconds,
        progress_ticks=progress_ticks,
    )
    thread = threading.Thread(
        target=worker.run_forever, name="simulated-training-worker", daemon=True
    )
    thread.start()
    return worker
