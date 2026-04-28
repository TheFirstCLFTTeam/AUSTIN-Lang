"""Tests for english_accuracy + mandarin_accuracy + the shared
per_language_accuracy helper they delegate to.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from strategies._per_language import per_language_accuracy  # noqa: E402
from strategies.base import Sample  # noqa: E402
from strategies.english_accuracy import EnglishAccuracy  # noqa: E402
from strategies.mandarin_accuracy import MandarinAccuracy  # noqa: E402


# ---------------------------------------------------------------------------
# english_accuracy
# ---------------------------------------------------------------------------

def test_english_accuracy_perfect_match_scores_one():
    samples = [
        Sample(reference="hello world", hypothesis="hello world", language="en"),
    ]
    result = EnglishAccuracy().compute(samples)
    assert result.value == pytest.approx(1.0)
    assert result.sample_count == 1


def test_english_accuracy_one_substitution_drops_to_half():
    samples = [
        Sample(reference="hello world", hypothesis="hello earth", language="en"),
    ]
    result = EnglishAccuracy().compute(samples)
    # 1 sub on 2 ref words = WER 0.5 → accuracy 0.5.
    assert result.value == pytest.approx(0.5)
    assert result.breakdown["macro_wer"] == pytest.approx(0.5)


def test_english_accuracy_filters_out_non_english_samples():
    samples = [
        Sample(reference="hello", hypothesis="hello", language="en"),
        Sample(reference="你好", hypothesis="你好", language="zh"),
    ]
    result = EnglishAccuracy().compute(samples)
    assert result.sample_count == 1
    assert result.breakdown["samples_skipped_other_language"] == 1.0


def test_english_accuracy_accepts_regional_variants():
    samples = [
        Sample(reference="colour", hypothesis="colour", language="en-GB"),
        Sample(reference="lah", hypothesis="lah", language="en-sg"),
        Sample(reference="hello", hypothesis="hello", language="EN"),  # case-insensitive
    ]
    result = EnglishAccuracy().compute(samples)
    assert result.sample_count == 3


def test_english_accuracy_skips_no_language_tag():
    samples = [
        Sample(reference="hello", hypothesis="hello"),
        Sample(reference="hello", hypothesis="hello", language="en"),
    ]
    result = EnglishAccuracy().compute(samples)
    assert result.sample_count == 1
    assert result.breakdown["samples_skipped_no_language"] == 1.0


def test_english_accuracy_returns_zero_with_zero_count_when_no_match():
    samples = [
        Sample(reference="你好", hypothesis="你好", language="zh"),
    ]
    result = EnglishAccuracy().compute(samples)
    assert result.value == 0.0
    assert result.sample_count == 0


def test_english_accuracy_accuracy_in_zero_one_range():
    # Returns (1 - WER) in [0, 1] — confirmed by the merge layer's
    # fraction → percentage scaling. Pin the convention.
    samples = [
        Sample(reference="a b c d", hypothesis="a b c d", language="en"),
    ]
    result = EnglishAccuracy().compute(samples)
    assert 0.0 <= result.value <= 1.0


# ---------------------------------------------------------------------------
# mandarin_accuracy
# ---------------------------------------------------------------------------

def test_mandarin_accuracy_picks_zh_zhcn_zhtw_cmn():
    samples = [
        Sample(reference="你好", hypothesis="你好", language="zh"),
        Sample(reference="台北", hypothesis="台北", language="zh-TW"),
        Sample(reference="北京", hypothesis="北京", language="cmn"),
    ]
    result = MandarinAccuracy().compute(samples)
    assert result.sample_count == 3


def test_mandarin_accuracy_excludes_cantonese():
    samples = [
        Sample(reference="你好", hypothesis="你好", language="zh"),
        Sample(reference="你好", hypothesis="你好", language="yue"),
    ]
    result = MandarinAccuracy().compute(samples)
    assert result.sample_count == 1
    assert result.breakdown["samples_skipped_other_language"] == 1.0


def test_mandarin_accuracy_tokenisation_warning_fires_for_unsegmented_cjk():
    # CJK without spaces collapses to one giant token under
    # tokenise_words → avg_tokens_per_sample is way under 3.
    samples = [
        Sample(reference="你好世界", hypothesis="你好世界", language="zh"),
        Sample(reference="今天天氣很好", hypothesis="今天天氣很好", language="zh"),
    ]
    result = MandarinAccuracy().compute(samples)
    assert result.breakdown["tokenisation_warning"] == 1.0
    assert result.breakdown["avg_tokens_per_sample"] < 3.0


def test_mandarin_accuracy_no_warning_when_pre_segmented():
    samples = [
        Sample(reference="你 好 世界 朋友 大家",
               hypothesis="你 好 世界 朋友 大家",
               language="zh"),
    ]
    result = MandarinAccuracy().compute(samples)
    assert result.breakdown["tokenisation_warning"] == 0.0


# ---------------------------------------------------------------------------
# per_language_accuracy direct
# ---------------------------------------------------------------------------

def test_helper_micro_wer_is_token_weighted():
    # Two samples — long ref with no errors + short ref with all errors.
    # Macro avg of WERs is (0 + 1)/2 = 0.5.
    # Micro WER is total_edits / total_ref_tokens = 2 / 7 ≈ 0.286.
    samples = [
        Sample(reference="a b c d e", hypothesis="a b c d e", language="en"),
        Sample(reference="x y", hypothesis="m n", language="en"),
    ]
    result = per_language_accuracy("test", samples, {"en"})
    assert result.breakdown["macro_wer"] == pytest.approx(0.5)
    assert result.breakdown["micro_wer"] == pytest.approx(2 / 7)
    assert result.value == pytest.approx(0.5)  # 1 - macro


def test_helper_skipped_buckets_sum_to_input_minus_scored():
    samples = [
        Sample(reference="hello", hypothesis="hello", language="en"),
        Sample(reference="你好", hypothesis="你好", language="zh"),
        Sample(reference="hi", hypothesis="hi"),  # no language
        Sample(reference="", hypothesis="", language="en"),  # empty ref
    ]
    result = per_language_accuracy("test", samples, {"en"})
    assert result.sample_count == 1
    assert result.breakdown["samples_skipped_other_language"] == 1.0
    assert result.breakdown["samples_skipped_no_language"] == 1.0
    assert result.breakdown["samples_skipped_empty_ref"] == 1.0
