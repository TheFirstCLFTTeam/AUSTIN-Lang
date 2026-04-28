"""Tests for `POST /jobs/{job_id}/script` and the script_storage helpers.

Coverage:
    - script_storage validation gates (size cap, declared MIME, extension,
      magic-byte sniff, empty body, traversal-safe filename)
    - JobStore.attach_script (queued only, idempotent re-attach)
    - end-to-end via TestClient: happy path, oversized 413, wrong MIME 415,
      wrong extension 415, binary content 415, empty 400, missing job 404,
      job-not-queued 409, re-upload replaces prior content on disk and
      updates the row.
"""
from __future__ import annotations

import importlib
import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import script_storage  # noqa: E402
from script_storage import (  # noqa: E402
    DEFAULT_MAX_SCRIPT_BYTES,
    ScriptRejected,
    looks_like_python,
    store_script,
)
from storage import JobError, JobStore  # noqa: E402


# ---------------------------------------------------------------------------
# Pure-function tests — no FastAPI, no DB
# ---------------------------------------------------------------------------

def test_looks_like_python_accepts_canonical_train_script():
    body = b"#!/usr/bin/env python\nimport torch\n\ndef main():\n    pass\n"
    assert looks_like_python(body) is True


def test_looks_like_python_accepts_module_docstring_first():
    body = b'"""train.py - fine-tunes whisper."""\nimport torch\n'
    assert looks_like_python(body) is True


def test_looks_like_python_rejects_binary():
    # Random bytes with a null — every binary container has these.
    body = b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 100
    assert looks_like_python(body) is False


def test_looks_like_python_rejects_empty():
    assert looks_like_python(b"") is False


def test_looks_like_python_rejects_invalid_utf8():
    # Lone continuation byte — invalid UTF-8.
    assert looks_like_python(b"\xff\xfe def foo(): pass") is False


def test_store_script_happy_path(tmp_path):
    body = b"import torch\n\ndef main():\n    pass\n"
    result = store_script(
        job_id="job-abc",
        filename="train.py",
        declared_mime="text/x-python",
        raw_bytes=body,
        script_dir=tmp_path,
    )
    assert result.size_bytes == len(body)
    assert result.filename == "train.py"
    assert len(result.sha256) == 64
    on_disk = Path(result.on_disk_path)
    assert on_disk.is_file()
    assert on_disk.read_bytes() == body


def test_store_script_strips_path_traversal(tmp_path):
    body = b"import torch\n"
    # Client-supplied filename tries to escape the per-job dir.
    result = store_script(
        job_id="job-abc",
        filename="../../etc/passwd.py",
        declared_mime="text/x-python",
        raw_bytes=body,
        script_dir=tmp_path,
    )
    on_disk = Path(result.on_disk_path)
    # On disk is canonical `script.py` under the per-job dir — never at
    # /etc/passwd. The traversal-stripped client filename round-trips on
    # the StoredScript record (and ends up on the job row for display).
    assert on_disk.parent == tmp_path / "job-abc"
    assert on_disk.name == "script.py"
    assert result.filename == "passwd.py"


def test_store_script_size_cap(tmp_path):
    body = b"# " + b"a" * 100
    with pytest.raises(ScriptRejected) as exc:
        store_script(
            job_id="job-abc",
            filename="train.py",
            declared_mime="text/x-python",
            raw_bytes=body,
            script_dir=tmp_path,
            max_bytes=10,
        )
    assert exc.value.status_code == 413


def test_store_script_rejects_unknown_mime(tmp_path):
    body = b"import torch\n"
    with pytest.raises(ScriptRejected) as exc:
        store_script(
            job_id="job-abc",
            filename="train.py",
            declared_mime="application/zip",
            raw_bytes=body,
            script_dir=tmp_path,
        )
    assert exc.value.status_code == 415


