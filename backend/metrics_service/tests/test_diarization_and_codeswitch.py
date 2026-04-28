"""Tests for the three remaining dashboard strategies that closed
§3.1 #1 of the integration backlog (2026-04-28):

  - code_switch_pier        (Sample.language_spans)
  - word_diarization_error  (Sample.speakers + Sample.hypothesis_speakers)
  - speaker_diarization     (Sample.speakers + Sample.hypothesis_speakers)

Plus the manifest_loader extensions that parse the three new fields.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from manifest_loader import ManifestError, load_manifest  # noqa: E402
from strategies.base import Sample  # noqa: E402
from strategies.code_switch_pier import CodeSwitchPier  # noqa: E402
from strategies.speaker_diarization import SpeakerDiarization  # noqa: E402
from strategies.word_diarization_error import WordDiarizationError  # noqa: E402


# ---------------------------------------------------------------------------
# code_switch_pier
# ---------------------------------------------------------------------------

def test_cspier_perfect_recovery():
    samples = [
        Sample(
            reference="hello 你好 world",
            hypothesis="hello 你好 world",
            language_spans=[
                (0, 5, "en"),
                (6, 8, "zh"),
                (9, 14, "en"),
            ],
        ),
    ]
    result = CodeSwitchPier().compute(samples)
    # All three spans recovered → 1.0 macro recovery → 0.0 error.
    assert result.value == pytest.approx(0.0)
    assert result.breakdown["macro_recovery_rate"] == pytest.approx(1.0)


def test_cspier_lost_chinese_phrase_drives_error_up():
    samples = [
        Sample(
            reference="hello 你好 world",
            hypothesis="hello world",  # 你好 dropped
            language_spans=[
                (0, 5, "en"),
                (6, 8, "zh"),
                (9, 14, "en"),
            ],
        ),
    ]
    result = CodeSwitchPier().compute(samples)
    # 2/3 spans recovered → recovery 0.667 → error 0.333.
    assert result.value == pytest.approx(1.0 / 3, abs=1e-3)
    assert result.breakdown["recovered.zh"] == 0.0
    assert result.breakdown["total.zh"] == 1.0
    assert result.breakdown["recovered.en"] == 2.0


def test_cspier_skips_monolingual_samples():
    samples = [
        Sample(
            reference="hello world",
            hypothesis="hello world",
            language_spans=[(0, 11, "en")],
        ),
        Sample(
            reference="hello 你好",
            hypothesis="hello 你好",
            language_spans=[(0, 5, "en"), (6, 8, "zh")],
        ),
    ]
    result = CodeSwitchPier().compute(samples)
    assert result.sample_count == 1
    assert result.breakdown["samples_skipped_monolingual"] == 1.0


def test_cspier_skips_no_spans_samples():
    samples = [
        Sample(reference="hello world", hypothesis="hello world"),
        Sample(reference="hello world", hypothesis="hello world", language_spans=[]),
    ]
    result = CodeSwitchPier().compute(samples)
    assert result.sample_count == 0
    assert result.breakdown["samples_skipped_no_spans"] == 2.0


def test_cspier_per_language_breakdown_aggregates_across_samples():
    samples = [
        Sample(
            reference="a 你好 b",
            hypothesis="a 你好 b",
            language_spans=[(0, 1, "en"), (2, 4, "zh"), (5, 6, "en")],
        ),
        Sample(
            reference="x 你好 y",
            hypothesis="x y",  # 你好 dropped
            language_spans=[(0, 1, "en"), (2, 4, "zh"), (5, 6, "en")],
        ),
    ]
    result = CodeSwitchPier().compute(samples)
    assert result.breakdown["total.zh"] == 2.0
    assert result.breakdown["recovered.zh"] == 1.0


# ---------------------------------------------------------------------------
# word_diarization_error
# ---------------------------------------------------------------------------

def test_wder_skips_when_no_ref_speakers():
    samples = [Sample(reference="hello", hypothesis="hello")]
    result = WordDiarizationError().compute(samples)
    assert result.sample_count == 0
    assert result.breakdown["samples_skipped_no_ref_speakers"] == 1.0


def test_wder_skips_when_no_hypothesis_speakers():
    """Today's case — every real sample falls here until the
    diarisation post-processor lands."""
    samples = [
        Sample(
            reference="hello world",
            hypothesis="hello world",
            speakers=[(0, 5, "S1"), (6, 11, "S2")],
        ),
    ]
    result = WordDiarizationError().compute(samples)
    assert result.sample_count == 0
    assert result.breakdown["samples_skipped_no_hypothesis_speakers"] == 1.0


def test_wder_perfect_speaker_alignment():
    samples = [
        Sample(
            reference="alice bob",
            hypothesis="alice bob",
            speakers=[(0, 5, "A"), (6, 9, "B")],
            hypothesis_speakers=[(0, 5, "A"), (6, 9, "B")],
        ),
    ]
    result = WordDiarizationError().compute(samples)
    assert result.value == pytest.approx(0.0)


def test_wder_swapped_speakers_drives_error_up():
    samples = [
        Sample(
            reference="alice bob",
            hypothesis="alice bob",
            speakers=[(0, 5, "A"), (6, 9, "B")],
            hypothesis_speakers=[(0, 5, "B"), (6, 9, "A")],
        ),
    ]
    result = WordDiarizationError().compute(samples)
    # Both words get the wrong speaker → 1.0 disagreement.
    assert result.value == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# speaker_diarization
# ---------------------------------------------------------------------------

def test_speaker_dia_skips_when_no_metadata():
    samples = [Sample(reference="hi", hypothesis="hi")]
    result = SpeakerDiarization().compute(samples)
    assert result.sample_count == 0
    assert result.breakdown["samples_skipped_no_ref_speakers"] == 1.0


def test_speaker_dia_perfect_set_match():
    samples = [
        Sample(
            reference="x y", hypothesis="x y",
            speakers=[(0, 1, "A"), (2, 3, "B")],
            hypothesis_speakers=[(0, 1, "A"), (2, 3, "B")],
        ),
    ]
    result = SpeakerDiarization().compute(samples)
    assert result.value == pytest.approx(0.0)
    assert result.breakdown["avg_ref_speakers"] == 2.0
    assert result.breakdown["avg_hyp_speakers"] == 2.0


def test_speaker_dia_disjoint_speakers_score_one():
    samples = [
        Sample(
            reference="x", hypothesis="x",
            speakers=[(0, 1, "A")],
            hypothesis_speakers=[(0, 1, "X")],
        ),
    ]
    result = SpeakerDiarization().compute(samples)
    # Symmetric difference {A,X}, union {A,X} → 2/2 = 1.0.
    assert result.value == pytest.approx(1.0)


def test_speaker_dia_phantom_speaker_partial_score():
    samples = [
        Sample(
            reference="x y", hypothesis="x y",
            speakers=[(0, 1, "A"), (2, 3, "B")],
            hypothesis_speakers=[
                (0, 1, "A"), (2, 3, "B"), (3, 3, "Z"),
            ],
        ),
    ]
    result = SpeakerDiarization().compute(samples)
    # Symmetric diff {Z}, union {A,B,Z} → 1/3.
    assert result.value == pytest.approx(1.0 / 3)


# ---------------------------------------------------------------------------
# manifest_loader new fields
# ---------------------------------------------------------------------------

def _write_manifest(tmp_path, lines):
    p = tmp_path / "manifest.jsonl"
    p.write_text("\n".join(json.dumps(d) for d in lines), encoding="utf-8")
    return str(p)


def test_manifest_loads_speakers(tmp_path):
    path = _write_manifest(tmp_path, [{
        "reference": "hello world",
        "hypothesis": "hello world",
        "speakers": [[0, 5, "A"], [6, 11, "B"]],
    }])
    samples = load_manifest(path)
    assert samples[0].speakers == [(0, 5, "A"), (6, 11, "B")]


def test_manifest_loads_hypothesis_speakers(tmp_path):
    path = _write_manifest(tmp_path, [{
        "reference": "hello",
        "hypothesis": "hello",
        "hypothesis_speakers": [[0, 5, "A"]],
    }])
    samples = load_manifest(path)
    assert samples[0].hypothesis_speakers == [(0, 5, "A")]


def test_manifest_loads_language_spans(tmp_path):
    path = _write_manifest(tmp_path, [{
        "reference": "hello 你好",
        "hypothesis": "hello 你好",
        "language_spans": [[0, 5, "en"], [6, 8, "zh"]],
    }])
    samples = load_manifest(path)
    assert samples[0].language_spans == [(0, 5, "en"), (6, 8, "zh")]


def test_manifest_rejects_malformed_speakers(tmp_path):
    path = _write_manifest(tmp_path, [{
        "reference": "hi",
        "speakers": [[0, 2]],
    }])
    with pytest.raises(ManifestError, match="speakers"):
        load_manifest(path)


def test_manifest_rejects_inverted_language_span(tmp_path):
    path = _write_manifest(tmp_path, [{
        "reference": "hi",
        "language_spans": [[5, 2, "en"]],
    }])
    with pytest.raises(ManifestError, match="invalid range"):
        load_manifest(path)


def test_manifest_legacy_rows_default_new_speaker_fields_to_none(tmp_path):
    path = _write_manifest(tmp_path, [{"reference": "hi", "hypothesis": "hi"}])
    samples = load_manifest(path)
    s = samples[0]
    assert s.speakers is None
    assert s.hypothesis_speakers is None
    assert s.language_spans is None
