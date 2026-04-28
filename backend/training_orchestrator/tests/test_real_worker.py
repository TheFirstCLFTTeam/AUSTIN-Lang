"""Tests for the real (subprocess-driving) training worker.

Covers:
  - stdout parser maps Step-banner lines + HF Trainer progress lines onto
    the right state-machine transitions / progress updates;
  - subprocess lifecycle: a job goes queued → preparing → running →
    evaluating → published when the script exits 0;
  - non-zero exit → failed with the exit code in failure_reason;
  - cancel mid-run → SIGTERM the subprocess, transition recorded;
  - graceful-stop fallback to SIGKILL when the subprocess ignores SIGTERM;
  - update_progress no-ops on terminal jobs.

We don't actually shell out — `popen_fn` is replaced with a fake that
yields scripted stdout lines under test control.
"""
from __future__ import annotations

import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Iterator, List, Optional

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from real_worker import (
    PROGRESS_RE_LOSS_STEP,
    RealWorker,
    _parse_progress,
    _slug,
)
from storage import JobStore


# ── fakes ──────────────────────────────────────────────────────────────────


class _FakeStdout:
    """Iterable of scripted lines. readline() returns "" once exhausted to
    match real subprocess.PIPE EOF semantics."""

    def __init__(self, lines: List[str]):
        # Append a trailing "" so iter(readline, "") terminates.
        self._lines = list(lines) + [""]
        self._idx = 0

    def readline(self) -> str:
        if self._idx >= len(self._lines):
            return ""
        line = self._lines[self._idx]
        self._idx += 1
        return line


class _FakePopen:
    """Stand-in for subprocess.Popen. Honors terminate(), records calls."""

    def __init__(
        self,
        lines: List[str],
        *,
        returncode: int = 0,
        terminate_honors: bool = True,
        terminate_delay: float = 0.0,
    ):
        self.stdout = _FakeStdout(lines)
        self._returncode: Optional[int] = None
        self._final_returncode = returncode
        self._terminate_honors = terminate_honors
        self._terminate_delay = terminate_delay
        self.terminate_called = False
        self.kill_called = False

    def poll(self) -> Optional[int]:
        return self._returncode

    def wait(self, timeout: Optional[float] = None) -> int:
        if self._returncode is None:
            # If a timeout is set and we still haven't been told to exit
            # (terminate ignored, kill not yet called), simulate the
            # subprocess hanging — raise TimeoutExpired so the worker
            # escalates to SIGKILL.
            if timeout is not None and self.terminate_called and not self._terminate_honors:
                raise subprocess.TimeoutExpired(cmd="fake", timeout=timeout)
            # Otherwise the caller didn't terminate / kill — script ran
            # to completion.
            self._returncode = self._final_returncode
        return self._returncode

    def terminate(self) -> None:
        self.terminate_called = True
        if self._terminate_honors:
            # Simulate a script that exits SIGTERM-like (rc=143 in real
            # bash; we keep it explicit for tests).
            self._returncode = 143

    def kill(self) -> None:
        self.kill_called = True
        self._returncode = 137


def _make_popen_factory(popen):
    """Build a callable matching subprocess.Popen's signature that always
    returns the same fake instance. Lets the worker's existing call site
    (`self._popen([...], stdout=PIPE, ...)`) work unchanged."""
    def _popen_fn(*args, **kwargs):
        return popen
    return _popen_fn


# ── fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture()
def store(tmp_path):
    return JobStore(db_path=str(tmp_path / "training.db"))


def _submit(store, name="job"):
    return store.submit(
        name=name, submitted_by="u-larry", target="cloud",
        base_model="openai/whisper-large-v3-turbo",
        dataset_ref="u-larry/20260428T100000",
    )


def _worker(store, popen, *, log_dir: Path, sleep_fn=lambda _s: None):
    return RealWorker(
        store,
        script_path="/fake/cloud_train_sync.sh",
        working_dir="/fake",
        log_dir=str(log_dir),
        poll_interval_seconds=0.0,
        terminate_grace_seconds=0.0,
        sleep_fn=sleep_fn,
        popen_fn=_make_popen_factory(popen),
    )


