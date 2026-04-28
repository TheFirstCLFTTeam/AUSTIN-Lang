"""Tests for the four dashboard strategies that landed alongside the
metric-service registry expansion (docs/06 server/metrics-service-
module.md §4.5):

  - punctuation_accuracy   (no metadata required)
  - weighted_wer            (Sample.info_values)
  - language_cer            (Sample.language)
  - entity_f1               (Sample.entity_spans)

Also covers the manifest_loader extensions that parse the new fields
into a Sample.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from manifest_loader import ManifestError, load_manifest  # noqa: E402
from strategies.base import Sample  # noqa: E402
from strategies.entity_f1 import EntityF1  # noqa: E402
from strategies.language_cer import LanguageCer  # noqa: E402
from strategies.punctuation_accuracy import PunctuationAccuracy  # noqa: E402
from strategies.weighted_wer import WeightedWer  # noqa: E402


# ---------------------------------------------------------------------------
# punctuation_accuracy
# ---------------------------------------------------------------------------

def test_punctuation_perfect_match_scores_one():
    samples = [Sample(reference="Hello, world!", hypothesis="Hello, world!")]
    result = PunctuationAccuracy().compute(samples)
    assert result.value == pytest.approx(1.0)
    assert result.sample_count == 1


def test_punctuation_missing_period_drops_score():
    # ref has '.', hyp doesn't — that's a deletion (false negative).
    samples = [Sample(reference="Hello world.", hypothesis="Hello world")]
    result = PunctuationAccuracy().compute(samples)
    assert result.value < 1.0
    assert result.breakdown["fn"] == 1.0


def test_punctuation_inserted_comma_drops_score():
    samples = [Sample(reference="Hello world", hypothesis="Hello, world")]
    result = PunctuationAccuracy().compute(samples)
    assert result.value < 1.0
    assert result.breakdown["fp"] == 1.0


def test_punctuation_skips_no_punct_samples():
    samples = [
        Sample(reference="hello world", hypothesis="hello world"),
        Sample(reference="foo bar", hypothesis="foo bar"),
        Sample(reference="hi.", hypothesis="hi."),
    ]
    result = PunctuationAccuracy().compute(samples)
    assert result.sample_count == 1
    assert result.breakdown["samples_skipped_no_punct"] == 2.0


def test_punctuation_handles_cjk_punctuation():
    samples = [Sample(reference="你好。", hypothesis="你好。")]
    result = PunctuationAccuracy().compute(samples)
    assert result.value == pytest.approx(1.0)


def test_punctuation_empty_iterable_returns_zero_with_zero_samples():
    result = PunctuationAccuracy().compute([])
    assert result.value == 0.0
    assert result.sample_count == 0


# ---------------------------------------------------------------------------
# weighted_wer
# ---------------------------------------------------------------------------

def test_weighted_wer_perfect_match():
    samples = [Sample(reference="hello world", hypothesis="hello world",
                      info_values=[1.0, 1.0])]
    result = WeightedWer().compute(samples)
    assert result.value == pytest.approx(0.0)
    assert result.breakdown["samples_weighted"] == 1.0


def test_weighted_wer_high_weight_word_dominates():
    # Substituting "EBITDA" (weight 10) costs more than substituting "the"
    # (weight 1). Two parallel samples; the high-weight error should
    # produce a higher (worse) WER.
    high = Sample(
        reference="EBITDA up", hypothesis="earnings up",
        info_values=[10.0, 1.0],
    )
    low = Sample(
        reference="the up", hypothesis="a up",
        info_values=[10.0, 1.0],  # weight on different word
    )
    high_score = WeightedWer().compute([high]).value
    # When the high-weight word is the one substituted, the per-sample
    # cost is 10/(10+1) ≈ 0.909.
    assert high_score == pytest.approx(10 / 11)


def test_weighted_wer_falls_back_to_uniform_when_info_values_missing():
    samples = [Sample(reference="hello world", hypothesis="hello earth")]
    result = WeightedWer().compute(samples)
    # 1 substitution on 2-word ref under uniform weights = 0.5.
    assert result.value == pytest.approx(0.5)
    assert result.breakdown["samples_uniform_fallback"] == 1.0
    assert result.breakdown["samples_weighted"] == 0.0


def test_weighted_wer_falls_back_when_info_values_length_mismatch():
    samples = [
        Sample(reference="hello world today",
               hypothesis="hello world",
               info_values=[1.0, 1.0]),  # too short
    ]
    result = WeightedWer().compute(samples)
    assert result.breakdown["samples_uniform_fallback"] == 1.0


def test_weighted_wer_caps_per_sample_at_one():
    # Heavy insertions can push raw WER above 1; we cap at 1.
    samples = [Sample(
        reference="a b",
        hypothesis="x y z w v u t s",
        info_values=[1.0, 1.0],
    )]
    result = WeightedWer().compute(samples)
    assert result.value <= 1.0


def test_weighted_wer_skips_empty_reference():
    samples = [
        Sample(reference="", hypothesis="something"),
        Sample(reference="hello", hypothesis="hello"),
    ]
    result = WeightedWer().compute(samples)
    assert result.sample_count == 1
    assert result.breakdown["samples_skipped_empty_ref"] == 1.0


# ---------------------------------------------------------------------------
# language_cer
# ---------------------------------------------------------------------------

def test_language_cer_groups_by_language():
    samples = [
        Sample(reference="hello", hypothesis="hello", language="en"),
        Sample(reference="你好", hypothesis="你好", language="zh"),
        Sample(reference="hello", hypothesis="helo", language="en"),
    ]
    result = LanguageCer().compute(samples)
    # Per-language breakdown surfaces both buckets.
    assert "cer.en" in result.breakdown
    assert "cer.zh" in result.breakdown
    assert result.breakdown["cer.zh"] == pytest.approx(0.0)
    # English has one perfect + one 1/5-char-error sample.
    # Combined ref chars: "hellohello" = 10. Edits: 1.
    assert result.breakdown["cer.en"] == pytest.approx(0.1)
    assert result.breakdown["languages_scored"] == 2.0


def test_language_cer_macro_average_is_unweighted():
    # English with 100 samples vs. Mandarin with 1 sample — macro is
    # equally weighted. Verify by constructing easy cases.
    en_samples = [Sample(reference="abc", hypothesis="abc", language="en")
                  for _ in range(10)]
    zh_samples = [Sample(reference="一二", hypothesis="三四", language="zh")]
    samples = en_samples + zh_samples
    result = LanguageCer().compute(samples)
    # English CER = 0; Mandarin CER = 1.0 (all chars wrong).
    # Macro = 0.5.
    assert result.value == pytest.approx(0.5)


def test_language_cer_skips_no_language_samples():
    samples = [
        Sample(reference="hello", hypothesis="hello"),
        Sample(reference="hello", hypothesis="hello", language="en"),
    ]
    result = LanguageCer().compute(samples)
    assert result.breakdown["samples_skipped_no_language"] == 1.0


def test_language_cer_empty_returns_zero_with_zero_samples():
    result = LanguageCer().compute([])
    assert result.sample_count == 0
    assert result.value == 0.0


# ---------------------------------------------------------------------------
# entity_f1
# ---------------------------------------------------------------------------

def test_entity_f1_perfect_recovery():
    samples = [
        Sample(
            reference="Apple bought DeepMind",
            hypothesis="Apple bought DeepMind",
            entity_spans=[(0, 5, "ORG"), (13, 21, "ORG")],
        ),
    ]
    result = EntityF1().compute(samples)
    assert result.value == pytest.approx(1.0)
    assert result.breakdown["f1.ORG"] == pytest.approx(1.0)
    assert result.breakdown["total.ORG"] == 2.0


def test_entity_f1_partial_recovery():
    samples = [
        Sample(
            reference="Apple bought DeepMind",
            hypothesis="Apple bought deep mind",  # tokenisation breaks DeepMind
            entity_spans=[(0, 5, "ORG"), (13, 21, "ORG")],
        ),
    ]
    result = EntityF1().compute(samples)
    # Apple matches; DeepMind doesn't (one-token "deepmind" not in
    # ["apple","bought","deep","mind"]).
    assert result.value == pytest.approx(0.5)


def test_entity_f1_per_label_breakdown():
    samples = [
        Sample(
            reference="Apple paid Tim Cook ten dollars",
            hypothesis="Apple paid Tim Cook ten dollars",
            entity_spans=[
                (0, 5, "ORG"),
                (11, 19, "PERSON"),
                (20, 31, "MONEY"),
            ],
        ),
    ]
    result = EntityF1().compute(samples)
    assert result.breakdown["f1.ORG"] == pytest.approx(1.0)
    assert result.breakdown["f1.PERSON"] == pytest.approx(1.0)
    assert result.breakdown["f1.MONEY"] == pytest.approx(1.0)


def test_entity_f1_skips_no_spans():
    samples = [
        Sample(reference="hello", hypothesis="hello"),  # entity_spans is None
        Sample(reference="hello", hypothesis="hello", entity_spans=[]),
        Sample(reference="Apple",
               hypothesis="Apple",
               entity_spans=[(0, 5, "ORG")]),
    ]
    result = EntityF1().compute(samples)
    assert result.sample_count == 1
    assert result.breakdown["samples_skipped_no_spans"] == 1.0
    assert result.breakdown["samples_skipped_empty_spans"] == 1.0


def test_entity_f1_handles_zero_label_count_safely():
    samples = [
        Sample(
            reference="Apple",
            hypothesis="Apple",
            entity_spans=[(0, 5, "ORG")],
        ),
    ]
    # Just confirms no division-by-zero on the per-label aggregator.
    result = EntityF1().compute(samples)
    assert result.value == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# manifest_loader — new fields
# ---------------------------------------------------------------------------

def _write_manifest(tmp_path, lines):
    p = tmp_path / "manifest.jsonl"
    p.write_text("\n".join(json.dumps(d) for d in lines), encoding="utf-8")
    return str(p)


def test_manifest_loads_info_values(tmp_path):
    path = _write_manifest(tmp_path, [
        {"reference": "hello world",
         "hypothesis": "hello world",
         "info_values": [1.0, 5.0]},
    ])
    samples = load_manifest(path)
    assert samples[0].info_values == [1.0, 5.0]


def test_manifest_rejects_non_numeric_info_values(tmp_path):
    path = _write_manifest(tmp_path, [
        {"reference": "hello", "info_values": ["high"]},
    ])
    with pytest.raises(ManifestError, match="info_values"):
        load_manifest(path)


def test_manifest_loads_language(tmp_path):
    path = _write_manifest(tmp_path, [
        {"reference": "hello", "hypothesis": "hello", "language": "en"},
    ])
    samples = load_manifest(path)
    assert samples[0].language == "en"


def test_manifest_rejects_non_string_language(tmp_path):
    path = _write_manifest(tmp_path, [
        {"reference": "hello", "language": 123},
    ])
    with pytest.raises(ManifestError, match="language"):
        load_manifest(path)


def test_manifest_loads_entity_spans(tmp_path):
    path = _write_manifest(tmp_path, [
        {"reference": "Apple",
         "hypothesis": "Apple",
         "entity_spans": [[0, 5, "ORG"]]},
    ])
    samples = load_manifest(path)
    assert samples[0].entity_spans == [(0, 5, "ORG")]


def test_manifest_rejects_malformed_entity_spans(tmp_path):
    path = _write_manifest(tmp_path, [
        {"reference": "Apple", "entity_spans": [[0, 5]]},  # missing label
    ])
    with pytest.raises(ManifestError, match="entity_spans"):
        load_manifest(path)


def test_manifest_rejects_negative_or_inverted_entity_span(tmp_path):
    path = _write_manifest(tmp_path, [
        {"reference": "Apple", "entity_spans": [[5, 2, "ORG"]]},
    ])
    with pytest.raises(ManifestError, match="invalid range"):
        load_manifest(path)


def test_manifest_legacy_rows_load_with_none_for_new_fields(tmp_path):
    # No info_values/language/entity_spans → fields default to None.
    path = _write_manifest(tmp_path, [
        {"reference": "hello", "hypothesis": "hello"},
    ])
    samples = load_manifest(path)
    s = samples[0]
    assert s.info_values is None
    assert s.language is None
    assert s.entity_spans is None
