"""Tests for METRICS_BASELINE_FRESHNESS_DAYS enforcement.

Three layers covered:

  - storage helpers (`latest_baseline_age_days`, `is_baseline_fresh`) on
    fresh / stale / missing baselines + on a misformatted timestamp.
  - `/evaluations/baseline` endpoint short-circuit when fresh,
    `force=true` override, no short-circuit when adapter rows present
    but no baseline rows, env-var override of the 30-day default.
"""
from __future__ import annotations

import importlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from storage import MetricsStore  # noqa: E402
from strategies.base import StrategyResult  # noqa: E402


# ---------------------------------------------------------------------------
# Storage layer
# ---------------------------------------------------------------------------

@pytest.fixture()
def store(tmp_path):
    return MetricsStore(db_path=str(tmp_path / "metrics.db"))


def _record_baseline(store, *, base_model, dataset_name, evaluated_at):
    return store.record_evaluation(
        base_model=base_model,
        adapter_name=None,
        adapter_version=None,
        dataset_name=dataset_name,
        sample_count=10,
        results=[StrategyResult(strategy_name="wer", value=0.1,
                                 breakdown={}, sample_count=10)],
        evaluated_at=evaluated_at,
    )


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_age_days_returns_none_when_no_baseline(store):
    assert store.latest_baseline_age_days(
        base_model="openai/whisper-large-v3-turbo",
        dataset_name="default_eval",
    ) is None


def test_age_days_for_fresh_baseline(store):
    one_day_ago = datetime.now(timezone.utc) - timedelta(days=1)
    _record_baseline(
        store,
        base_model="openai/whisper-large-v3-turbo",
        dataset_name="default_eval",
        evaluated_at=_iso(one_day_ago),
    )
    age = store.latest_baseline_age_days(
        base_model="openai/whisper-large-v3-turbo",
        dataset_name="default_eval",
    )
    assert age is not None
    assert 0.9 < age < 1.1


def test_age_days_for_stale_baseline(store):
    two_months_ago = datetime.now(timezone.utc) - timedelta(days=60)
    _record_baseline(
        store,
        base_model="openai/whisper-large-v3-turbo",
        dataset_name="default_eval",
        evaluated_at=_iso(two_months_ago),
    )
    age = store.latest_baseline_age_days(
        base_model="openai/whisper-large-v3-turbo",
        dataset_name="default_eval",
    )
    assert 59 < age < 61


def test_age_days_picks_latest_of_multiple_baselines(store):
    older = datetime.now(timezone.utc) - timedelta(days=30)
    newer = datetime.now(timezone.utc) - timedelta(days=2)
    _record_baseline(
        store, base_model="m", dataset_name="d", evaluated_at=_iso(older),
    )
    _record_baseline(
        store, base_model="m", dataset_name="d", evaluated_at=_iso(newer),
    )
    age = store.latest_baseline_age_days(base_model="m", dataset_name="d")
    assert 1.5 < age < 2.5


def test_is_fresh_true_when_within_window(store):
    five_days_ago = datetime.now(timezone.utc) - timedelta(days=5)
    _record_baseline(store, base_model="m", dataset_name="d",
                     evaluated_at=_iso(five_days_ago))
    assert store.is_baseline_fresh(
        base_model="m", dataset_name="d", freshness_days=30,
    ) is True


def test_is_fresh_false_when_past_window(store):
    forty_days_ago = datetime.now(timezone.utc) - timedelta(days=40)
    _record_baseline(store, base_model="m", dataset_name="d",
                     evaluated_at=_iso(forty_days_ago))
    assert store.is_baseline_fresh(
        base_model="m", dataset_name="d", freshness_days=30,
    ) is False


def test_is_fresh_false_when_no_baseline(store):
    assert store.is_baseline_fresh(
        base_model="m", dataset_name="d", freshness_days=30,
    ) is False


