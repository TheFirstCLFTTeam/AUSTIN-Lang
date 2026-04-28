import pytest

from strategies import (
    MetricsRunner,
    Sample,
    get_strategy,
    list_strategies,
    register_strategy,
)
from strategies.base import MetricStrategy, StrategyResult
from strategies.f1 import _pair_prf, _tokenize


def test_tokenize_lowercases_and_strips_punctuation():
    assert _tokenize("Hello, World! it's fine.") == ["hello", "world", "it's", "fine"]


def test_tokenize_empty_inputs():
    assert _tokenize("") == []
    assert _tokenize("   ") == []


def test_pair_prf_exact_match():
    p, r, f = _pair_prf("the deal is closed", "the deal is closed")
    assert (p, r, f) == (1.0, 1.0, 1.0)


def test_pair_prf_one_substitution():
    # ref = 4 tokens, hyp = 4 tokens, overlap = 3 (the, deal, is)
    p, r, f = _pair_prf("the deal is closed", "the deal is closing")
    assert p == pytest.approx(0.75)
    assert r == pytest.approx(0.75)
    assert f == pytest.approx(0.75)


def test_pair_prf_partial_overlap_different_lengths():
    # ref = 4 tokens, hyp = 7 tokens, overlap = 4
    # precision = 4/7, recall = 4/4
    p, r, f = _pair_prf("the deal is closed", "the deal is closed today my friend")
    assert p == pytest.approx(4 / 7)
    assert r == pytest.approx(1.0)
    assert f == pytest.approx(2 * (4 / 7) * 1.0 / ((4 / 7) + 1.0))


def test_pair_prf_both_empty_is_perfect():
    assert _pair_prf("", "") == (1.0, 1.0, 1.0)


def test_pair_prf_one_side_empty_is_zero():
    assert _pair_prf("hello", "") == (0.0, 0.0, 0.0)
    assert _pair_prf("", "hello") == (0.0, 0.0, 0.0)


def test_pair_prf_no_overlap():
    assert _pair_prf("alpha beta", "gamma delta") == (0.0, 0.0, 0.0)


def test_pair_prf_normalisation_ignores_case_and_punct():
    p, r, f = _pair_prf("Hello, World!", "hello world")
    assert (p, r, f) == (1.0, 1.0, 1.0)


def test_f1_strategy_aggregates_macro_average():
    f1 = get_strategy("f1")
    samples = [
        Sample(reference="the deal is closed", hypothesis="the deal is closed"),    # 1.0
        Sample(reference="the deal is closed", hypothesis="the deal is closing"),   # 0.75
        Sample(reference="alpha beta", hypothesis="gamma delta"),                   # 0.0
    ]
    result = f1.compute(samples)
    assert result.strategy_name == "f1"
    assert result.sample_count == 3
    assert result.value == pytest.approx((1.0 + 0.75 + 0.0) / 3)
    assert result.breakdown["precision"] == pytest.approx((1.0 + 0.75 + 0.0) / 3)
    assert result.breakdown["recall"] == pytest.approx((1.0 + 0.75 + 0.0) / 3)


def test_f1_strategy_empty_samples():
    result = get_strategy("f1").compute([])
    assert result.value == 0.0
    assert result.sample_count == 0
    assert result.breakdown == {}


def test_registry_lists_f1():
    assert "f1" in list_strategies()


def test_registry_unknown_name_raises():
    with pytest.raises(KeyError, match="Unknown strategy"):
        get_strategy("does-not-exist")


def test_registry_rejects_duplicate_registration():
    with pytest.raises(ValueError, match="already registered"):
        @register_strategy
        class DupF1(MetricStrategy):
            name = "f1"

            def compute(self, samples):
                return StrategyResult(strategy_name=self.name, value=0.0)


def test_registry_rejects_missing_name():
    with pytest.raises(ValueError, match="non-empty `name`"):
        @register_strategy
        class Anon(MetricStrategy):
            name = ""

            def compute(self, samples):
                return StrategyResult(strategy_name=self.name, value=0.0)


def test_runner_executes_each_strategy_once_over_shared_samples():
    seen_lengths = []

    @register_strategy
    class Counter(MetricStrategy):
        name = "test-counter"

        def compute(self, samples):
            samples_list = list(samples)
            seen_lengths.append(len(samples_list))
            return StrategyResult(strategy_name=self.name, value=float(len(samples_list)))

    samples = [
        Sample(reference="a b", hypothesis="a b"),
        Sample(reference="c d", hypothesis="c d"),
    ]
    results = MetricsRunner(["f1", "test-counter"]).run(iter(samples))

    assert set(results) == {"f1", "test-counter"}
    assert results["test-counter"].value == 2.0
    assert seen_lengths == [2]
    assert results["f1"].sample_count == 2


def test_runner_requires_at_least_one_strategy():
    with pytest.raises(ValueError, match="at least one strategy"):
        MetricsRunner([])
