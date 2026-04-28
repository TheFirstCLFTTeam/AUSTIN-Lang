import json
import os
from pathlib import Path
from typing import Any, Dict


def adapter_config_path(adapter_name: str, adapters_dir: str) -> Path:
    return Path(adapters_dir) / adapter_name / "adapter_config.json"


def read_adapter_config(adapter_name: str, adapters_dir: str) -> Dict[str, Any]:
    cfg = adapter_config_path(adapter_name, adapters_dir)
    if not cfg.is_file():
        raise FileNotFoundError(f"adapter config not found: {cfg}")
    with cfg.open(encoding="utf-8") as fh:
        return json.load(fh)


def get_base_model(adapter_name: str, adapters_dir: str) -> str:
    config = read_adapter_config(adapter_name, adapters_dir)
    base = config.get("base_model_name_or_path")
    if not base:
        raise ValueError(
            f"adapter {adapter_name!r} has no base_model_name_or_path in adapter_config.json"
        )
    return base


def default_adapters_dir() -> str:
    return os.getenv("ADAPTERS_DIR", "/app/adapters")