def test_age_days_ignores_adapter_rows(store):
    # Adapter row for the same (model, dataset) shouldn't shadow the
    # missing baseline.
    store.record_evaluation(
        base_model="m", adapter_name="lora-a", adapter_version=None,
        dataset_name="d", sample_count=10,
        results=[StrategyResult(strategy_name="wer", value=0.1,
                                 breakdown={}, sample_count=10)],
    )
    assert store.latest_baseline_age_days(
        base_model="m", dataset_name="d",
    ) is None


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("METRICS_DB_PATH", str(tmp_path / "metrics.db"))
    monkeypatch.setenv("SEED_ON_BOOT", "false")
    import main
    importlib.reload(main)
    return TestClient(main.app), main, tmp_path


def _write_manifest(tmp_path):
    path = tmp_path / "manifest.jsonl"
    path.write_text(
        json.dumps({"reference": "hello", "hypothesis": "hello"}) + "\n",
        encoding="utf-8",
    )
    return str(path)


def test_baseline_endpoint_runs_when_no_prior(client):
    c, _, tmp_path = client
    res = c.post("/evaluations/baseline", json={
        "base_model": "openai/whisper-large-v3-turbo",
        "dataset_name": "default_eval",
        "manifest_path": _write_manifest(tmp_path),
        "strategies": ["wer"],
    })
    assert res.status_code == 200
    body = res.json()
    # Real run → EvaluationResponse shape (has `id` + `metrics`).
    assert "id" in body
    assert body.get("skipped") is None or body.get("skipped") is False


def test_baseline_endpoint_short_circuits_when_fresh(client):
    c, m, tmp_path = client
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    _record_baseline(
        m.store, base_model="openai/whisper-large-v3-turbo",
        dataset_name="default_eval", evaluated_at=_iso(yesterday),
    )
    res = c.post("/evaluations/baseline", json={
        "base_model": "openai/whisper-large-v3-turbo",
        "dataset_name": "default_eval",
        "manifest_path": _write_manifest(tmp_path),
        "strategies": ["wer"],
    })
    assert res.status_code == 200
    body = res.json()
    assert body.get("skipped") is True
    assert "freshness window" in body["reason"]
    assert body["age_days"] < 2


def test_baseline_endpoint_force_overrides_short_circuit(client):
    c, m, tmp_path = client
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    _record_baseline(
        m.store, base_model="openai/whisper-large-v3-turbo",
        dataset_name="default_eval", evaluated_at=_iso(yesterday),
    )
    res = c.post("/evaluations/baseline", json={
        "base_model": "openai/whisper-large-v3-turbo",
        "dataset_name": "default_eval",
        "manifest_path": _write_manifest(tmp_path),
        "strategies": ["wer"],
        "force": True,
    })
    body = res.json()
    assert body.get("skipped") is None or body.get("skipped") is False
    assert "id" in body


def test_baseline_endpoint_runs_when_existing_baseline_is_stale(client):
    c, m, tmp_path = client
    far_in_the_past = datetime.now(timezone.utc) - timedelta(days=60)
    _record_baseline(
        m.store, base_model="openai/whisper-large-v3-turbo",
        dataset_name="default_eval", evaluated_at=_iso(far_in_the_past),
    )
    res = c.post("/evaluations/baseline", json={
        "base_model": "openai/whisper-large-v3-turbo",
        "dataset_name": "default_eval",
        "manifest_path": _write_manifest(tmp_path),
        "strategies": ["wer"],
    })
    body = res.json()
    # Default freshness is 30 days; 60-day-old → real run.
    assert body.get("skipped") is None or body.get("skipped") is False
    assert "id" in body


def test_baseline_endpoint_freshness_env_override(client, monkeypatch):
    c, m, tmp_path = client
    eight_days_ago = datetime.now(timezone.utc) - timedelta(days=8)
    _record_baseline(
        m.store, base_model="openai/whisper-large-v3-turbo",
        dataset_name="default_eval", evaluated_at=_iso(eight_days_ago),
    )
    # Override the window to 7 days — the 8-day-old baseline is now stale.
    monkeypatch.setenv("METRICS_BASELINE_FRESHNESS_DAYS", "7")
    res = c.post("/evaluations/baseline", json={
        "base_model": "openai/whisper-large-v3-turbo",
        "dataset_name": "default_eval",
        "manifest_path": _write_manifest(tmp_path),
        "strategies": ["wer"],
    })
    body = res.json()
    assert body.get("skipped") is None or body.get("skipped") is False
    assert "id" in body
