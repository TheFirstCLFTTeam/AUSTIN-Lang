import pytest

from storage import MetricsStore
from strategies.base import StrategyResult


@pytest.fixture()
def store(tmp_path):
    return MetricsStore(db_path=str(tmp_path / "metrics.db"))


def _r(name, value=0.9):
    return StrategyResult(strategy_name=name, value=value, sample_count=10)


def test_list_strategy_names_distinct_across_evaluations(store):
    store.record_evaluation(
        base_model="m1", adapter_name=None, adapter_version=None,
        dataset_name="d1", sample_count=1,
        results=[_r("f1"), _r("wer")],
    )
    store.record_evaluation(
        base_model="m1", adapter_name="a", adapter_version="v1",
        dataset_name="d1", sample_count=1,
        results=[_r("f1"), _r("cer")],
    )
    names = store.list_strategy_names(base_model="m1", dataset_name="d1")
    assert names == ["cer", "f1", "wer"]


def test_list_strategy_names_filters_by_dataset(store):
    store.record_evaluation(
        base_model="m1", adapter_name=None, adapter_version=None,
        dataset_name="d1", sample_count=1, results=[_r("f1")],
    )
    store.record_evaluation(
        base_model="m1", adapter_name=None, adapter_version=None,
        dataset_name="d2", sample_count=1, results=[_r("wer")],
    )
    assert store.list_strategy_names(base_model="m1", dataset_name="d1") == ["f1"]
    assert store.list_strategy_names(base_model="m1", dataset_name="d2") == ["wer"]


def test_list_strategy_names_ignores_failed(store):
    store.record_evaluation(
        base_model="m1", adapter_name=None, adapter_version=None,
        dataset_name="d1", sample_count=0,
        results=[_r("only-failed")],
        status="failed",
    )
    assert store.list_strategy_names(base_model="m1", dataset_name="d1") == []


def test_delete_evaluations_with_notes_cascades(store):
    survivor = store.record_evaluation(
        base_model="m1", adapter_name=None, adapter_version=None,
        dataset_name="d1", sample_count=1, results=[_r("f1")],
        notes="real",
    )
    seeded = store.record_evaluation(
        base_model="m1", adapter_name=None, adapter_version=None,
        dataset_name="d1", sample_count=1, results=[_r("f1")],
        notes="seed:mock",
    )
    removed = store.delete_evaluations_with_notes("seed:mock")
    assert removed == 1
    assert store.get_evaluation(survivor) is not None
    assert store.get_evaluation(seeded) is None
    # Cascade should have removed the metric row too.
    assert store.list_metrics_for_evaluation(seeded) == []
