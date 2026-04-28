"""SSE generator coverage. We drive the generator by hand (calling
`next()` on it) so we can interleave fake stdout writes + state changes
with each yield, then assert the emitted SSE strings.

The generator's sleep + monotonic clock are injected so a test can run
in real time (just calls), and the file system is real (tmp_path)
because file-tail behaviour is what we're trying to verify.
"""
import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sse import _format_event, stream_job_events
from storage import JobStore


@pytest.fixture()
def store(tmp_path):
    return JobStore(db_path=str(tmp_path / "training.db"))


@pytest.fixture()
def log_dir(tmp_path):
    d = tmp_path / "logs"
    d.mkdir()
    return d


def _submit(store, name="job"):
    return store.submit(
        name=name,
        submitted_by="u2",
        target="cloud",
        base_model="openai/whisper-large-v3-turbo",
        dataset_ref="u2/20260401T120000",
    )


def _drain(gen):
    """Consume a generator with a no-op sleep, return list of yielded strings."""
    out = []
    for chunk in gen:
        out.append(chunk)
    return out


def _events_only(chunks):
    """Filter heartbeat comments + return [(name, payload), ...]."""
    out = []
    for chunk in chunks:
        if chunk.startswith(":"):
            continue
        # SSE format: 'event: name\ndata: {...}\n\n'
        lines = chunk.strip().split("\n")
        name = next(l[len("event: "):] for l in lines if l.startswith("event: "))
        data_str = next(l[len("data: "):] for l in lines if l.startswith("data: "))
        out.append((name, json.loads(data_str)))
    return out


# ---------------------------------------------------------------------------


def test_format_event_shape():
    s = _format_event("log", {"line": "hi", "ts": "2026-04-28T10:00:00Z"})
    assert s.startswith("event: log\n")
    assert "data: " in s
    assert s.endswith("\n\n")


def test_unknown_job_emits_error_and_returns(store, log_dir):
    gen = stream_job_events(
        store, "ghost-id", log_dir=str(log_dir),
        sleep_fn=lambda _s: None, now_fn=lambda: 0.0,
    )
    events = _events_only(_drain(gen))
    assert events == [("error", {"detail": "job 'ghost-id' not found"})]


def test_terminal_at_start_emits_state_then_end(store, log_dir):
    job = _submit(store)
    # Drive the job all the way to terminal before the SSE opens.
    store.transition(job.id, "preparing")
    store.transition(job.id, "running")
    store.transition(job.id, "evaluating")
    store.transition(job.id, "published")

    # No log file exists. The wait loop should bail when it sees the
    # terminal state.
    gen = stream_job_events(
        store, job.id, log_dir=str(log_dir),
        log_wait_seconds=0.5, tail_poll_seconds=0.01,
        sleep_fn=lambda _s: None, now_fn=lambda: 0.0,
    )
    events = _events_only(_drain(gen))
    names = [n for n, _ in events]
    assert names[0] == "state"
    assert events[0][1]["status"] == "published"
    assert names[-1] == "end"
    assert events[-1][1] == {"status": "published"}


def test_replays_existing_log_then_emits_end(store, log_dir):
    job = _submit(store)
    store.transition(job.id, "preparing")
    store.transition(job.id, "running")

    # Pre-populate the log file with two lines.
    log_path = log_dir / f"{job.id}.log"
    log_path.write_text("Step 1: prepping\nStep 4: Starting Remote Training\n", encoding="utf-8")

    # Advance to terminal so the generator returns.
    store.transition(job.id, "evaluating")
    store.transition(job.id, "published")

    # Use injected fake clock that never increments → no heartbeat fires.
    gen = stream_job_events(
        store, job.id, log_dir=str(log_dir),
        tail_poll_seconds=0.0, state_poll_seconds=0.0,
        sleep_fn=lambda _s: None, now_fn=lambda: 0.0,
    )
    events = _events_only(_drain(gen))
    log_lines = [p["line"] for n, p in events if n == "log"]
    assert log_lines == ["Step 1: prepping", "Step 4: Starting Remote Training"]
    assert events[-1][0] == "end"


def test_state_change_emits_when_transition_fires(store, log_dir):
    job = _submit(store)
    store.transition(job.id, "preparing")

    # Track what the test wants the store to look like at each generator
    # tick. We monkey-patch sleep to advance state on call N.
    tick = {"n": 0}
    def fake_sleep(_s):
        tick["n"] += 1
        if tick["n"] == 2:
            store.transition(job.id, "running", progress_pct=50.0)
        if tick["n"] == 4:
            store.transition(job.id, "evaluating", progress_pct=100.0)
        if tick["n"] == 5:
            store.transition(job.id, "published")

    # Monotonic clock that always advances enough to clear the state-poll
    # threshold on each tick.
    counter = {"t": 0.0}
    def fake_now():
        counter["t"] += 5.0
        return counter["t"]

    gen = stream_job_events(
        store, job.id, log_dir=str(log_dir),
        log_wait_seconds=0.0,
        tail_poll_seconds=0.01, state_poll_seconds=0.0,
        heartbeat_seconds=999.0,  # disable heartbeats for clean assertion
        sleep_fn=fake_sleep, now_fn=fake_now,
    )
    events = _events_only(_drain(gen))
    statuses = [p["status"] for n, p in events if n == "state"]
    assert statuses == ["preparing", "running", "evaluating", "published"]
    assert events[-1][0] == "end"
    assert events[-1][1] == {"status": "published"}


def test_failure_state_propagates_in_end_event(store, log_dir):
    job = _submit(store)
    store.transition(job.id, "preparing")
    store.transition(job.id, "running")
    store.transition(job.id, "failed", failure_reason="OOM")

    gen = stream_job_events(
        store, job.id, log_dir=str(log_dir),
        log_wait_seconds=0.0,
        tail_poll_seconds=0.0, state_poll_seconds=0.0,
        sleep_fn=lambda _s: None, now_fn=lambda: 0.0,
    )
    events = _events_only(_drain(gen))
    end = events[-1]
    assert end[0] == "end"
    assert end[1] == {"status": "failed"}
    failed_state = next(p for n, p in events if n == "state" and p["status"] == "failed")
    assert failed_state["failure_reason"] == "OOM"


def test_heartbeat_fires_when_idle(store, log_dir):
    """When neither logs nor state move, the generator should emit a
    heartbeat comment so HTTP proxies don't time out."""
    job = _submit(store)
    store.transition(job.id, "preparing")
    store.transition(job.id, "running")

    # Fake clock that advances 30s per tick — well past the default
    # heartbeat threshold.
    counter = {"t": 0.0}
    def fake_now():
        counter["t"] += 30.0
        return counter["t"]

    tick = {"n": 0}
    def fake_sleep(_s):
        tick["n"] += 1
        # After 5 ticks, advance to terminal so the generator returns.
        if tick["n"] == 5:
            store.transition(job.id, "evaluating")
            store.transition(job.id, "published")

    gen = stream_job_events(
        store, job.id, log_dir=str(log_dir),
        log_wait_seconds=0.0,
        tail_poll_seconds=0.01,
        state_poll_seconds=999.0,  # disable state polling for clean assertion
        heartbeat_seconds=15.0,
        sleep_fn=fake_sleep, now_fn=fake_now,
    )
    chunks = _drain(gen)
    heartbeats = [c for c in chunks if c.startswith(":")]
    # We saw at least one heartbeat between ticks 1-4 before the terminal
    # transition fired on tick 5.
    assert len(heartbeats) >= 1
