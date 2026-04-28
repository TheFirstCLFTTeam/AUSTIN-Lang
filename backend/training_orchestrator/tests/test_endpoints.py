import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAINING_DB_PATH", str(tmp_path / "training.db"))
    # Reload main so the module-level `store = JobStore()` picks up the env.
    import importlib
    import main
    importlib.reload(main)
    return TestClient(main.app)


def _payload(**overrides):
    body = {
        "name": "whisper-fin-q2",
        "submitted_by": "u2",
        "target": "cloud",
        "base_model": "openai/whisper-large-v3-turbo",
        "dataset_ref": "u2@example.com/20260401T120000",
        "env": {"LORA": "1", "EPOCHS": "3"},
    }
    body.update(overrides)
    return body


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "healthy"}


def test_submit_job_returns_201_with_record(client):
    res = client.post("/jobs", json=_payload())
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "queued"
    assert body["id"].startswith("job-")
    assert body["env"] == {"LORA": "1", "EPOCHS": "3"}


def test_submit_validation_error_400(client):
    res = client.post("/jobs", json=_payload(target="moon"))
    assert res.status_code == 400
    assert "target must be one of" in res.json()["detail"]


def test_submit_federated_returns_501(client):
    res = client.post("/jobs", json=_payload(target="federated", fl_enabled=True))
    assert res.status_code == 501
    assert "F25" in res.json()["detail"]


def test_get_job_404(client):
    res = client.get("/jobs/job-missing")
    assert res.status_code == 404


def test_list_filters(client):
    client.post("/jobs", json=_payload(name="a", submitted_by="u2"))
    client.post("/jobs", json=_payload(name="b", submitted_by="u3"))
    res = client.get("/jobs", params={"submitter": "u2"})
    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 1
    assert rows[0]["name"] == "a"


def test_cancel_endpoint(client):
    submitted = client.post("/jobs", json=_payload()).json()
    res = client.post(f"/jobs/{submitted['id']}/cancel")
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"
    # Cancelling twice is a 409 (terminal state).
    again = client.post(f"/jobs/{submitted['id']}/cancel")
    assert again.status_code == 409


def test_transition_lifecycle_sequence(client):
    submitted = client.post("/jobs", json=_payload()).json()
    job_id = submitted["id"]

    for step in ("preparing", "running", "evaluating", "published"):
        res = client.post(f"/jobs/{job_id}/transitions/{step}", json={})
        assert res.status_code == 200, res.text
        assert res.json()["status"] == step

    job = client.get(f"/jobs/{job_id}").json()
    assert job["status"] == "published"
    assert job["started_at"] is not None
    assert job["finished_at"] is not None


def test_transition_illegal_jump_returns_409(client):
    submitted = client.post("/jobs", json=_payload()).json()
    res = client.post(
        f"/jobs/{submitted['id']}/transitions/published", json={}
    )
    assert res.status_code == 409
