import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from storage import JobStore
from worker import SimulatedWorker


@pytest.fixture()
def store(tmp_path):
    return JobStore(db_path=str(tmp_path / "training.db"))


@pytest.fixture()
def fast_worker(store):
    """Worker with sleep stubbed out — runs the state machine instantly."""
    return SimulatedWorker(
        store,
        poll_interval_seconds=0.0,
        simulated_duration_seconds=0.0,
        progress_ticks=3,
        sleep_fn=lambda _s: None,
    )


def _submit(store, name="job"):
    return store.submit(
        name=name, submitted_by="u2", target="cloud",
        base_model="openai/whisper-large-v3-turbo",
        dataset_ref="u2/20260401T120000",
    )


# ---------------------------------------------------------------------------
# claim_next
# ---------------------------------------------------------------------------

def test_claim_next_returns_none_when_empty(fast_worker):
    assert fast_worker.claim_next() is None


def test_claim_next_picks_oldest_queued_first(store, fast_worker):
    older = _submit(store, name="older")
    _submit(store, name="newer")
    claimed = fast_worker.claim_next()
    assert claimed is not None
    assert claimed.id == older.id
    assert claimed.status == "preparing"


def test_claim_next_skips_non_queued(store, fast_worker):
    job = _submit(store)
    store.transition(job.id, "preparing")
    store.transition(job.id, "running")
    assert fast_worker.claim_next() is None


# ---------------------------------------------------------------------------
# simulate (full lifecycle)
# ---------------------------------------------------------------------------

def test_simulate_drives_job_to_published(store, fast_worker):
    job = _submit(store)
    fast_worker.simulate(store.transition(job.id, "preparing"))
    final = store.get(job.id)
    assert final.status == "published"
    assert final.started_at is not None
    assert final.finished_at is not None


def test_simulate_writes_progress_through_running(store):
    progress_seen = []
    sleep_fn = lambda _s: progress_seen.append(store.get(job.id).progress_pct)

    worker = SimulatedWorker(
        store,
        poll_interval_seconds=0.0,
        simulated_duration_seconds=0.0,
        progress_ticks=4,
        sleep_fn=sleep_fn,
    )
    job = _submit(store)
    worker.simulate(store.transition(job.id, "preparing"))
    # First tick fires before any progress write — progress_pct is None.
    # Subsequent ticks should reflect monotonically-increasing percentages.
    monotonic = [p for p in progress_seen if p is not None]
    assert monotonic == sorted(monotonic)
    assert store.get(job.id).progress_pct == 100.0


def test_simulate_bails_if_job_cancelled_mid_run(store):
    # When the job is cancelled out from under the worker, simulate stops
    # progressing it and returns the current record without crashing.
    job = _submit(store)
    job = store.transition(job.id, "preparing")

    cancelled = {"done": False}

    def sleep_fn(_s):
        # simulate() already transitioned preparing → running on entry, so
        # we just cancel from here (running → cancelled is a legal transition).
        if not cancelled["done"]:
            cancelled["done"] = True
            store.cancel(job.id)

    worker = SimulatedWorker(
        store, poll_interval_seconds=0.0,
        simulated_duration_seconds=0.0, progress_ticks=3,
        sleep_fn=sleep_fn,
    )
    worker.simulate(job)
    assert store.get(job.id).status == "cancelled"


# ---------------------------------------------------------------------------
# run_once / run_forever
# ---------------------------------------------------------------------------

def test_run_once_returns_true_when_job_handled(store, fast_worker):
    _submit(store)
    assert fast_worker.run_once() is True
    assert store.get(store.list()[0].id).status == "published"


def test_run_once_returns_false_when_empty(fast_worker):
    assert fast_worker.run_once() is False


def test_run_forever_processes_jobs_then_stops(store):
    _submit(store, name="a")
    _submit(store, name="b")
    worker = SimulatedWorker(
        store,
        poll_interval_seconds=0.01,
        simulated_duration_seconds=0.0,
        progress_ticks=2,
        sleep_fn=lambda _s: None,
    )

    # Run a few iterations manually then stop. Avoids spinning a thread
    # in the test for determinism.
    for _ in range(5):
        worker.run_once()
    worker.stop()

    rows = store.list()
    assert all(r.status == "published" for r in rows), [r.status for r in rows]


def test_run_once_swallows_errors(store, monkeypatch, fast_worker):
    """If something explodes mid-job, the loop must not die."""
    _submit(store)

    def boom(*a, **kw):
        raise RuntimeError("boom")

    monkeypatch.setattr(fast_worker, "simulate", boom)

    # Calling via run_once propagates (it doesn't catch) — the catch is in
    # run_forever. Verify run_forever loop handles the raise.
    fast_worker._stop_event.set()  # exit after first iteration

    # Should not raise even though simulate explodes.
    fast_worker.run_forever()
