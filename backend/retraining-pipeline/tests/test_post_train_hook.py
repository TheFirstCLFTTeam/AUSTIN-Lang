import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
import requests

# Pull the helper from the parent dir without requiring an installed package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from post_train_hook import post_train_evaluate  # noqa: E402


def _write_adapter(tmp_path, name="fypaudio", base_model="openai/whisper-large-v3-turbo"):
    adapter_dir = tmp_path / name
    adapter_dir.mkdir(parents=True)
    if base_model is not None:
        (adapter_dir / "adapter_config.json").write_text(
            json.dumps({"base_model_name_or_path": base_model, "r": 8}),
            encoding="utf-8",
        )
    return adapter_dir


def _write_manifest(tmp_path, name="manifest.jsonl"):
    path = tmp_path / name
    path.write_text(
        json.dumps({"reference": "hello", "hypothesis": "hello"}) + "\n",
        encoding="utf-8",
    )
    return str(path)


def _ok_response(payload=None):
    response = MagicMock()
    response.ok = True
    response.status_code = 200
    response.json.return_value = payload or {"id": 42}
    return response


def test_skips_when_metrics_url_unset(tmp_path, monkeypatch):
    monkeypatch.delenv("METRICS_SERVICE_URL", raising=False)
    adapter_dir = _write_adapter(tmp_path)
    manifest = _write_manifest(tmp_path)

    with patch("post_train_hook.requests.post") as post:
        ok = post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="fypaudio",
            manifest_path=manifest,
        )
    assert ok is False
    post.assert_not_called()


def test_baseline_refresh_call_fires_before_adapter_run(tmp_path):
    """When refresh_baseline=True (default), the hook hits
    /evaluations/baseline first, then /evaluations/run for the
    adapter."""
    adapter_dir = _write_adapter(tmp_path)
    manifest = _write_manifest(tmp_path)

    calls = []

    def _fake_post(url, json=None, timeout=None):
        calls.append((url, json))
        return _ok_response({"id": 7, "skipped": False})

    with patch("post_train_hook.requests.post", side_effect=_fake_post):
        ok = post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="fypaudio",
            manifest_path=manifest,
            metrics_service_url="http://metrics:8006",
        )
    assert ok is True
    # Two calls: baseline then run, in that order.
    assert len(calls) == 2
    assert calls[0][0].endswith("/evaluations/baseline")
    assert calls[1][0].endswith("/evaluations/run")


def test_refresh_baseline_false_skips_baseline_call(tmp_path):
    adapter_dir = _write_adapter(tmp_path)
    manifest = _write_manifest(tmp_path)

    calls = []

    def _fake_post(url, json=None, timeout=None):
        calls.append(url)
        return _ok_response({"id": 7})

    with patch("post_train_hook.requests.post", side_effect=_fake_post):
        post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="fypaudio",
            manifest_path=manifest,
            metrics_service_url="http://metrics:8006",
            refresh_baseline=False,
        )
    assert len(calls) == 1
    assert calls[0].endswith("/evaluations/run")


def test_baseline_refresh_failure_does_not_block_adapter_run(tmp_path):
    """A flaky baseline call must not stop the adapter eval — that's the
    fail-soft contract documented in the hook docstring."""
    adapter_dir = _write_adapter(tmp_path)
    manifest = _write_manifest(tmp_path)

    def _fake_post(url, json=None, timeout=None):
        if "baseline" in url:
            raise requests.ConnectionError("baseline upstream down")
        return _ok_response({"id": 7})

    with patch("post_train_hook.requests.post", side_effect=_fake_post):
        ok = post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="fypaudio",
            manifest_path=manifest,
            metrics_service_url="http://metrics:8006",
        )
    assert ok is True


def test_baseline_skipped_response_is_logged_at_info(tmp_path, caplog):
    """When the baseline endpoint short-circuits (fresh row), the hook
    should log an INFO line acknowledging the skip — not WARNING."""
    adapter_dir = _write_adapter(tmp_path)
    manifest = _write_manifest(tmp_path)

    def _fake_post(url, json=None, timeout=None):
        if "baseline" in url:
            return _ok_response({
                "skipped": True,
                "evaluation_id": 99,
                "age_days": 3.5,
                "reason": "within window",
            })
        return _ok_response({"id": 7})

    import logging
    with caplog.at_level(logging.INFO, logger="post_train_hook"):
        with patch("post_train_hook.requests.post", side_effect=_fake_post):
            post_train_evaluate(
                adapter_dir=str(adapter_dir),
                adapter_name="fypaudio",
                manifest_path=manifest,
                metrics_service_url="http://metrics:8006",
            )
    skip_log = [r for r in caplog.records if "baseline skipped" in r.message]
    assert skip_log, f"expected 'baseline skipped' log line, got {[r.message for r in caplog.records]}"


