import json
import pytest

from manifest_loader import ManifestError, load_manifest


def _write(tmp_path, lines):
    path = tmp_path / "manifest.jsonl"
    path.write_text("\n".join(lines), encoding="utf-8")
    return str(path)


def test_load_manifest_basic_ref_hyp(tmp_path):
    path = _write(tmp_path, [
        json.dumps({"reference": "the deal is closed", "hypothesis": "the deal is closing"}),
        json.dumps({"reference": "EBITDA up", "hypothesis": "EBITDA up"}),
    ])
    samples = load_manifest(path)
    assert len(samples) == 2
    assert samples[0].reference == "the deal is closed"
    assert samples[0].hypothesis == "the deal is closing"
    assert samples[0].audio_path is None
    assert samples[1].hypothesis == "EBITDA up"


def test_load_manifest_carries_audio_path_and_tags(tmp_path):
    path = _write(tmp_path, [
        json.dumps({
            "audio_path": "data/eval/clip_001.wav",
            "reference": "hello",
            "hypothesis": "hello world",
            "tags": {"language": "en", "speaker": "spk_01"},
        })
    ])
    s = load_manifest(path)[0]
    assert s.audio_path == "data/eval/clip_001.wav"
    assert s.tags == {"language": "en", "speaker": "spk_01"}


def test_load_manifest_skips_blank_lines(tmp_path):
    path = _write(tmp_path, [
        "",
        json.dumps({"reference": "a", "hypothesis": "a"}),
        "   ",
        json.dumps({"reference": "b", "hypothesis": "b"}),
        "",
    ])
    samples = load_manifest(path)
    assert len(samples) == 2


def test_load_manifest_missing_hypothesis_defaults_to_empty(tmp_path):
    # Future use: hypothesis filled in by inference fan-out. Today the
    # absence is allowed but the value falls back to "" so strategies
    # treat it as a total miss rather than crashing.
    path = _write(tmp_path, [json.dumps({"reference": "hello"})])
    s = load_manifest(path)[0]
    assert s.hypothesis == ""


def test_load_manifest_missing_reference_raises(tmp_path):
    path = _write(tmp_path, [json.dumps({"hypothesis": "hello"})])
    with pytest.raises(ManifestError, match="missing required field 'reference'"):
        load_manifest(path)


def test_load_manifest_invalid_json_raises_with_line_no(tmp_path):
    path = _write(tmp_path, [
        json.dumps({"reference": "ok", "hypothesis": "ok"}),
        "{not json",
    ])
    with pytest.raises(ManifestError, match="line 2"):
        load_manifest(path)


def test_load_manifest_non_object_raises(tmp_path):
    path = _write(tmp_path, ['["not", "an", "object"]'])
    with pytest.raises(ManifestError, match="must be a JSON object"):
        load_manifest(path)


def test_load_manifest_missing_file_raises_filenotfound(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_manifest(str(tmp_path / "does-not-exist.jsonl"))
