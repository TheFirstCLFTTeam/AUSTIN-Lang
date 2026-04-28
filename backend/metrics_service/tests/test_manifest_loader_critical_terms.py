"""Manifest-loader coverage for the new `critical_terms` typed field.

The existing test_manifest_loader.py covers the base shape; this file
adds the slice 4 cases.
"""
import json
from pathlib import Path

import pytest

from manifest_loader import ManifestError, load_manifest


def _write_jsonl(tmp_path: Path, rows):
    path = tmp_path / "manifest.jsonl"
    path.write_text(
        "\n".join(json.dumps(row) for row in rows) + "\n",
        encoding="utf-8",
    )
    return path


def test_critical_terms_round_trips(tmp_path):
    path = _write_jsonl(tmp_path, [
        {"reference": "EBITDA up", "hypothesis": "earnings up",
         "critical_terms": ["EBITDA"]},
    ])
    samples = load_manifest(str(path))
    assert len(samples) == 1
    assert samples[0].critical_terms == ["EBITDA"]


def test_critical_terms_optional_default_none(tmp_path):
    path = _write_jsonl(tmp_path, [
        {"reference": "EBITDA up", "hypothesis": "earnings up"},
    ])
    samples = load_manifest(str(path))
    assert samples[0].critical_terms is None


def test_critical_terms_empty_list_preserved(tmp_path):
    """[] != None — empty list means term-aware manifest with no matches."""
    path = _write_jsonl(tmp_path, [
        {"reference": "the cat", "hypothesis": "the cat", "critical_terms": []},
    ])
    samples = load_manifest(str(path))
    assert samples[0].critical_terms == []


def test_critical_terms_non_list_rejected(tmp_path):
    path = _write_jsonl(tmp_path, [
        {"reference": "x", "hypothesis": "x", "critical_terms": "EBITDA"},
    ])
    with pytest.raises(ManifestError, match="critical_terms.*list"):
        load_manifest(str(path))


def test_critical_terms_coerced_to_strings(tmp_path):
    # JSON allows numbers / nulls in arrays; we coerce to str rather than
    # error so manifests built from sloppy upstream data still load.
    path = _write_jsonl(tmp_path, [
        {"reference": "x", "hypothesis": "x", "critical_terms": [1, "EBITDA"]},
    ])
    samples = load_manifest(str(path))
    assert samples[0].critical_terms == ["1", "EBITDA"]


def test_mixed_manifest_some_with_terms(tmp_path):
    path = _write_jsonl(tmp_path, [
        {"reference": "EBITDA", "hypothesis": "EBITDA", "critical_terms": ["EBITDA"]},
        {"reference": "the cat", "hypothesis": "the cat"},
    ])
    samples = load_manifest(str(path))
    assert samples[0].critical_terms == ["EBITDA"]
    assert samples[1].critical_terms is None
