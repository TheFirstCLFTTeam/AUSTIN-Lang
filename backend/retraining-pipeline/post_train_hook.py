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
    refresh_baseline: bool = True,
) -> bool:
    """Fire the evaluation. Returns True on 2xx, False on any failure.

    When `refresh_baseline=True` (the default), a `POST
    /evaluations/baseline` request fires before the adapter run. The
    metrics-service short-circuits that call when the latest baseline
    is within the `METRICS_BASELINE_FRESHNESS_DAYS` window (default
    30 days), so this is cheap on subsequent training rounds — the
    expensive inference pass only happens when the baseline is absent
    or stale. Set `refresh_baseline=False` to skip the call entirely
    (e.g. when you've just submitted a baseline manually).

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

    resolved_dataset = dataset_name or os.getenv(
        "EVAL_DATASET_NAME", DEFAULT_DATASET_NAME
    )
    resolved_strategies = list(strategies) if strategies else DEFAULT_STRATEGIES

    base_url = url.rstrip("/")

    if refresh_baseline:
        _maybe_refresh_baseline(
            base_url=base_url,
            base_model=base_model,
            dataset_name=resolved_dataset,
            manifest_path=resolved_manifest,
            strategies=resolved_strategies,
            timeout_seconds=timeout_seconds,
        )

    payload = {
        "adapter_name": adapter_name,
        "dataset_name": resolved_dataset,
        "manifest_path": resolved_manifest,
        "strategies": resolved_strategies,
        "base_model": base_model,
        "adapter_version": adapter_version,
    }

    endpoint = base_url + "/evaluations/run"
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


def _maybe_refresh_baseline(
    *,
    base_url: str,
    base_model: str,
    dataset_name: str,
    manifest_path: str,
    strategies: list,
    timeout_seconds: float,
) -> None:
    """Best-effort `POST /evaluations/baseline`. The metrics-service
    short-circuits when the latest baseline is fresh — that's the
    cheap path. On re-run after a stale window the inference pass
    fires server-side. Either outcome is logged at INFO; failures
    swallowed at WARNING (training success doesn't depend on this).
    """
    endpoint = base_url + "/evaluations/baseline"
    payload = {
        "base_model": base_model,
        "dataset_name": dataset_name,
        "manifest_path": manifest_path,
        "strategies": strategies,
    }
    try:
        response = requests.post(endpoint, json=payload, timeout=timeout_seconds)
    except requests.RequestException as err:
        log.warning("post-train hook: baseline POST %s failed: %s", endpoint, err)
        return
    if not response.ok:
        log.warning(
            "post-train hook: baseline %s returned HTTP %s: %s",
            endpoint, response.status_code, response.text[:300],
        )
        return
    try:
        body = response.json()
    except ValueError:
        log.info("post-train hook: baseline accepted (non-JSON response)")
        return
    if body.get("skipped"):
        log.info(
            "post-train hook: baseline skipped — fresh row exists "
            "(eval id %s, age %.1f days)",
            body.get("evaluation_id"), body.get("age_days", -1),
        )
    else:
        log.info(
            "post-train hook: baseline %s recorded for %r on %r",
            body.get("id"), base_model, dataset_name,
        )
