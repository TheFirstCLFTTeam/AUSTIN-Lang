"""Tests for the inference fan-out (§3.1 #2): manifest_loader's
None-vs-empty distinction, the inference_client helper module, and
the /evaluations/run integration with the requests-mocked TS-2
upstream.
"""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from inference_client import (  # noqa: E402
    InferenceFanoutError,
    fan_out,
    split_samples_needing_inference,
)
from manifest_loader import load_manifest  # noqa: E402
from strategies.base import Sample  # noqa: E402


# ---------------------------------------------------------------------------
# Manifest loader — None-vs-empty distinction
# ---------------------------------------------------------------------------

def _write(tmp_path, lines):
    p = tmp_path / "manifest.jsonl"
    p.write_text("\n".join(json.dumps(d) for d in lines), encoding="utf-8")
    return str(p)


def test_manifest_missing_hypothesis_yields_none(tmp_path):
    path = _write(tmp_path, [
        {"reference": "hello", "audio_path": "/a.wav"},
    ])
    samples = load_manifest(path)
    assert samples[0].hypothesis is None


def test_manifest_explicit_empty_hypothesis_stays_empty(tmp_path):
    path = _write(tmp_path, [
        {"reference": "hello", "hypothesis": "", "audio_path": "/a.wav"},
    ])
    samples = load_manifest(path)
    # Empty string is "model produced silence" — distinct from None
    # (manifest didn't supply, fan out).
    assert samples[0].hypothesis == ""


def test_manifest_explicit_null_hypothesis_yields_none(tmp_path):
    path = _write(tmp_path, [
        {"reference": "hello", "hypothesis": None, "audio_path": "/a.wav"},
    ])
    samples = load_manifest(path)
    assert samples[0].hypothesis is None


# ---------------------------------------------------------------------------
# split_samples_needing_inference
# ---------------------------------------------------------------------------

def test_split_separates_none_from_have():
    samples = [
        Sample(reference="a", hypothesis="prediction-a"),
        Sample(reference="b", hypothesis=None, audio_path="/b.wav"),
        Sample(reference="c", hypothesis="", audio_path="/c.wav"),  # explicit empty
    ]
    have, need = split_samples_needing_inference(samples)
    assert len(have) == 2
    assert len(need) == 1
    assert need[0].reference == "b"


def test_split_rejects_missing_audio_path_when_hypothesis_missing():
    samples = [Sample(reference="a", hypothesis=None)]
    with pytest.raises(InferenceFanoutError) as exc:
        split_samples_needing_inference(samples)
    assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# fan_out (with mocked HTTP)
# ---------------------------------------------------------------------------

def _ok_response(text="hello world"):
    response = MagicMock()
    response.ok = True
    response.status_code = 200
    response.json.return_value = {"text": text}
    return response


def _err_response(status=502):
    response = MagicMock()
    response.ok = False
    response.status_code = status
    response.json.return_value = {"detail": "bad"}
    return response


def test_fan_out_returns_predictions_keyed_by_audio_path(tmp_path):
    a = tmp_path / "a.wav"
    b = tmp_path / "b.wav"
    a.write_bytes(b"fake audio a")
    b.write_bytes(b"fake audio b")

    def _by_path(*args, **kwargs):
        files = kwargs.get("files") or args[1] if len(args) > 1 else {}
        # The mocked POST receives an opened file; just return a stable
        # response. Caller doesn't depend on per-request differentiation.
        return _ok_response("predicted")

    with patch("inference_client.requests.post", side_effect=_by_path):
        result = fan_out(
            [str(a), str(b)],
            adapter_name="lora-x",
            base_url="http://ts2:8005",
            concurrency=2,
        )
    assert set(result.keys()) == {str(a), str(b)}
    assert all(v == "predicted" for v in result.values())


