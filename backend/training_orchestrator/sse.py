"""SSE event stream for a single training job.

Replays the existing log file (so a late-joining browser sees the run-so-
far), then tails new log lines as the worker writes them and emits state-
transition events as `JobStore.transition` advances the job's status.
Closes when the job hits a terminal state (`published` / `cancelled` /
`failed`).

Two parallel signals on one stream — distinguished by SSE event names:

    event: log
    data: {"line": "Step 4: Starting Remote Training", "ts": "..."}

    event: state
    data: {"status": "running", "progress_pct": 45.0, ...}

    event: end
    data: {"status": "published"}

Plus periodic heartbeat comments (`: heartbeat\n\n`) every 15 s so HTTP
proxies don't time the connection out during long quiet stretches in
training.
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Generator, Optional

from storage import JobStore, TrainingJobRecord


log = logging.getLogger(__name__)


DEFAULT_TAIL_POLL_INTERVAL_SECONDS = 0.5
DEFAULT_STATE_POLL_INTERVAL_SECONDS = 1.0
DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 15.0
DEFAULT_LOG_WAIT_SECONDS = 60.0  # how long to wait for a log file to appear

TERMINAL_STATES = {"published", "cancelled", "failed"}


def _state_payload(rec: TrainingJobRecord) -> dict:
    return {
        "status": rec.status,
        "progress_pct": rec.progress_pct,
        "started_at": rec.started_at,
        "finished_at": rec.finished_at,
        "failure_reason": rec.failure_reason,
    }


def _format_event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, default=str)}\n\n"


def stream_job_events(
    store: JobStore,
    job_id: str,
    *,
    log_dir: str,
    tail_poll_seconds: float = DEFAULT_TAIL_POLL_INTERVAL_SECONDS,
    state_poll_seconds: float = DEFAULT_STATE_POLL_INTERVAL_SECONDS,
    heartbeat_seconds: float = DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    log_wait_seconds: float = DEFAULT_LOG_WAIT_SECONDS,
    sleep_fn=time.sleep,
    now_fn=time.monotonic,
) -> Generator[str, None, None]:
    """Yield SSE-formatted strings until the job hits a terminal state.

    Pure generator — wired into FastAPI's `StreamingResponse` by the
    route handler. Sleep + clock are injected so tests can drive without
    real time.
    """
    rec = store.get(job_id)
    if rec is None:
        # Emit a single error event + close. The route handler upgrades
        # this to a 404 path before we get here, but be defensive.
        yield _format_event("error", {"detail": f"job {job_id!r} not found"})
        return

    log_path = Path(log_dir) / f"{job_id}.log"

    # Initial state snapshot.
    last_state = _state_payload(rec)
    yield _format_event("state", last_state)

    # Wait briefly for the log file to appear if the job is still queued
    # / preparing — the worker creates it on first stdout flush.
    waited_for_log = 0.0
    while not log_path.exists() and waited_for_log < log_wait_seconds:
        # If the job already finished without producing logs (e.g. claim
        # → fail before the worker spawned), bail rather than wait the
        # full 60 s.
        rec = store.get(job_id)
        if rec and rec.status in TERMINAL_STATES:
            yield _format_event("end", {"status": rec.status})
            return
        sleep_fn(tail_poll_seconds)
        waited_for_log += tail_poll_seconds

    fh = log_path.open("r", encoding="utf-8", errors="replace") if log_path.exists() else None

    last_state_check = now_fn()
    last_heartbeat = now_fn()

    try:
        while True:
            # 1. Log lines — drain whatever's available.
            if fh is not None:
                while True:
                    line = fh.readline()
                    if not line:
                        break
                    yield _format_event("log", {
                        "line": line.rstrip("\n"),
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    })
                    last_heartbeat = now_fn()  # log = activity; reset heartbeat

            # 2. State changes — poll every state_poll_seconds.
            now = now_fn()
            if (now - last_state_check) >= state_poll_seconds:
                rec = store.get(job_id)
                if rec is None:
                    yield _format_event("error", {"detail": "job vanished"})
                    return
                current = _state_payload(rec)
                if current != last_state:
                    yield _format_event("state", current)
                    last_state = current
                    last_heartbeat = now
                if rec.status in TERMINAL_STATES:
                    # One last drain of any tail that arrived between the
                    # last readline and now, then close.
                    if fh is not None:
                        while True:
                            line = fh.readline()
                            if not line:
                                break
                            yield _format_event("log", {
                                "line": line.rstrip("\n"),
                                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                            })
                    yield _format_event("end", {"status": rec.status})
                    return
                last_state_check = now

            # 3. Heartbeat — keep the connection warm for HTTP proxies.
            if (now - last_heartbeat) >= heartbeat_seconds:
                yield ": heartbeat\n\n"
                last_heartbeat = now

            # 4. Log file might have appeared after the initial wait
            #    (e.g. job moved from queued → preparing during the loop).
            if fh is None and log_path.exists():
                fh = log_path.open("r", encoding="utf-8", errors="replace")

            sleep_fn(tail_poll_seconds)
    finally:
        if fh is not None:
            try:
                fh.close()
            except Exception:  # noqa: BLE001
                pass
