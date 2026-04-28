import pytest

from storage import MetricsStore
from strategies.base import StrategyResult


@pytest.fixture()
def store(tmp_path):
    return MetricsStore(db_path=str(tmp_path / "metrics.db"))


def _r(value):
    return [StrategyResult(strategy_name="f1", value=value, sample_count=10)]


def _seed_5_day_series(store, role_values, *, role_label):
    adapter_name = None if role_label == "base" else "fypaudio"
    adapter_version = None if role_label == "base" else "v1"
    timestamps = [
        "2026-04-24T00:00:00Z",
        "2026-04-25T00:00:00Z",
        "2026-04-26T00:00:00Z",
        "2026-04-27T00:00:00Z",
        "2026-04-28T00:00:00Z",
    ]
    for ts, v in zip(timestamps, role_values):
        store.record_evaluation(
            base_model="m1", adapter_name=adapter_name,
            adapter_version=adapter_version, dataset_name="d1",
            sample_count=1, results=_r(v), evaluated_at=ts,
        )


def test_series_returns_oldest_first(store):
    _seed_5_day_series(store, [89.2, 89.4, 89.6, 89.8, 90.0], role_label="base")
    series = store.latest_metric_series(
        base_model="m1", dataset_name="d1", strategy_name="f1",
        role="base", limit=5,
    )
    assert [p["value"] for p in series] == [89.2, 89.4, 89.6, 89.8, 90.0]
    assert [p["evaluated_at"] for p in series] == [
        "2026-04-24T00:00:00Z",
        "2026-04-25T00:00:00Z",
        "2026-04-26T00:00:00Z",
        "2026-04-27T00:00:00Z",
        "2026-04-28T00:00:00Z",
    ]


def test_series_limit_picks_newest_n(store):
    _seed_5_day_series(store, [1.0, 2.0, 3.0, 4.0, 5.0], role_label="base")
    series = store.latest_metric_series(
        base_model="m1", dataset_name="d1", strategy_name="f1",
        role="base", limit=3,
    )
    # Newest 3, returned oldest first.
    assert [p["value"] for p in series] == [3.0, 4.0, 5.0]


def test_series_separates_base_from_finetuned(store):
    _seed_5_day_series(store, [10, 11, 12, 13, 14], role_label="base")
    _seed_5_day_series(store, [80, 81, 82, 83, 84], role_label="finetuned")

    base = store.latest_metric_series(
        base_model="m1", dataset_name="d1", strategy_name="f1",
        role="base", limit=5,
    )
    ft = store.latest_metric_series(
        base_model="m1", dataset_name="d1", strategy_name="f1",
        role="finetuned", limit=5,
    )
    assert [p["value"] for p in base] == [10, 11, 12, 13, 14]
    assert [p["value"] for p in ft] == [80, 81, 82, 83, 84]


def test_series_empty_when_no_data(store):
    assert store.latest_metric_series(
        base_model="m1", dataset_name="d1", strategy_name="f1",
        role="base", limit=5,
    ) == []


def test_series_invalid_role_raises(store):
    with pytest.raises(ValueError, match="role must be"):
        store.latest_metric_series(
            base_model="m1", dataset_name="d1", strategy_name="f1",
            role="invalid", limit=5,
        )


def test_series_ignores_failed_runs(store):
    store.record_evaluation(
        base_model="m1", adapter_name=None, adapter_version=None,
        dataset_name="d1", sample_count=1, results=_r(0.9),
        evaluated_at="2026-04-27T00:00:00Z", status="completed",
    )
    store.record_evaluation(
        base_model="m1", adapter_name=None, adapter_version=None,
        dataset_name="d1", sample_count=0, results=_r(0.0),
        evaluated_at="2026-04-28T00:00:00Z", status="failed",
    )
    series = store.latest_metric_series(
        base_model="m1", dataset_name="d1", strategy_name="f1",
        role="base", limit=5,
    )
    assert [p["value"] for p in series] == [0.9]