def test_skips_when_adapter_config_missing(tmp_path):
    adapter_dir = tmp_path / "anon"
    adapter_dir.mkdir()
    manifest = _write_manifest(tmp_path)

    with patch("post_train_hook.requests.post") as post:
        ok = post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="anon",
            manifest_path=manifest,
            metrics_service_url="http://metrics:8006",
        )
    assert ok is False
    post.assert_not_called()


def test_skips_when_base_model_field_missing(tmp_path):
    adapter_dir = tmp_path / "anon"
    adapter_dir.mkdir()
    (adapter_dir / "adapter_config.json").write_text(json.dumps({"r": 8}), encoding="utf-8")
    manifest = _write_manifest(tmp_path)

    with patch("post_train_hook.requests.post") as post:
        ok = post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="anon",
            manifest_path=manifest,
            metrics_service_url="http://metrics:8006",
        )
    assert ok is False
    post.assert_not_called()


def test_skips_when_manifest_missing(tmp_path, monkeypatch):
    monkeypatch.delenv("EVAL_MANIFEST_PATH", raising=False)
    adapter_dir = _write_adapter(tmp_path)

    with patch("post_train_hook.requests.post") as post:
        ok = post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="fypaudio",
            metrics_service_url="http://metrics:8006",
        )
    assert ok is False
    post.assert_not_called()


def test_posts_expected_payload(tmp_path):
    adapter_dir = _write_adapter(tmp_path)
    manifest = _write_manifest(tmp_path)

    with patch("post_train_hook.requests.post", return_value=_ok_response()) as post:
        ok = post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="fypaudio",
            manifest_path=manifest,
            metrics_service_url="http://metrics:8006/",
            adapter_version="abc123",
            refresh_baseline=False,
        )

    assert ok is True
    post.assert_called_once()
    args, kwargs = post.call_args
    assert args[0] == "http://metrics:8006/evaluations/run"
    body = kwargs["json"]
    assert body["adapter_name"] == "fypaudio"
    assert body["base_model"] == "openai/whisper-large-v3-turbo"
    assert body["dataset_name"] == "default_eval"
    assert body["manifest_path"] == manifest
    assert body["strategies"] == ["f1"]
    assert body["adapter_version"] == "abc123"
    assert kwargs["timeout"] == 10


def test_uses_env_overrides(tmp_path, monkeypatch):
    adapter_dir = _write_adapter(tmp_path)
    manifest = _write_manifest(tmp_path, "from-env.jsonl")
    monkeypatch.setenv("METRICS_SERVICE_URL", "http://metrics:8006")
    monkeypatch.setenv("EVAL_DATASET_NAME", "spgispeech-holdout")
    monkeypatch.setenv("EVAL_MANIFEST_PATH", manifest)

    with patch("post_train_hook.requests.post", return_value=_ok_response()) as post:
        ok = post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="fypaudio",
        )

    assert ok is True
    body = post.call_args.kwargs["json"]
    assert body["dataset_name"] == "spgispeech-holdout"
    assert body["manifest_path"] == manifest


def test_failure_to_connect_is_swallowed(tmp_path):
    adapter_dir = _write_adapter(tmp_path)
    manifest = _write_manifest(tmp_path)

    with patch(
        "post_train_hook.requests.post",
        side_effect=requests.ConnectionError("metrics down"),
    ):
        ok = post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="fypaudio",
            manifest_path=manifest,
            metrics_service_url="http://metrics:8006",
        )
    assert ok is False  # logged, not raised


def test_non_2xx_response_is_swallowed(tmp_path):
    adapter_dir = _write_adapter(tmp_path)
    manifest = _write_manifest(tmp_path)

    bad_response = MagicMock()
    bad_response.ok = False
    bad_response.status_code = 502
    bad_response.text = "upstream error"

    with patch("post_train_hook.requests.post", return_value=bad_response):
        ok = post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="fypaudio",
            manifest_path=manifest,
            metrics_service_url="http://metrics:8006",
        )
    assert ok is False


def test_explicit_args_override_env(tmp_path, monkeypatch):
    adapter_dir = _write_adapter(tmp_path)
    explicit_manifest = _write_manifest(tmp_path, "explicit.jsonl")
    env_manifest = _write_manifest(tmp_path, "from-env.jsonl")
    monkeypatch.setenv("METRICS_SERVICE_URL", "http://from-env:1234")
    monkeypatch.setenv("EVAL_DATASET_NAME", "from-env-dataset")
    monkeypatch.setenv("EVAL_MANIFEST_PATH", env_manifest)

    with patch("post_train_hook.requests.post", return_value=_ok_response()) as post:
        post_train_evaluate(
            adapter_dir=str(adapter_dir),
            adapter_name="fypaudio",
            metrics_service_url="http://explicit:9999",
            manifest_path=explicit_manifest,
            dataset_name="explicit-dataset",
            strategies=["f1", "wer"],
        )
    args, kwargs = post.call_args
    assert args[0].startswith("http://explicit:9999")
    body = kwargs["json"]
    assert body["manifest_path"] == explicit_manifest
    assert body["dataset_name"] == "explicit-dataset"
    assert body["strategies"] == ["f1", "wer"]
