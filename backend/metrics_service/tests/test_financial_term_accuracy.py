"""Coverage for the `financial_term_accuracy` strategy.

Test contract: macro-averaged per-sample term accuracy. Samples without
critical_terms are excluded from the denominator (would otherwise inflate
on non-finance corpora). Term matching is normalised + supports multi-word
contiguous-subsequence phrases.
"""

import pytest

from strategies import Sample, get_strategy
from strategies.financial_term_accuracy import _phrase_in_tokens


def _strategy():
    return get_strategy("financial_term_accuracy")


# ── _phrase_in_tokens helper ────────────────────────────────────────────────


def test_phrase_in_tokens_single_match():
    assert _phrase_in_tokens(["ebitda"], ["our", "ebitda", "is", "up"]) is True


def test_phrase_in_tokens_single_no_match():
    assert _phrase_in_tokens(["ebitda"], ["our", "earnings", "is", "up"]) is False


def test_phrase_in_tokens_multi_word_match():
    assert _phrase_in_tokens(
        ["hedge", "fund"],
        ["the", "hedge", "fund", "filed"],
    ) is True


def test_phrase_in_tokens_multi_word_non_contiguous_no_match():
    # tokens present but not contiguous → not a match
    assert _phrase_in_tokens(
        ["hedge", "fund"],
        ["the", "hedge", "small", "fund"],
    ) is False


def test_phrase_in_tokens_empty_needle():
    assert _phrase_in_tokens([], ["anything"]) is False


def test_phrase_in_tokens_empty_haystack():
    assert _phrase_in_tokens(["ebitda"], []) is False


# ── Strategy core behaviour ────────────────────────────────────────────────


def test_strategy_registered():
    s = _strategy()
    assert s.name == "financial_term_accuracy"


def test_perfect_score_when_all_terms_correct():
    samples = [
        Sample(
            reference="EBITDA up 12 percent",
            hypothesis="EBITDA up 12 percent",
            critical_terms=["EBITDA"],
        ),
    ]
    result = _strategy().compute(samples)
    assert result.value == 1.0
    assert result.sample_count == 1
    assert result.breakdown["terms_correct"] == 1.0
    assert result.breakdown["terms_seen"] == 1.0


def test_partial_score_when_some_terms_missing():
    samples = [
        Sample(
            reference="EBITDA and Q1 figures",
            hypothesis="earnings and Q1 figures",   # EBITDA missing
            critical_terms=["EBITDA", "Q1"],
        ),
    ]
    result = _strategy().compute(samples)
    assert result.value == 0.5
    assert result.breakdown["terms_correct"] == 1.0
    assert result.breakdown["terms_seen"] == 2.0


def test_zero_when_no_terms_correct():
    samples = [
        Sample(
            reference="EBITDA up",
            hypothesis="earnings up",
            critical_terms=["EBITDA"],
        ),
    ]
    result = _strategy().compute(samples)
    assert result.value == 0.0


def test_macro_average_across_samples():
    # Sample A: 1/1 = 1.0; Sample B: 0/2 = 0.0 → macro = 0.5
    samples = [
        Sample(reference="EBITDA",         hypothesis="EBITDA",         critical_terms=["EBITDA"]),
        Sample(reference="Q1 then Hedge",  hypothesis="quarter and bet", critical_terms=["Q1", "Hedge"]),
    ]
    result = _strategy().compute(samples)
    assert result.value == pytest.approx(0.5)
    assert result.sample_count == 2
    assert result.breakdown["terms_seen"] == 3.0
    assert result.breakdown["terms_correct"] == 1.0


def test_samples_with_no_critical_terms_skipped_from_denominator():
    # Sample A scored 0.5; Sample B has no terms — must NOT count as 1.0.
    samples = [
        Sample(reference="EBITDA Q1", hypothesis="EBITDA",     critical_terms=["EBITDA", "Q1"]),
        Sample(reference="The cat",   hypothesis="The cat",    critical_terms=[]),
    ]
    result = _strategy().compute(samples)
    assert result.value == 0.5
    assert result.sample_count == 1
    assert result.breakdown["samples_skipped_no_terms"] == 1.0


def test_samples_with_no_tag_field_skipped_with_dedicated_counter():
    # critical_terms=None means the manifest pre-dates the field.
    samples = [
        Sample(reference="EBITDA", hypothesis="EBITDA", critical_terms=["EBITDA"]),
        Sample(reference="The cat", hypothesis="The cat"),  # no critical_terms passed
    ]
    result = _strategy().compute(samples)
    assert result.value == 1.0
    assert result.sample_count == 1
    assert result.breakdown["samples_skipped_no_tag"] == 1.0
    assert result.breakdown["samples_skipped_no_terms"] == 0.0


def test_empty_input_returns_zero_with_zero_count():
    result = _strategy().compute([])
    assert result.value == 0.0
    assert result.sample_count == 0
    assert result.breakdown["samples_scored"] == 0.0


def test_normalisation_handles_case_and_punctuation():
    # The reference's "EBITDA," (with comma) and the hypothesis's "EBITDA"
    # should match after normalisation.
    samples = [
        Sample(
            reference="The EBITDA, was up.",
            hypothesis="the ebitda was up",
            critical_terms=["EBITDA"],
        ),
    ]
    result = _strategy().compute(samples)
    assert result.value == 1.0


def test_multi_word_term_matches_when_contiguous_in_hyp():
    samples = [
        Sample(
            reference="The hedge fund filed today",
            hypothesis="the hedge fund filed today",
            critical_terms=["hedge fund"],
        ),
    ]
    result = _strategy().compute(samples)
    assert result.value == 1.0


def test_multi_word_term_does_not_match_when_split():
    samples = [
        Sample(
            reference="The hedge fund filed",
            hypothesis="the hedge small fund filed",  # split by 'small'
            critical_terms=["hedge fund"],
        ),
    ]
    result = _strategy().compute(samples)
    assert result.value == 0.0


def test_breakdown_includes_skip_counters_even_when_some_score():
    samples = [
        Sample(reference="EBITDA", hypothesis="EBITDA",     critical_terms=["EBITDA"]),
        Sample(reference="x",      hypothesis="x",          critical_terms=[]),
        Sample(reference="y",      hypothesis="y"),  # no tag
    ]
    result = _strategy().compute(samples)
    assert result.value == 1.0
    assert result.breakdown["samples_scored"] == 1.0
    assert result.breakdown["samples_skipped_no_terms"] == 1.0
    assert result.breakdown["samples_skipped_no_tag"] == 1.0
