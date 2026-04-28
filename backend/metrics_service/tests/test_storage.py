import pytest

from storage import MetricsStore
from strategies.base import StrategyResult


@pytest.fixture()
def store(tmp_path):
    return MetricsStore(db_path=str(tmp_path / "metrics.db"))


def _result(name="f1", value=0.9, breakdown=None, sample_count=10):
    return StrategyResult(
        strategy_name=name,
        value=value,
        breakdown=breakdown or {"precision": 0.9, "recall": 0.9},
        sample_count=sample_count,
    )


def test_record_evaluation_returns_id_and_persists_metrics(store):
    eval_id = store.record_evaluation(
        base_model="openai/whisper-large-v3-turbo",
        adapter_name="fypaudio-W-lv3t",
        adapter_version="abc123",
        dataset_name="spgispeech",
        sample_count=100,
        results=[_result("f1", 0.93, {"precision": 0.94, "recall": 0.92}, 100)],
    )
    assert isinstance(eval_id, int) and eval_id > 0

    record = store.get_evaluation(eval_id)
    assert record is not None
    assert record.base_model == "openai/whisper-large-v3-turbo"
    assert record.adapter_name == "fypaudio-W-lv3t"
    assert record.adapter_version == "abc123"
    assert record.dataset_name == "spgispeech"
    assert record.sample_count == 100
    assert record.status == "completed"

    metrics = store.list_metrics_for_evaluation(eval_id)
    assert len(metrics) == 1
    m = metrics[0]
    assert m.strategy_name == "f1"
    assert m.value == pytest.approx(0.93)
    assert m.breakdown == {"precision": 0.94, "recall": 0.92}
    assert m.sample_count == 100


def test_get_evaluation_unknown_returns_none(store):
    assert store.get_evaluation(9999) is None


def test_record_evaluation_supports_null_adapter_for_baseline(store):
    eval_id = store.record_evaluation(
        base_model="openai/whisper-large-v3-turbo",
        adapter_name=None,
        adapter_version=None,
        dataset_name="spgispeech",
        sample_count=100,
        results=[_result("f1", 0.81, {"precision": 0.82, "recall": 0.80}, 100)],
    )
    record = store.get_evaluation(eval_id)
    assert record.adapter_name is None
    assert record.adapter_version is None


def test_list_evaluations_filters_by_base_only_sentinel(store):
    store.record_evaluation(
        base_model="m1", adapter_name=None, adapter_version=None,
        dataset_name="d1", sample_count=1, results=[_result()],
    )
    store.record_evaluation(
        base_model="m1", adapter_name="adapter-x", adapter_version="v1",
        dataset_name="d1", sample_count=1, results=[_result()],
    )

    base_only = store.list_evaluations(base_model="m1", adapter_name="__base__")
    assert len(base_only) == 1
    assert base_only[0].adapter_name is None

    by_adapter = store.list_evaluations(base_model="m1", adapter_name="adapter-x")
    assert len(by_adapter) == 1
    assert by_adapter[0].adapter_name == "adapter-x"

    no_filter = store.list_evaluations(base_model="m1")
    assert len(no_filter) == 2


def test_list_evaluations_orders_newest_first(store):
    older = store.record_evaluation(
        base_model="m1", adapter_name="a", adapter_version="v1",
        dataset_name="d1", sample_count=1, results=[_result()],
        evaluated_at="2026-04-01T00:00:00Z",
    )
    newer = store.record_evaluation(
        base_model="m1", adapter_name="a", adapter_version="v2",
        dataset_name="d1", sample_count=1, results=[_result()],
        evaluated_at="2026-04-20T00:00:00Z",
    )
    rows = store.list_evaluations(base_model="m1")
    assert [r.id for r in rows] == [newer, older]


def test_latest_metric_pair_returns_base_and_finetuned(store):
    base_model = "openai/whisper-large-v3-turbo"
    dataset = "spgispeech"

    store.record_evaluation(
        base_model=base_model, adapter_name=None, adapter_version=None,
        dataset_name=dataset, sample_count=100,
        results=[_result("f1", 0.81)],
        evaluated_at="2026-04-10T00:00:00Z",
    )
    store.record_evaluation(
        base_model=base_model, adapter_name="fypaudio-W-lv3t",
        adapter_version="abc123",
        dataset_name=dataset, sample_count=100,
        results=[_result("f1", 0.93)],
        evaluated_at="2026-04-20T00:00:00Z",
    )

    pair = store.latest_metric_pair(
        base_model=base_model, dataset_name=dataset, strategy_name="f1"
    )
    assert pair.base_value == pytest.approx(0.81)
    assert pair.finetuned_value == pytest.approx(0.93)
    assert pair.finetuned_adapter_name == "fypaudio-W-lv3t"
    assert pair.finetuned_adapter_version == "abc123"
    assert pair.delta == pytest.approx(0.12)


