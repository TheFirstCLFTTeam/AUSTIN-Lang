"""Coverage for the WER, CER, SMR strategies + their shared text helpers."""

import pytest

from strategies import Sample, get_strategy, list_strategies
from strategies._text import levenshtein, normalise, tokenise_chars, tokenise_words


# ---------------------------------------------------------------------------
# _text helpers
# ---------------------------------------------------------------------------

def test_normalise_lowercases_and_strips_punct():
    assert normalise("Hello, World! It's fine.") == "hello world it's fine"


def test_normalise_collapses_whitespace_and_handles_empty():
    assert normalise("   foo   bar  ") == "foo bar"
    assert normalise("") == ""
    assert normalise("   ") == ""


def test_tokenise_words_returns_list():
    assert tokenise_words("the quick brown fox") == ["the", "quick", "brown", "fox"]


def test_tokenise_chars_drops_whitespace():
    assert tokenise_chars("hello world") == list("helloworld")


@pytest.mark.parametrize("ref,hyp,expected", [
    ([], [], 0),
    (["a"], [], 1),
    ([], ["a"], 1),
    (list("kitten"), list("sitting"), 3),     # classic example
    (["the", "quick"], ["the", "quick"], 0),
    (["the", "deal"], ["the", "deals"], 1),   # one substitution
])
def test_levenshtein_known_values(ref, hyp, expected):
    assert levenshtein(ref, hyp) == expected


# ---------------------------------------------------------------------------
# WER
# ---------------------------------------------------------------------------

def test_wer_perfect_match_is_zero():
    wer = get_strategy("wer")
    result = wer.compute([Sample(reference="the deal is closed", hypothesis="the deal is closed")])
    assert result.value == 0.0
    assert result.sample_count == 1


def test_wer_one_substitution_in_four_words():
    wer = get_strategy("wer")
    result = wer.compute([
        Sample(reference="the deal is closed", hypothesis="the deal is closing"),
    ])
    assert result.value == pytest.approx(0.25)


def test_wer_aggregates_macro_average():
    wer = get_strategy("wer")
    result = wer.compute([
        Sample(reference="the deal is closed", hypothesis="the deal is closed"),    # 0.0
        Sample(reference="the deal is closed", hypothesis="the deal is closing"),   # 0.25
        Sample(reference="alpha beta", hypothesis="gamma delta"),                   # 1.0
    ])
    assert result.value == pytest.approx((0.0 + 0.25 + 1.0) / 3)
    assert result.sample_count == 3


def test_wer_caps_at_one_for_total_miss():
    wer = get_strategy("wer")
    result = wer.compute([Sample(reference="hello", hypothesis="x x x x x x")])
    assert result.value == 1.0


def test_wer_handles_empty_reference_as_one():
    wer = get_strategy("wer")
    result = wer.compute([Sample(reference="", hypothesis="hello world")])
    assert result.value == 1.0


def test_wer_normalises_case_and_punctuation():
    wer = get_strategy("wer")
    result = wer.compute([
        Sample(reference="Hello, World!", hypothesis="hello world"),
    ])
    assert result.value == 0.0


def test_wer_empty_input_returns_zero_value():
    result = get_strategy("wer").compute([])
    assert result.value == 0.0
    assert result.sample_count == 0


# ---------------------------------------------------------------------------
# CER
# ---------------------------------------------------------------------------

def test_cer_perfect_match_is_zero():
    cer = get_strategy("cer")
    result = cer.compute([Sample(reference="hello world", hypothesis="hello world")])
    assert result.value == 0.0


def test_cer_one_char_substitution():
    cer = get_strategy("cer")
    # "kitten" vs "sitten" — 1 char different out of 6.
    result = cer.compute([Sample(reference="kitten", hypothesis="sitten")])
    assert result.value == pytest.approx(1 / 6)


def test_cer_classic_kitten_to_sitting():
    cer = get_strategy("cer")
    # Levenshtein distance 3, reference length 6.
    result = cer.compute([Sample(reference="kitten", hypothesis="sitting")])
    assert result.value == pytest.approx(3 / 6)


def test_cer_handles_cjk_no_whitespace():
    cer = get_strategy("cer")
    # 4 chars vs 4 chars, one differs.
    result = cer.compute([Sample(reference="你好世界", hypothesis="你好天界")])
    assert result.value == pytest.approx(1 / 4)


def test_cer_breakdown_counts_chars():
    cer = get_strategy("cer")
    result = cer.compute([
        Sample(reference="hello", hypothesis="hello"),     # 5 ref, 5 hyp
        Sample(reference="world!", hypothesis="world"),    # 5 ref (! stripped), 5 hyp
    ])
    assert result.breakdown["reference_chars"] == 10.0
    assert result.breakdown["hypothesis_chars"] == 10.0


# ---------------------------------------------------------------------------
# SMR
# ---------------------------------------------------------------------------

def test_smr_all_match_is_one():
    smr = get_strategy("sequence_match_rate")
    result = smr.compute([
        Sample(reference="GB82 WEST 1234", hypothesis="gb82 west 1234"),  # normalised match
        Sample(reference="hello world", hypothesis="Hello, world!"),
    ])
    assert result.value == 1.0
    assert result.breakdown == {"matches": 2.0, "total": 2.0}


def test_smr_partial_matches_are_zero():
    smr = get_strategy("sequence_match_rate")
    result = smr.compute([
        Sample(reference="GB82 WEST 1234", hypothesis="GB82 WEST 1235"),  # one char off
    ])
    assert result.value == 0.0


def test_smr_two_of_three():
    smr = get_strategy("sequence_match_rate")
    result = smr.compute([
        Sample(reference="alpha", hypothesis="alpha"),
        Sample(reference="beta", hypothesis="beta"),
        Sample(reference="gamma", hypothesis="delta"),
    ])
    assert result.value == pytest.approx(2 / 3)
    assert result.sample_count == 3


def test_smr_empty_input_returns_zero():
    result = get_strategy("sequence_match_rate").compute([])
    assert result.value == 0.0
    assert result.sample_count == 0


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

def test_all_new_strategies_registered():
    names = set(list_strategies())
    assert {"f1", "wer", "cer", "sequence_match_rate"} <= names
