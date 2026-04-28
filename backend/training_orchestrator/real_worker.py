"""Real training worker — invokes cloud_train_sync.sh as a subprocess.

Mirrors the public shape of SimulatedWorker (claim_next / run_once /
run_forever / stop) so main.py can swap workers behind WORKER_MODE
without orchestrator API changes.

The script itself is the existing
`backend/retraining-pipeline/cloud_train_sync.sh`, which packages the
pipeline and SSHes to a GPU box for the actual training. This worker
records the orchestrator state machine while that subprocess runs;
the heavy lifting happens off-host.

Cancel semantics: terminate-on-cancel. Cancellation polls the JobStore
state between each stdout line; on a state flip to `cancelled` we
SIGTERM the subprocess, give it 10 s to exit gracefully, then SIGKILL.

Spec / decisions: docs/07 Integration CAA 27APR2026/training-job-pipeline.md §6.
- Q1: CLI-driven, orchestrator records state. (Open question, slice 1 default.)
- Trust boundary: orchestrator container holds the SSH key. Acceptable
  for the dev/staging path; harden when prod ops re-wire to a control VM.
- Cancel: terminate-on-cancel (this file).
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from storage import JobError, JobStore, TrainingJobRecord


log = logging.getLogger(__name__)


DEFAULT_POLL_INTERVAL_SECONDS = 2.0
DEFAULT_TERMINATE_GRACE_SECONDS = 10.0
DEFAULT_LOG_DIR = "/app/data/logs"


# ── Stdout markers ─────────────────────────────────────────────────────────
#
# cloud_train_sync.sh prints a sequence of "Step N:" banner lines that map
# cleanly onto the orchestrator's state machine. The HF Trainer also prints
# its `{"loss": ..., "step": ...}` dicts on every logging step — we use
# those for fine-grained progress.
#
# Anchor on substring matches not exact equality so colour codes / shell
# prefixes don't break us.

STATE_MARKERS = [
    # Tar + scp finishes; remote training begins. Marks running.
    (re.compile(r"Step\s*4\s*:\s*Starting Remote Training", re.IGNORECASE), "running"),
    # Adapter download begins on the local side; training is done.
    (re.compile(r"Step\s*5\s*:\s*Downloading", re.IGNORECASE), "evaluating"),
]

# HF Trainer logs progress as either a JSON-ish dict or a "step/total" line.
# Anchor on `'loss':` so we don't mis-match other dict-shaped output, and
# pull `(step, total)` from the trainer's own progress format.
PROGRESS_RE_LOSS_STEP = re.compile(
    r"'loss'\s*:\s*[\d.eE+-]+.*?(\d+)\s*/\s*(\d+)"
)
# Fallback shape: `123/450 [05:32<10:45,  2.3s/it]`.
PROGRESS_RE_FRACTION = re.compile(r"^\s*(\d+)\s*/\s*(\d+)\s*[\[(]")


@dataclass
class JobInvocation:
    """Concrete inputs for a single subprocess run."""
    script_path: str
    working_dir: str
    env: dict[str, str]
    log_path: str


class RealWorker:
    def __init__(
        self,
        store: JobStore,
        *,
        script_path: str,
        working_dir: str,
        log_dir: str = DEFAULT_LOG_DIR,
        poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
        terminate_grace_seconds: float = DEFAULT_TERMINATE_GRACE_SECONDS,
        sleep_fn=time.sleep,
        # Indirection so tests can swap subprocess.Popen.
        popen_fn=subprocess.Popen,
    ):
        self.store = store
        self.script_path = script_path
        self.working_dir = working_dir
        self.log_dir = log_dir
        self.poll_interval_seconds = poll_interval_seconds
        self.terminate_grace_seconds = terminate_grace_seconds
        self._sleep = sleep_fn
        self._popen = popen_fn
        self._stop_event = threading.Event()
        Path(self.log_dir).mkdir(parents=True, exist_ok=True)

    # -----------------------------------------------------------------
    # Lifecycle (mirrors SimulatedWorker)
    # -----------------------------------------------------------------

    def stop(self) -> None:
        self._stop_event.set()

    def run_forever(self) -> None:
        log.info(
            "real worker started (script=%s, cwd=%s, poll=%.1fs)",
            self.script_path, self.working_dir, self.poll_interval_seconds,
        )
        while not self._stop_event.is_set():
            try:
                processed = self.run_once()
            except Exception:  # noqa: BLE001 — never let a job kill the loop
                log.exception("real worker: unexpected error in run_once")
                processed = False
            if not processed:
                self._stop_event.wait(self.poll_interval_seconds)

    def run_once(self) -> bool:
        job = self.claim_next()
        if job is None:
            return False
        self.process(job)
        return True

    def claim_next(self) -> Optional[TrainingJobRecord]:
        candidates = self.store.list(status="queued", limit=100)
        for job in reversed(candidates):  # oldest-first, matches SimulatedWorker
            try:
                return self.store.transition(job.id, "preparing")
            except JobError:
                continue
        return None

    # -----------------------------------------------------------------
    # Per-job processing
    # -----------------------------------------------------------------

    def process(self, job: TrainingJobRecord) -> Optional[TrainingJobRecord]:
        invocation = self._build_invocation(job)
        log.info("real worker: launching %s (script=%s)", job.id, invocation.script_path)

        try:
            proc = self._popen(
                ["bash", invocation.script_path],
                cwd=invocation.working_dir,
                env=invocation.env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError as err:
            self._safe_transition(
                job.id, "failed",
                failure_reason=f"script not found: {err}",
            )
            return self.store.get(job.id)

        try:
            with open(invocation.log_path, "a", encoding="utf-8") as log_file:
                self._consume_stdout(job.id, proc, log_file)

            rc = proc.wait()
            if self._was_cancelled(job.id):
                # Terminal state already recorded by the cancel path.
                return self.store.get(job.id)
            if rc != 0:
                self._safe_transition(
                    job.id, "failed",
                    failure_reason=f"cloud_train_sync.sh exited {rc}",
                )
                return self.store.get(job.id)

            # Happy path. The script's own post_train_hook in train.py
            # already POSTs to metrics-service; the orchestrator only
            # records the lifecycle here.
            self._safe_transition(job.id, "evaluating", progress_pct=100.0)
            return self._safe_transition(job.id, "published")
        finally:
            # Belt-and-braces: if anything in the consume loop raised,
            # make sure we don't leave a zombie subprocess.
            if proc.poll() is None:
                self._kill(proc)

    def _consume_stdout(self, job_id: str, proc, log_file) -> None:
        """Read subprocess stdout line-by-line, mirror to disk, drive the
        state machine. Polls cancellation between each line."""
        for raw_line in iter(proc.stdout.readline, ""):
            line = raw_line.rstrip("\n")
            log_file.write(raw_line)
            log_file.flush()

            self._handle_line(job_id, line)

            if self._was_cancelled(job_id):
                log.info("real worker: cancellation requested for %s — terminating", job_id)
                self._kill(proc)
                return

    def _handle_line(self, job_id: str, line: str) -> None:
        # State transitions take priority over progress updates — a single
        # line of output is unlikely to satisfy both, but if it does,
        # transitioning is the more important signal.
        for pattern, target in STATE_MARKERS:
            if pattern.search(line):
                self._safe_transition(job_id, target)
                return

        progress = _parse_progress(line)
        if progress is not None:
            try:
                self.store.update_progress(job_id, progress)
            except JobError:
                # Job is terminal — silently ignore so a late stdout line
                # can't corrupt the record.
                pass

    # -----------------------------------------------------------------
    # Cancellation
    # -----------------------------------------------------------------

    def _was_cancelled(self, job_id: str) -> bool:
        record = self.store.get(job_id)
        return record is not None and record.status == "cancelled"

    def _kill(self, proc) -> None:
        """SIGTERM → wait `terminate_grace_seconds` → SIGKILL."""
        if proc.poll() is not None:
            return
        try:
            proc.terminate()
        except Exception:  # noqa: BLE001
            log.exception("real worker: terminate() failed")
        try:
            proc.wait(timeout=self.terminate_grace_seconds)
            return
        except subprocess.TimeoutExpired:
            pass
        log.warning("real worker: subprocess didn't exit within %.1fs, killing",
                    self.terminate_grace_seconds)
        try:
            proc.kill()
            proc.wait(timeout=self.terminate_grace_seconds)
        except Exception:  # noqa: BLE001
            log.exception("real worker: kill() failed — leaking subprocess")

    # -----------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------

    def _build_invocation(self, job: TrainingJobRecord) -> JobInvocation:
        # Inherit the parent process env (PATH, SSH agent, etc.), then
        # layer the per-job env_json on top so the script + train.py
        # see the right ADAPTER_NAME / MANIFEST_NAME / etc.
        env = dict(os.environ)
        for k, v in (job.env or {}).items():
            env[str(k)] = str(v)
        # Useful defaults so a freshly-submitted job has somewhere to
        # write artifacts even if env_json doesn't carry them.
        env.setdefault("ADAPTER_NAME", _slug(job.name) or job.id)
        env.setdefault("BASE_MODEL", job.base_model or "")
        env.setdefault("DATASET_REF", job.dataset_ref or "")

        log_path = str(Path(self.log_dir) / f"{job.id}.log")
        return JobInvocation(
            script_path=self.script_path,
            working_dir=self.working_dir,
            env=env,
            log_path=log_path,
        )

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
                job_id, new_status,
                failure_reason=failure_reason, progress_pct=progress_pct,
            )
        except JobError as err:
            log.warning(
                "real worker: cannot transition %s to %s — %s",
                job_id, new_status, err,
            )
            return None


# ── Module-level helpers ───────────────────────────────────────────────────

def _parse_progress(line: str) -> Optional[float]:
    """Return progress as a percentage (0..100) when the line carries
    one, else None. Pure for ease of unit testing."""
    m = PROGRESS_RE_LOSS_STEP.search(line)
    if m is None:
        m = PROGRESS_RE_FRACTION.search(line)
    if m is None:
        return None
    step, total = int(m.group(1)), int(m.group(2))
    if total <= 0:
        return None
    return round(100.0 * step / total, 1)


def _slug(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", (name or "").strip()).strip("-").lower()


def start_real_worker(
    store: JobStore,
    *,
    script_path: str,
    working_dir: str,
    log_dir: str = DEFAULT_LOG_DIR,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
) -> RealWorker:
    worker = RealWorker(
        store,
        script_path=script_path,
        working_dir=working_dir,
        log_dir=log_dir,
        poll_interval_seconds=poll_interval_seconds,
    )
    thread = threading.Thread(
        target=worker.run_forever, name="real-training-worker", daemon=True,
    )
    thread.start()
    return worker