def test_latest_metric_pair_picks_most_recent_when_multiple(store):
    base_model = "m1"
    dataset = "d1"
    store.record_evaluation(
        base_model=base_model, adapter_name="a", adapter_version="v1",
        dataset_name=dataset, sample_count=1,
        results=[_result("f1", 0.50)],
        evaluated_at="2026-04-01T00:00:00Z",
    )
    store.record_evaluation(
        base_model=base_model, adapter_name="a", adapter_version="v2",
        dataset_name=dataset, sample_count=1,
        results=[_result("f1", 0.75)],
        evaluated_at="2026-04-20T00:00:00Z",
    )
    pair = store.latest_metric_pair(
        base_model=base_model, dataset_name=dataset, strategy_name="f1"
    )
    assert pair.finetuned_value == pytest.approx(0.75)
    assert pair.finetuned_adapter_version == "v2"


def test_latest_metric_pair_handles_missing_sides(store):
    # Only finetuned exists
    store.record_evaluation(
        base_model="m1", adapter_name="a", adapter_version="v1",
        dataset_name="d1", sample_count=1, results=[_result("f1", 0.9)],
    )
    pair = store.latest_metric_pair(
        base_model="m1", dataset_name="d1", strategy_name="f1"
    )
    assert pair.base_value is None
    assert pair.finetuned_value == pytest.approx(0.9)
    assert pair.delta is None


def test_latest_metric_pair_no_data(store):
    pair = store.latest_metric_pair(
        base_model="missing", dataset_name="missing", strategy_name="f1"
    )
    assert pair.base_value is None
    assert pair.finetuned_value is None
    assert pair.delta is None


def test_latest_metric_pair_ignores_failed_runs(store):
    base_model = "m1"
    dataset = "d1"
    # Failed finetuned run that's newer should be ignored.
    store.record_evaluation(
        base_model=base_model, adapter_name="a", adapter_version="v1",
        dataset_name=dataset, sample_count=1,
        results=[_result("f1", 0.85)],
        evaluated_at="2026-04-10T00:00:00Z",
        status="completed",
    )
    store.record_evaluation(
        base_model=base_model, adapter_name="a", adapter_version="v2",
        dataset_name=dataset, sample_count=0,
        results=[_result("f1", 0.0)],
        evaluated_at="2026-04-20T00:00:00Z",
        status="failed",
    )
    pair = store.latest_metric_pair(
        base_model=base_model, dataset_name=dataset, strategy_name="f1"
    )
    assert pair.finetuned_value == pytest.approx(0.85)
    assert pair.finetuned_adapter_version == "v1"


def test_init_schema_is_idempotent(tmp_path):
    db = str(tmp_path / "metrics.db")
    s1 = MetricsStore(db_path=db)
    s1.record_evaluation(
        base_model="m1", adapter_name=None, adapter_version=None,
        dataset_name="d1", sample_count=1, results=[_result()],
    )
    # Re-opening must not wipe data or error on the schema replay.
    s2 = MetricsStore(db_path=db)
    rows = s2.list_evaluations(base_model="m1")
    assert len(rows) == 1


def test_breakdown_json_roundtrip_handles_nested_values(store):
    eval_id = store.record_evaluation(
        base_model="m1", adapter_name="a", adapter_version="v1",
        dataset_name="d1", sample_count=1,
        results=[
            StrategyResult(
                strategy_name="f1",
                value=0.9,
                breakdown={"precision": 0.91, "recall": 0.89, "per_lang": {"en": 0.92}},
                sample_count=1,
            )
        ],
    )
    metrics = store.list_metrics_for_evaluation(eval_id)
    assert metrics[0].breakdown == {
        "precision": 0.91,
        "recall": 0.89,
        "per_lang": {"en": 0.92},
    }