# ── parser unit tests ─────────────────────────────────────────────────────


class TestProgressParser:
    def test_loss_step_format(self):
        # HF Trainer's `{'loss': 0.42, 'learning_rate': 1e-5} 12/100`
        line = "{'loss': 0.42, 'learning_rate': 1e-5} 12/100 [01:30<10:00,  1.5s/it]"
        assert _parse_progress(line) == 12.0

    def test_fraction_format_at_line_start(self):
        line = "  12/100 [01:30<10:00,  1.5s/it]"
        assert _parse_progress(line) == 12.0

    def test_no_match_returns_none(self):
        assert _parse_progress("Step 4: Starting Remote Training") is None
        assert _parse_progress("random log line") is None

    def test_zero_total_returns_none(self):
        assert _parse_progress("'loss': 0.4 5/0 [..]") is None

    def test_completion_is_100(self):
        line = "{'loss': 0.05} 100/100 [10:00<00:00]"
        assert _parse_progress(line) == 100.0


def test_slug_normalises_name():
    assert _slug("Whisper Large-v3 fin") == "whisper-large-v3-fin"
    assert _slug("  multi   spaces  ") == "multi-spaces"
    assert _slug("") == ""


# ── lifecycle: happy path ─────────────────────────────────────────────────


HAPPY_PATH_STDOUT = [
    "Step 1: Preparing data on local server...\n",
    "Step 2: Packaging entire retraining pipeline (excluding adapters)...\n",
    "Step 3: Uploading pipeline to Cloud GPU...\n",
    "Step 4: Starting Remote Training...\n",
    "{'loss': 0.42, 'learning_rate': 1e-5} 25/100 [01:00<03:00, 1.0s/it]\n",
    "{'loss': 0.31, 'learning_rate': 1e-5} 50/100 [02:00<02:00, 1.0s/it]\n",
    "{'loss': 0.18, 'learning_rate': 1e-5} 100/100 [04:00<00:00, 1.0s/it]\n",
    "Step 5: Downloading trained adapters and logs...\n",
    "COMPLETE! Adapter saved to: backend/retraining-pipeline/adapters/myrun\n",
]


def test_happy_path_drives_full_lifecycle(store, tmp_path):
    job = _submit(store, "happy")
    popen = _FakePopen(HAPPY_PATH_STDOUT, returncode=0)
    worker = _worker(store, popen, log_dir=tmp_path)

    handled = worker.run_once()
    assert handled is True

    final = store.get(job.id)
    assert final.status == "published"
    assert final.progress_pct == 100.0
    assert final.started_at is not None
    assert final.finished_at is not None
    assert popen.terminate_called is False
    assert popen.kill_called is False


def test_happy_path_writes_log_file(store, tmp_path):
    job = _submit(store, "logs")
    popen = _FakePopen(HAPPY_PATH_STDOUT, returncode=0)
    worker = _worker(store, popen, log_dir=tmp_path)
    worker.run_once()

    log_path = tmp_path / f"{job.id}.log"
    assert log_path.exists()
    contents = log_path.read_text(encoding="utf-8")
    assert "Step 4" in contents
    assert "COMPLETE!" in contents


def test_progress_updates_recorded_during_running(store, tmp_path):
    job = _submit(store, "progress")
    # Inject scripted stdout in pieces so we can inspect intermediate state
    # by claiming the job, transitioning to running, then directly invoking
    # _handle_line — the integration test above proves the full flow.
    popen = _FakePopen([], returncode=0)
    worker = _worker(store, popen, log_dir=tmp_path)
    store.transition(job.id, "preparing")
    store.transition(job.id, "running")

    worker._handle_line(job.id, "{'loss': 0.42} 25/100 [..]")
    assert store.get(job.id).progress_pct == 25.0

    worker._handle_line(job.id, "{'loss': 0.20} 75/100 [..]")
    assert store.get(job.id).progress_pct == 75.0


# ── lifecycle: failure ────────────────────────────────────────────────────