def test_fan_out_skips_missing_files(tmp_path):
    real = tmp_path / "real.wav"
    real.write_bytes(b"audio")
    ghost = str(tmp_path / "ghost.wav")  # never created

    with patch("inference_client.requests.post",
               return_value=_ok_response("ok")) as post:
        result = fan_out(
            [str(real), ghost],
            base_url="http://ts2:8005",
            concurrency=1,
        )
    # Only one HTTP call (the real file); ghost is None without a
    # network request.
    assert post.call_count == 1
    assert result[str(real)] == "ok"
    assert result[ghost] is None


def test_fan_out_isolates_per_clip_failures(tmp_path):
    a = tmp_path / "a.wav"
    b = tmp_path / "b.wav"
    a.write_bytes(b"a")
    b.write_bytes(b"b")

    call_count = {"n": 0}

    def _flaky(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return _err_response(502)
        return _ok_response("recovered")

    with patch("inference_client.requests.post", side_effect=_flaky):
        result = fan_out(
            [str(a), str(b)],
            base_url="http://ts2:8005",
            concurrency=1,
        )
    # One success + one failure — failure leaves None, success populates.
    failures = [k for k, v in result.items() if v is None]
    successes = [k for k, v in result.items() if v == "recovered"]
    assert len(failures) == 1
    assert len(successes) == 1


def test_fan_out_dedupes_repeated_audio_paths(tmp_path):
    a = tmp_path / "a.wav"
    a.write_bytes(b"a")
    with patch("inference_client.requests.post",
               return_value=_ok_response("ok")) as post:
        result = fan_out(
            [str(a), str(a), str(a)],
            base_url="http://ts2:8005",
            concurrency=1,
        )
    assert post.call_count == 1
    assert result[str(a)] == "ok"


def test_fan_out_passes_adapter_as_domain(tmp_path):
    a = tmp_path / "a.wav"
    a.write_bytes(b"a")
    captured = {}

    def _capture(*args, **kwargs):
        captured["data"] = kwargs.get("data") or {}
        return _ok_response("ok")

    with patch("inference_client.requests.post", side_effect=_capture):
        fan_out(
            [str(a)], adapter_name="lora-fin",
            base_url="http://ts2:8005", concurrency=1,
        )
    assert captured["data"]["domain"] == "lora-fin"


def test_fan_out_uses_base_when_no_adapter(tmp_path):
    a = tmp_path / "a.wav"
    a.write_bytes(b"a")
    captured = {}

    def _capture(*args, **kwargs):
        captured["data"] = kwargs.get("data") or {}
        return _ok_response("ok")

    with patch("inference_client.requests.post", side_effect=_capture):
        fan_out(
            [str(a)], adapter_name=None,
            base_url="http://ts2:8005", concurrency=1,
        )
    assert captured["data"]["domain"] == "base"


def test_fan_out_empty_input_short_circuits():
    """No HTTP, no thread pool, returns empty dict."""
    with patch("inference_client.requests.post") as post:
        result = fan_out([], base_url="http://ts2:8005")
    post.assert_not_called()
    assert result == {}


# ---------------------------------------------------------------------------
# /evaluations/run integration — fan-out triggers when needed
# ---------------------------------------------------------------------------

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("METRICS_DB_PATH", str(tmp_path / "metrics.db"))
    monkeypatch.setenv("SEED_ON_BOOT", "false")
    monkeypatch.setenv("ADAPTERS_DIR", str(tmp_path / "adapters"))
    Path(tmp_path / "adapters").mkdir(exist_ok=True)
    import main
    importlib.reload(main)
    from fastapi.testclient import TestClient
    return TestClient(main.app), tmp_path


def _write_manifest_with_audio(tmp_path, rows):
    """Create a tmp .wav per row whose audio_path points at a real
    file — the fan-out's `is_file()` check needs this."""
    out_lines = []
    for i, row in enumerate(rows):
        if "audio_path" in row and row["audio_path"]:
            ap = Path(row["audio_path"])
            ap.parent.mkdir(parents=True, exist_ok=True)
            ap.write_bytes(b"fake audio")
        out_lines.append(row)
    p = tmp_path / "manifest.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in out_lines), encoding="utf-8")
    return str(p)


def test_run_evaluation_skips_fan_out_when_all_hypotheses_present(client):
    c, tmp = client
    manifest = _write_manifest_with_audio(tmp, [
        {"reference": "hello", "hypothesis": "hello"},
        {"reference": "world", "hypothesis": "world"},
    ])
    with patch("inference_client.requests.post") as post:
        res = c.post("/evaluations/run", json={
            "adapter_name": "lora-a",
            "dataset_name": "default_eval",
            "manifest_path": manifest,
            "strategies": ["wer"],
            "base_model": "openai/whisper-large-v3-turbo",
        })
    assert res.status_code == 200
    post.assert_not_called()
    body = res.json()
    assert "fanout" not in (body.get("notes") or "")


def test_run_evaluation_fans_out_for_missing_hypotheses(client):
    c, tmp = client
    audio_a = str(tmp / "audio" / "a.wav")
    audio_b = str(tmp / "audio" / "b.wav")
    manifest = _write_manifest_with_audio(tmp, [
        {"reference": "alpha", "audio_path": audio_a},
        {"reference": "bravo", "audio_path": audio_b},
    ])

    def _ok(*args, **kwargs):
        return _ok_response("predicted")

    with patch("inference_client.requests.post", side_effect=_ok) as post:
        res = c.post("/evaluations/run", json={
            "adapter_name": "lora-a",
            "dataset_name": "default_eval",
            "manifest_path": manifest,
            "strategies": ["wer"],
            "base_model": "openai/whisper-large-v3-turbo",
        })
    assert res.status_code == 200
    assert post.call_count == 2
    body = res.json()
    assert "fanout: 2 clips" in body["notes"]


def test_run_evaluation_400s_when_sample_lacks_both_hypothesis_and_audio(client):
    c, tmp = client
    manifest = _write_manifest_with_audio(tmp, [
        {"reference": "alpha"},  # no hypothesis, no audio_path
    ])
    res = c.post("/evaluations/run", json={
        "adapter_name": "lora-a",
        "dataset_name": "default_eval",
        "manifest_path": manifest,
        "strategies": ["wer"],
        "base_model": "openai/whisper-large-v3-turbo",
    })
    assert res.status_code == 400
    assert "audio_path" in res.json()["detail"]


def test_run_evaluation_records_fanout_failures_in_notes(client):
    c, tmp = client
    audio_a = str(tmp / "audio" / "a.wav")
    audio_b = str(tmp / "audio" / "b.wav")
    manifest = _write_manifest_with_audio(tmp, [
        {"reference": "alpha", "audio_path": audio_a},
        {"reference": "bravo", "audio_path": audio_b},
    ])
    state = {"calls": 0}

    def _flaky(*args, **kwargs):
        state["calls"] += 1
        return _ok_response("ok") if state["calls"] == 1 else _err_response(502)

    with patch("inference_client.requests.post", side_effect=_flaky):
        res = c.post("/evaluations/run", json={
            "adapter_name": "lora-a",
            "dataset_name": "default_eval",
            "manifest_path": manifest,
            "strategies": ["wer"],
            "base_model": "openai/whisper-large-v3-turbo",
        })
    body = res.json()
    assert "fanout: 2 clips inferred, 1 failed" in body["notes"]


def test_run_evaluation_partial_mix(client):
    """Some clips have predictions, some don't — only the empty ones fan out."""
    c, tmp = client
    audio_b = str(tmp / "audio" / "b.wav")
    manifest = _write_manifest_with_audio(tmp, [
        {"reference": "alpha", "hypothesis": "alpha-pred"},
        {"reference": "bravo", "audio_path": audio_b},
    ])
    with patch("inference_client.requests.post",
               return_value=_ok_response("ok")) as post:
        res = c.post("/evaluations/run", json={
            "adapter_name": "lora-a",
            "dataset_name": "default_eval",
            "manifest_path": manifest,
            "strategies": ["wer"],
            "base_model": "openai/whisper-large-v3-turbo",
        })
    assert post.call_count == 1
    body = res.json()
    assert "fanout: 1 clips" in body["notes"]
