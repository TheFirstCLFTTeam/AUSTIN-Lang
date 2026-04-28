"""Post-train evaluation kick-off.

Best-effort POST to the metrics service after a training round saves its
adapter. Failure is logged and swallowed — training success must not depend
on metrics availability.

Module reference: docs/06 server/metrics-service-module.md §5.3.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Iterable, Optional

import requests


log = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 10
DEFAULT_DATASET_NAME = "default_eval"
DEFAULT_STRATEGIES = ["f1"]


def _read_base_model(adapter_dir: Path) -> Optional[str]:
    cfg_path = adapter_dir / "adapter_config.json"
    if not cfg_path.is_file():
        log.warning("post-train hook: %s missing, cannot resolve base model", cfg_path)
        return None
    try:
        with cfg_path.open(encoding="utf-8") as fh:
            cfg = json.load(fh)
    except (OSError, json.JSONDecodeError) as err:
        log.warning("post-train hook: cannot read %s: %s", cfg_path, err)
        return None
    base = cfg.get("base_model_name_or_path")
    if not base:
        log.warning(
            "post-train hook: %s has no base_model_name_or_path", cfg_path
        )
    return base


def _resolve_manifest_path(adapter_name: str) -> Optional[str]:
    env_path = os.getenv("EVAL_MANIFEST_PATH")
    if env_path:
        return env_path if Path(env_path).is_file() else None

    candidate = Path("data") / f"{adapter_name}_eval_manifest.jsonl"
    return str(candidate) if candidate.is_file() else None


def post_train_evaluate(
    adapter_dir: str,
    adapter_name: str,
    *,
    dataset_name: Optional[str] = None,
    strategies: Optional[Iterable[str]] = None,
    metrics_service_url: Optional[str] = None,
    manifest_path: Optional[str] = None,
    adapter_version: Optional[str] = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> bool:
    """Fire the evaluation. Returns True on 2xx, False on any failure.

    Failures are logged at WARNING level. Callers should not branch on the
    return value to gate downstream behaviour — it exists for tests only.
    """
    url = metrics_service_url or os.getenv("METRICS_SERVICE_URL")
    if not url:
        log.info("post-train hook: METRICS_SERVICE_URL unset, skipping evaluation")
        return False

    adapter_path = Path(adapter_dir)
    base_model = _read_base_model(adapter_path)
    if not base_model:
        return False

    resolved_manifest = manifest_path or _resolve_manifest_path(adapter_name)
    if not resolved_manifest:
        log.info(
            "post-train hook: no eval manifest found for adapter %r, skipping",
            adapter_name,
        )
        return False

    payload = {
        "adapter_name": adapter_name,
        "dataset_name": dataset_name or os.getenv(
            "EVAL_DATASET_NAME", DEFAULT_DATASET_NAME
        ),
        "manifest_path": resolved_manifest,
        "strategies": list(strategies) if strategies else DEFAULT_STRATEGIES,
        "base_model": base_model,
        "adapter_version": adapter_version,
    }

    endpoint = url.rstrip("/") + "/evaluations/run"
    try:
        response = requests.post(endpoint, json=payload, timeout=timeout_seconds)
    except requests.RequestException as err:
        log.warning("post-train hook: POST %s failed: %s", endpoint, err)
        return False

    if not response.ok:
        log.warning(
            "post-train hook: %s returned HTTP %s: %s",
            endpoint,
            response.status_code,
            response.text[:300],
        )
        return False

    try:
        body = response.json()
        log.info(
            "post-train hook: evaluation %s recorded for adapter %r on dataset %r",
            body.get("id"),
            adapter_name,
            payload["dataset_name"],
        )
    except ValueError:
        log.info("post-train hook: evaluation accepted (non-JSON response)")
    return True