def test_store_script_rejects_wrong_extension(tmp_path):
    body = b"import torch\n"
    with pytest.raises(ScriptRejected) as exc:
        store_script(
            job_id="job-abc",
            filename="train.sh",
            declared_mime="text/plain",
            raw_bytes=body,
            script_dir=tmp_path,
        )
    assert exc.value.status_code == 415


def test_store_script_rejects_binary_with_py_extension(tmp_path):
    body = b"\x00\x01\x02\x03" * 50  # null bytes — fails sniff
    with pytest.raises(ScriptRejected) as exc:
        store_script(
            job_id="job-abc",
            filename="train.py",
            declared_mime="text/plain",
            raw_bytes=body,
            script_dir=tmp_path,
        )
    assert exc.value.status_code == 415


def test_store_script_rejects_empty_body(tmp_path):
    with pytest.raises(ScriptRejected) as exc:
        store_script(
            job_id="job-abc",
            filename="train.py",
            declared_mime="text/x-python",
            raw_bytes=b"",
            script_dir=tmp_path,
        )
    assert exc.value.status_code == 400


def test_store_script_replaces_prior_content(tmp_path):
    first = b"import torch\n# v1\n"
    second = b"import torch\n# v2 - newer\n"
    a = store_script(
        job_id="job-abc",
        filename="train.py",
        declared_mime="text/x-python",
        raw_bytes=first,
        script_dir=tmp_path,
    )
    b = store_script(
        job_id="job-abc",
        filename="train.py",
        declared_mime="text/x-python",
        raw_bytes=second,
        script_dir=tmp_path,
    )
    assert a.on_disk_path == b.on_disk_path
    assert Path(b.on_disk_path).read_bytes() == second


def test_default_cap_matches_doc():
    # Sanity check: doc says 256 KB; module-level constant should agree.
    assert DEFAULT_MAX_SCRIPT_BYTES == 256 * 1024


# ---------------------------------------------------------------------------
# Storage layer
# ---------------------------------------------------------------------------

@pytest.fixture()
def store(tmp_path):
    return JobStore(db_path=str(tmp_path / "training.db"))


def _submitted(store):
    return store.submit(
        name="whisper-fin",
        submitted_by="u2",
        target="cloud",
        base_model="openai/whisper-large-v3-turbo",
        dataset_ref="u2@example.com/20260401T120000",
    )


def test_attach_script_happy_path(store):
    job = _submitted(store)
    updated = store.attach_script(
        job.id,
        filename="train.py",
        sha256="a" * 64,
        size_bytes=123,
    )
    assert updated.script_filename == "train.py"
    assert updated.script_sha256 == "a" * 64
    assert updated.script_size_bytes == 123
    assert updated.script_uploaded_at is not None


def test_attach_script_rejects_nonexistent(store):
    with pytest.raises(JobError) as exc:
        store.attach_script(
            "job-missing",
            filename="train.py",
            sha256="a" * 64,
            size_bytes=10,
        )
    assert exc.value.status_code == 404


def test_attach_script_rejects_after_run_starts(store):
    job = _submitted(store)
    store.transition(job.id, "preparing")
    with pytest.raises(JobError) as exc:
        store.attach_script(
            job.id,
            filename="train.py",
            sha256="a" * 64,
            size_bytes=10,
        )
    assert exc.value.status_code == 409


def test_attach_script_idempotent_while_queued(store):
    job = _submitted(store)
    store.attach_script(job.id, filename="v1.py", sha256="a" * 64, size_bytes=10)
    updated = store.attach_script(
        job.id, filename="v2.py", sha256="b" * 64, size_bytes=20,
    )
    assert updated.script_filename == "v2.py"
    assert updated.script_sha256 == "b" * 64


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAINING_DB_PATH", str(tmp_path / "training.db"))
    monkeypatch.setenv("TRAINING_SCRIPT_DIR", str(tmp_path / "scripts"))
    monkeypatch.setenv("WORKER_ENABLED", "false")
    import main
    importlib.reload(main)
    return TestClient(main.app), tmp_path