def test_non_zero_exit_marks_job_failed(store, tmp_path):
    job = _submit(store, "fail")
    stdout = HAPPY_PATH_STDOUT[:5]  # cut off mid-training
    popen = _FakePopen(stdout, returncode=42)
    worker = _worker(store, popen, log_dir=tmp_path)

    worker.run_once()

    final = store.get(job.id)
    assert final.status == "failed"
    assert final.failure_reason is not None
    assert "42" in final.failure_reason


def test_missing_script_marks_job_failed(store, tmp_path):
    job = _submit(store, "no-script")

    def _raise_fnf(*args, **kwargs):
        raise FileNotFoundError("/fake/cloud_train_sync.sh")

    worker = RealWorker(
        store,
        script_path="/fake/cloud_train_sync.sh",
        working_dir="/fake",
        log_dir=str(tmp_path),
        poll_interval_seconds=0.0,
        terminate_grace_seconds=0.0,
        sleep_fn=lambda _s: None,
        popen_fn=_raise_fnf,
    )
    worker.run_once()

    final = store.get(job.id)
    assert final.status == "failed"
    assert "not found" in (final.failure_reason or "")


# ── lifecycle: cancel ─────────────────────────────────────────────────────


def test_cancel_mid_run_terminates_subprocess(store, tmp_path):
    job = _submit(store, "cancellable")

    # Build a stdout sequence where the worker sees one running marker and
    # then one progress line — between consuming those, we'll cancel.
    stdout = [
        "Step 4: Starting Remote Training...\n",
        "{'loss': 0.5} 10/100 [..]\n",   # never read — cancel kicks in first
        "{'loss': 0.4} 20/100 [..]\n",
    ]
    popen = _FakePopen(stdout, terminate_honors=True)
    worker = _worker(store, popen, log_dir=tmp_path)

    # Patch readline so the second call cancels the job before reading.
    real_readline = popen.stdout.readline
    call_count = {"n": 0}

    def cancelling_readline():
        call_count["n"] += 1
        if call_count["n"] == 2:
            # Worker already advanced to "running" on the first line;
            # running → cancelled is an allowed transition.
            store.transition(job.id, "cancelled")
        return real_readline()

    popen.stdout.readline = cancelling_readline

    worker.run_once()

    assert popen.terminate_called is True
    final = store.get(job.id)
    assert final.status == "cancelled"


def test_kill_falls_back_when_terminate_ignored(store, tmp_path):
    job = _submit(store, "stubborn")
    # Need a Step-4 line so the worker advances to "running" before we
    # cancel — running → cancelled is the legal transition.
    popen = _FakePopen(
        [
            "Step 4: Starting Remote Training...\n",
            "{'loss': 0.5} 5/10 [..]\n",
        ],
        terminate_honors=False,
        returncode=0,
    )
    worker = _worker(store, popen, log_dir=tmp_path)

    real_readline = popen.stdout.readline
    seen = {"n": 0}

    def cancelling_readline():
        seen["n"] += 1
        if seen["n"] == 2:
            store.transition(job.id, "cancelled")
        return real_readline()

    popen.stdout.readline = cancelling_readline

    worker.run_once()

    assert popen.terminate_called is True
    assert popen.kill_called is True


# ── update_progress edge cases ────────────────────────────────────────────


def test_update_progress_noops_on_terminal_job(store):
    job = _submit(store, "terminal")
    store.transition(job.id, "preparing")
    store.transition(job.id, "running")
    store.transition(job.id, "evaluating")
    store.transition(job.id, "published")

    # No-op: status stays published, progress_pct unchanged.
    snapshot = store.get(job.id)
    result = store.update_progress(job.id, 99.9)
    assert result.status == "published"
    assert result.progress_pct == snapshot.progress_pct


def test_update_progress_writes_when_running(store):
    job = _submit(store, "live")
    store.transition(job.id, "preparing")
    store.transition(job.id, "running")
    store.update_progress(job.id, 42.5)
    assert store.get(job.id).progress_pct == 42.5
