"""Tests for the leaderboard storage helper + GET /leaderboard endpoint
(training-job-pipeline.md §4.7).

Storage:
    - latest-per-pair (older eval on same adapter is shadowed)
    - WER-asc ranking with NULL-WER rows sinking
    - base_family substring filter (case-insensitive)
    - only_finetuned excludes adapter_name IS NULL rows
    - empty result on unknown dataset

Endpoint:
    - GET /leaderboard?dataset_id=X stamps `rank` 1-based
    - base_family filter passes through
    - dataset_id missing → 422 (FastAPI validation)
    - empty list when no rows match
    - LeaderboardRowResponse pivots wer/cer/rtf onto top-level fields
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from storage import MetricsStore  # noqa: E402
from strategies.base import StrategyResult  # noqa: E402


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

@pytest.fixture()
def store(tmp_path):
    return MetricsStore(db_path=str(tmp_path / "metrics.db"))


def _record(store, *, base, adapter, dataset, wer, cer=None, rtf=None,
            evaluated_at=None, training_job_id=None, submitted_by=None):
    """Convenience: write one evaluation with the requested metrics."""
    results = [StrategyResult(strategy_name="wer", value=wer,
                              breakdown={}, sample_count=10)]
    if cer is not None:
        results.append(StrategyResult(strategy_name="cer", value=cer,
                                      breakdown={}, sample_count=10))
    if rtf is not None:
        results.append(StrategyResult(strategy_name="rtf", value=rtf,
                                      breakdown={}, sample_count=10))
    return store.record_evaluation(
        base_model=base, adapter_name=adapter, adapter_version=None,
        dataset_name=dataset, sample_count=10, results=results,
        evaluated_at=evaluated_at,
        training_job_id=training_job_id, submitted_by=submitted_by,
    )


def test_list_leaderboard_empty_dataset(store):
    rows = store.list_leaderboard(dataset_name="nonexistent")
    assert rows == []


def test_list_leaderboard_basic_ranking(store):
    _record(store, base="openai/whisper-large-v3-turbo", adapter="lora-a",
            dataset="default_eval", wer=0.082, cer=0.041, rtf=0.42,
            submitted_by="u2", training_job_id="job-aaa")
    _record(store, base="openai/whisper-large-v3-turbo", adapter="lora-b",
            dataset="default_eval", wer=0.061, cer=0.030, rtf=0.40,
            submitted_by="u3", training_job_id="job-bbb")
    _record(store, base="openai/whisper-large-v3-turbo", adapter="lora-c",
            dataset="default_eval", wer=0.094, cer=0.052, rtf=0.45,
            submitted_by="u4", training_job_id="job-ccc")

    rows = store.list_leaderboard(dataset_name="default_eval")
    assert [r.adapter_name for r in rows] == ["lora-b", "lora-a", "lora-c"]
    assert rows[0].wer == pytest.approx(0.061)
    assert rows[0].submitted_by == "u3"
    assert rows[0].training_job_id == "job-bbb"


def test_list_leaderboard_picks_latest_per_adapter(store):
    # Two evals on the same adapter — only the latest should rank.
    _record(store, base="openai/whisper-large-v3-turbo", adapter="lora-a",
            dataset="default_eval", wer=0.085,
            evaluated_at="2026-04-01T00:00:00Z")
    _record(store, base="openai/whisper-large-v3-turbo", adapter="lora-a",
            dataset="default_eval", wer=0.072,
            evaluated_at="2026-04-15T00:00:00Z")
    rows = store.list_leaderboard(dataset_name="default_eval")
    assert len(rows) == 1
    # The newer (better) row wins, even though both exist in the DB.
    assert rows[0].wer == pytest.approx(0.072)


def test_list_leaderboard_only_finetuned_default(store):
    # Base row (adapter_name IS NULL) must not show up by default.
    _record(store, base="openai/whisper-large-v3-turbo", adapter=None,
            dataset="default_eval", wer=0.150)
    _record(store, base="openai/whisper-large-v3-turbo", adapter="lora-a",
            dataset="default_eval", wer=0.080)
    rows = store.list_leaderboard(dataset_name="default_eval")
    assert all(r.adapter_name is not None for r in rows)


def test_list_leaderboard_only_finetuned_false_includes_baseline(store):
    _record(store, base="openai/whisper-large-v3-turbo", adapter=None,
            dataset="default_eval", wer=0.150)
    _record(store, base="openai/whisper-large-v3-turbo", adapter="lora-a",
            dataset="default_eval", wer=0.080)
    rows = store.list_leaderboard(
        dataset_name="default_eval", only_finetuned=False,
    )
    assert len(rows) == 2
    assert any(r.adapter_name is None for r in rows)


def test_list_leaderboard_base_family_filter(store):
    _record(store, base="openai/whisper-large-v3-turbo", adapter="lora-w",
            dataset="default_eval", wer=0.080)
    _record(store, base="MERaLiON/MERaLiON-AudioLLM-Whisper-SEA-LION",
            adapter="lora-m", dataset="default_eval", wer=0.090)
    whisper_only = store.list_leaderboard(
        dataset_name="default_eval", base_family="whisper",
    )
    # Both rows contain "whisper" (MERaLiON's HF id has "Whisper" too) —
    # the substring filter is intentionally lenient. Tighten the test
    # to a more disambiguating term.
    meralion_only = store.list_leaderboard(
        dataset_name="default_eval", base_family="meralion",
    )
    assert all("openai/whisper" in r.base_model.lower() or "whisper" in r.base_model.lower()
               for r in whisper_only)
    assert len(meralion_only) == 1
    assert "meralion" in meralion_only[0].base_model.lower()


def test_list_leaderboard_null_wer_sinks_to_bottom(store):
    # Adapter without a recorded WER — should appear, but last.
    _record(store, base="openai/whisper-large-v3-turbo", adapter="lora-a",
            dataset="default_eval", wer=0.080)
    # Manually record a row with no WER. Use a non-wer strategy.
    store.record_evaluation(
        base_model="openai/whisper-large-v3-turbo",
        adapter_name="lora-no-wer", adapter_version=None,
        dataset_name="default_eval", sample_count=10,
        results=[StrategyResult(strategy_name="cer", value=0.05,
                                 breakdown={}, sample_count=10)],
    )
    rows = store.list_leaderboard(dataset_name="default_eval")
    assert rows[-1].adapter_name == "lora-no-wer"
    assert rows[-1].wer is None


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("METRICS_DB_PATH", str(tmp_path / "metrics.db"))
    monkeypatch.setenv("SEED_ON_BOOT", "false")
    import main
    importlib.reload(main)
    return TestClient(main.app), main


def test_leaderboard_endpoint_empty_dataset(client):
    c, _ = client
    res = c.get("/leaderboard", params={"dataset_id": "missing"})
    assert res.status_code == 200
    body = res.json()
    assert body["rows"] == []
    assert body["dataset_id"] == "missing"


def test_leaderboard_endpoint_stamps_rank(client):
    c, m = client
    _record(m.store, base="openai/whisper-large-v3-turbo", adapter="lora-a",
            dataset="default_eval", wer=0.080, submitted_by="u2",
            training_job_id="job-aaa")
    _record(m.store, base="openai/whisper-large-v3-turbo", adapter="lora-b",
            dataset="default_eval", wer=0.060, submitted_by="u3",
            training_job_id="job-bbb")
    res = c.get("/leaderboard", params={"dataset_id": "default_eval"})
    body = res.json()
    assert [r["rank"] for r in body["rows"]] == [1, 2]
    assert body["rows"][0]["adapter_name"] == "lora-b"
    assert body["rows"][0]["submitted_by"] == "u3"
    assert body["rows"][0]["training_job_id"] == "job-bbb"


def test_leaderboard_endpoint_pivots_metrics(client):
    c, m = client
    _record(m.store, base="openai/whisper-large-v3-turbo", adapter="lora-a",
            dataset="default_eval", wer=0.080, cer=0.041, rtf=0.42)
    body = c.get("/leaderboard",
                 params={"dataset_id": "default_eval"}).json()
    row = body["rows"][0]
    assert row["wer"] == pytest.approx(0.080)
    assert row["cer"] == pytest.approx(0.041)
    assert row["rtf"] == pytest.approx(0.42)


def test_leaderboard_endpoint_base_family_filter(client):
    c, m = client
    _record(m.store, base="openai/whisper-large-v3-turbo", adapter="lora-w",
            dataset="default_eval", wer=0.080)
    _record(m.store, base="MERaLiON/MERaLiON-AudioLLM-Whisper-SEA-LION",
            adapter="lora-m", dataset="default_eval", wer=0.090)
    body = c.get("/leaderboard", params={
        "dataset_id": "default_eval", "base_family": "meralion",
    }).json()
    assert len(body["rows"]) == 1
    assert "meralion" in body["rows"][0]["base_model"].lower()
    assert body["base_family"] == "meralion"


def test_leaderboard_endpoint_model_name_includes_adapter(client):
    c, m = client
    _record(m.store, base="openai/whisper-large-v3-turbo",
            adapter="lora.cantonese", dataset="default_eval", wer=0.08)
    body = c.get("/leaderboard",
                 params={"dataset_id": "default_eval"}).json()
    assert body["rows"][0]["model_name"] == "whisper-large-v3-turbo + lora.cantonese"


def test_leaderboard_endpoint_family_extracted_from_hf_id(client):
    c, m = client
    _record(m.store, base="openai/whisper-large-v3-turbo", adapter="lora-a",
            dataset="default_eval", wer=0.08)
    body = c.get("/leaderboard",
                 params={"dataset_id": "default_eval"}).json()
    assert body["rows"][0]["base_family"] == "whisper"


def test_leaderboard_endpoint_missing_dataset_id_422(client):
    c, _ = client
    res = c.get("/leaderboard")
    # FastAPI's query-param validation kicks in.
    assert res.status_code == 422
