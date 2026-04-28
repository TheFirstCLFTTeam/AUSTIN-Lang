from datetime import datetime, timezone

import pytest

from seed_mock import SEED_NOTE, SERIES, DAYS_PER_SERIES, seed
from storage import MetricsStore
from strategies.base import StrategyResult


@pytest.fixture()
def store(tmp_path):
    return MetricsStore(db_path=str(tmp_path / "metrics.db"))


@pytest.fixture()
def fixed_end():
    return datetime(2026, 4, 28, 12, 0, 0, tzinfo=timezone.utc)


def test_seed_creates_two_rows_per_day(store, fixed_end):
    created = seed(store, end=fixed_end)
    assert created == DAYS_PER_SERIES * 2


def test_seed_writes_all_strategies_for_each_role(store, fixed_end):
    seed(store, end=fixed_end)
    # 14 strategies × 5 days × 2 roles = 140 metric rows.
    base_rows = store.list_evaluations(adapter_name="__base__", limit=100)
    ft_rows = store.list_evaluations(adapter_name="fypaudio-W-lv3t", limit=100)
    assert len(base_rows) == DAYS_PER_SERIES
    assert len(ft_rows) == DAYS_PER_SERIES
    for row in base_rows + ft_rows:
        metrics = store.list_metrics_for_evaluation(row.id)
        names = {m.strategy_name for m in metrics}
        assert names == set(SERIES.keys())


def test_seed_pair_returns_latest_values_matching_mock(store, fixed_end):
    seed(store, end=fixed_end)
    pair = store.latest_metric_pair(
        base_model="openai/whisper-large-v3-turbo",
        dataset_name="default_eval",
        strategy_name="overall_accuracy",
    )
    # Series ends at index 4 = newest. Mock: base=90.0, finetuned=95.8.
    assert pair.base_value == pytest.approx(90.0)
    assert pair.finetuned_value == pytest.approx(95.8)
    assert pair.delta == pytest.approx(5.8)
    assert pair.finetuned_adapter_name == "fypaudio-W-lv3t"


def test_seed_is_idempotent(store, fixed_end):
    seed(store, end=fixed_end)
    seed(store, end=fixed_end)
    base_rows = store.list_evaluations(adapter_name="__base__", limit=100)
    ft_rows = store.list_evaluations(adapter_name="fypaudio-W-lv3t", limit=100)
    assert len(base_rows) == DAYS_PER_SERIES
    assert len(ft_rows) == DAYS_PER_SERIES


def test_seed_only_clears_seed_tagged_rows(store, fixed_end):
    # A non-seeded row that should survive re-seeding.
    real_id = store.record_evaluation(
        base_model="openai/whisper-large-v3-turbo",
        adapter_name="other-adapter",
        adapter_version="v1",
        dataset_name="other_dataset",
        sample_count=100,
        results=[StrategyResult(strategy_name="f1", value=0.91, sample_count=100)],
        notes="real-run",
    )
    seed(store, end=fixed_end)
    seed(store, end=fixed_end)
    assert store.get_evaluation(real_id) is not None


def test_seed_timestamps_are_chronological(store, fixed_end):
    seed(store, end=fixed_end)
    ft_rows = store.list_evaluations(adapter_name="fypaudio-W-lv3t", limit=100)
    timestamps = [r.evaluated_at for r in ft_rows]
    # list_evaluations orders newest first.
    assert timestamps == sorted(timestamps, reverse=True)
    # End is the newest entry.
    assert timestamps[0] == "2026-04-28T12:00:00Z"
    # Five days span, so the oldest is end - 4 days.
    assert timestamps[-1] == "2026-04-24T12:00:00Z"
