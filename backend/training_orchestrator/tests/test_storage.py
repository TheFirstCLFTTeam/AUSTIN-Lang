import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from storage import JobError, JobStore, TERMINAL_STATES


@pytest.fixture()
def store(tmp_path):
    return JobStore(db_path=str(tmp_path / "training.db"))


def _submit(store, **overrides):
    payload = dict(
        name="whisper-fin-q2",
        submitted_by="u2",
        target="cloud",
        base_model="openai/whisper-large-v3-turbo",
        dataset_ref="u2@example.com/20260401T120000",
        env={"LORA": "1", "EPOCHS": "3"},
    )
    payload.update(overrides)
    return store.submit(**payload)


# ---------------------------------------------------------------------------
# submit
# ---------------------------------------------------------------------------

def test_submit_returns_queued_record(store):
    record = _submit(store)
    assert record.id.startswith("job-")
    assert record.status == "queued"
    assert record.name == "whisper-fin-q2"
    assert record.submitted_by == "u2"
    assert record.target == "cloud"
    assert record.base_model == "openai/whisper-large-v3-turbo"
    assert record.env == {"LORA": "1", "EPOCHS": "3"}
    assert record.data_zone == "green"
    assert record.fl_enabled is False
    assert record.dp_enabled is False
    assert record.progress_pct is None
    assert record.started_at is None
    assert record.finished_at is None


def test_submit_persists_for_get(store):
    record = _submit(store)
    fetched = store.get(record.id)
    assert fetched is not None
    assert fetched.id == record.id
    assert fetched.env == {"LORA": "1", "EPOCHS": "3"}


def test_submit_rejects_blank_name(store):
    with pytest.raises(JobError, match="non-empty"):
        _submit(store, name="   ")


def test_submit_rejects_invalid_target(store):
    with pytest.raises(JobError, match="target must be one of"):
        _submit(store, target="moon-base")


def test_submit_rejects_invalid_data_zone(store):
    with pytest.raises(JobError, match="data_zone must be one of"):
        _submit(store, data_zone="orange")


def test_submit_federated_target_requires_fl_enabled(store):
    with pytest.raises(JobError, match="target='federated' requires fl_enabled"):
        _submit(store, target="federated", fl_enabled=False)


def test_submit_federated_blocked_on_framework_adr(store):
    with pytest.raises(JobError) as exc:
        _submit(store, target="federated", fl_enabled=True)
    assert exc.value.status_code == 501
    assert "F25" in str(exc.value)


def test_submit_generates_unique_ids(store):
    a = _submit(store)
    b = _submit(store)
    assert a.id != b.id


# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------

def test_list_orders_newest_first(store):
    older = _submit(store, name="older")
    newer = _submit(store, name="newer")
    rows = store.list()
    assert [r.id for r in rows[:2]] == [newer.id, older.id]


def test_list_filters_by_submitter(store):
    _submit(store, submitted_by="u2", name="mine")
    _submit(store, submitted_by="u3", name="theirs")
    rows = store.list(submitter="u2")
    assert len(rows) == 1
    assert rows[0].name == "mine"


def test_list_filters_by_status(store):
    a = _submit(store)
    _submit(store)
    store.transition(a.id, "preparing")
    queued = store.list(status="queued")
    preparing = store.list(status="preparing")
    assert len(queued) == 1
    assert len(preparing) == 1
    assert preparing[0].id == a.id


# ---------------------------------------------------------------------------
# transitions
# ---------------------------------------------------------------------------

def test_happy_path_through_state_machine(store):
    job = _submit(store)
    job = store.transition(job.id, "preparing")
    assert job.status == "preparing"
    assert job.started_at is None
    job = store.transition(job.id, "running")
    assert job.status == "running"
    assert job.started_at is not None
    job = store.transition(job.id, "evaluating")
    assert job.status == "evaluating"
    job = store.transition(job.id, "published")
    assert job.status == "published"
    assert job.finished_at is not None


def test_transition_rejects_illegal_jump(store):
    job = _submit(store)
    with pytest.raises(JobError) as exc:
        store.transition(job.id, "published")
    assert exc.value.status_code == 409
    assert "queued" in str(exc.value) and "published" in str(exc.value)


def test_transition_rejects_from_terminal(store):
    job = _submit(store)
    job = store.transition(job.id, "cancelled")
    assert job.status == "cancelled"
    with pytest.raises(JobError) as exc:
        store.transition(job.id, "running")
    assert exc.value.status_code == 409


def test_transition_unknown_id_404s(store):
    with pytest.raises(JobError) as exc:
        store.transition("job-missing", "preparing")
    assert exc.value.status_code == 404


def test_failure_reason_persists(store):
    job = _submit(store)
    job = store.transition(job.id, "preparing")
    job = store.transition(job.id, "failed", failure_reason="OOM at step 142")
    assert job.failure_reason == "OOM at step 142"
    assert job.finished_at is not None


def test_progress_pct_persists(store):
    job = _submit(store)
    store.transition(job.id, "preparing")
    job = store.transition(job.id, "running", progress_pct=12.5)
    assert job.progress_pct == 12.5
    job = store.transition(job.id, "evaluating", progress_pct=100.0)
    assert job.progress_pct == 100.0


def test_cancel_helper_short_circuit(store):
    job = _submit(store)
    job = store.cancel(job.id)
    assert job.status == "cancelled"
    assert job.finished_at is not None


def test_init_schema_is_idempotent(tmp_path):
    db = str(tmp_path / "training.db")
    s1 = JobStore(db_path=db)
    s1.submit(
        name="job", submitted_by="u2", target="cloud",
        base_model="openai/whisper-large-v3-turbo",
        dataset_ref="u2/20260401T120000",
    )
    s2 = JobStore(db_path=db)
    assert len(s2.list()) == 1


def test_terminal_states_constant_intersect():
    # Sanity: every terminal state has no outgoing transitions in the table.
    from storage import ALLOWED_TRANSITIONS
    for state in TERMINAL_STATES:
        assert ALLOWED_TRANSITIONS[state] == set()