def _submit(client):
    payload = {
        "name": "whisper-fin",
        "submitted_by": "u2",
        "target": "cloud",
        "base_model": "openai/whisper-large-v3-turbo",
        "dataset_ref": "u2@example.com/20260401T120000",
    }
    res = client.post("/jobs", json=payload)
    assert res.status_code == 201, res.text
    return res.json()


def _multipart(name="train.py", content=b"import torch\n", mime="text/x-python"):
    return {"file": (name, io.BytesIO(content), mime)}


def test_upload_script_happy_path(client):
    c, tmp = client
    job = _submit(c)
    res = c.post(f"/jobs/{job['id']}/script", files=_multipart())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["job_id"] == job["id"]
    assert body["filename"] == "train.py"
    assert body["size_bytes"] == len(b"import torch\n")
    assert len(body["sha256"]) == 64

    # On disk under the per-job directory the env points at.
    on_disk = tmp / "scripts" / job["id"] / "script.py"
    assert on_disk.is_file()
    assert on_disk.read_bytes() == b"import torch\n"

    # Detail read shows the metadata.
    detail = c.get(f"/jobs/{job['id']}").json()
    assert detail["script_filename"] == "train.py"
    assert detail["script_sha256"] == body["sha256"]
    assert detail["script_size_bytes"] == body["size_bytes"]
    assert detail["script_uploaded_at"] is not None


def test_upload_script_oversize_413(client, monkeypatch):
    c, _ = client
    monkeypatch.setenv("MAX_SCRIPT_BYTES", "32")
    job = _submit(c)
    big = b"# " + b"a" * 200
    res = c.post(f"/jobs/{job['id']}/script", files=_multipart(content=big))
    assert res.status_code == 413
    assert "too large" in res.json()["detail"]


def test_upload_script_unknown_mime_415(client):
    c, _ = client
    job = _submit(c)
    res = c.post(
        f"/jobs/{job['id']}/script",
        files=_multipart(mime="application/zip"),
    )
    assert res.status_code == 415


def test_upload_script_wrong_extension_415(client):
    c, _ = client
    job = _submit(c)
    res = c.post(
        f"/jobs/{job['id']}/script",
        files=_multipart(name="train.sh"),
    )
    assert res.status_code == 415


def test_upload_script_binary_content_415(client):
    c, _ = client
    job = _submit(c)
    binary = b"\x7fELF\x02\x01\x01" + b"\x00" * 200
    res = c.post(
        f"/jobs/{job['id']}/script",
        files=_multipart(content=binary),
    )
    assert res.status_code == 415


def test_upload_script_empty_400(client):
    c, _ = client
    job = _submit(c)
    res = c.post(
        f"/jobs/{job['id']}/script",
        files=_multipart(content=b""),
    )
    assert res.status_code == 400


def test_upload_script_missing_job_404(client):
    c, _ = client
    res = c.post("/jobs/job-missing/script", files=_multipart())
    assert res.status_code == 404


def test_upload_script_after_running_409(client):
    c, _ = client
    job = _submit(c)
    # Drive past `queued` so the upload guard fires.
    c.post(f"/jobs/{job['id']}/transitions/preparing", json={})
    res = c.post(f"/jobs/{job['id']}/script", files=_multipart())
    assert res.status_code == 409


def test_upload_script_replaces_prior(client):
    c, tmp = client
    job = _submit(c)
    c.post(f"/jobs/{job['id']}/script", files=_multipart(content=b"# v1\nimport torch\n"))
    new_body = b"# v2 newer\nimport torch\n"
    res = c.post(
        f"/jobs/{job['id']}/script",
        files=_multipart(content=new_body),
    )
    assert res.status_code == 200

    on_disk = tmp / "scripts" / job["id"] / "script.py"
    assert b"v2" in on_disk.read_bytes()

    detail = c.get(f"/jobs/{job['id']}").json()
    assert detail["script_size_bytes"] == len(new_body)
