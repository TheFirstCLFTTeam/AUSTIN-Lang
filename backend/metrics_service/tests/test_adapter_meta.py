import json
import os

import pytest

from adapter_meta import (
    adapter_config_path,
    default_adapters_dir,
    get_base_model,
    read_adapter_config,
)


def _write_adapter(tmp_path, name, config):
    adapter_dir = tmp_path / name
    adapter_dir.mkdir(parents=True)
    (adapter_dir / "adapter_config.json").write_text(
        json.dumps(config), encoding="utf-8"
    )
    return str(tmp_path)


def test_adapter_config_path_joins_correctly(tmp_path):
    p = adapter_config_path("fypaudio-W-lv3t", str(tmp_path))
    assert p.name == "adapter_config.json"
    assert p.parent.name == "fypaudio-W-lv3t"


def test_read_adapter_config_returns_dict(tmp_path):
    adapters_dir = _write_adapter(
        tmp_path, "fypaudio", {"base_model_name_or_path": "openai/whisper-large-v3-turbo", "r": 8}
    )
    cfg = read_adapter_config("fypaudio", adapters_dir)
    assert cfg["base_model_name_or_path"] == "openai/whisper-large-v3-turbo"
    assert cfg["r"] == 8


def test_read_adapter_config_missing_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="adapter config not found"):
        read_adapter_config("missing", str(tmp_path))


def test_get_base_model_returns_value(tmp_path):
    adapters_dir = _write_adapter(
        tmp_path, "fypaudio", {"base_model_name_or_path": "openai/whisper-large-v3-turbo"}
    )
    assert get_base_model("fypaudio", adapters_dir) == "openai/whisper-large-v3-turbo"


def test_get_base_model_missing_field_raises(tmp_path):
    adapters_dir = _write_adapter(tmp_path, "anon", {"r": 8})
    with pytest.raises(ValueError, match="no base_model_name_or_path"):
        get_base_model("anon", adapters_dir)


def test_default_adapters_dir_uses_env(monkeypatch):
    monkeypatch.setenv("ADAPTERS_DIR", "/tmp/test/adapters")
    assert default_adapters_dir() == "/tmp/test/adapters"


def test_default_adapters_dir_falls_back(monkeypatch):
    monkeypatch.delenv("ADAPTERS_DIR", raising=False)
    assert default_adapters_dir() == "/app/adapters"
