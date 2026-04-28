"""Inference fan-out for `/evaluations/run` (§3.1 #2 of the integration
backlog).

When the eval manifest declares `audio_path` but no `hypothesis`, the
metrics-service can't run any of the strategies. This module fills in
the blanks by POSTing each clip to `transcription-service-2:/transcribe`
with the requested adapter (`domain=<adapter_name>`) and stamping the
returned text on the sample.

Why the fan-out lives here instead of in `transcription-service-2`:

  - The eval surface is metrics-service's responsibility — keeping the
    fan-out close to the loader makes the failure model obvious (one
    clip's inference timeout doesn't cascade into the rest).
  - transcription-service-2 already exposes a per-clip endpoint; we
    just need a thin client + concurrency cap.
  - Future swap-out: when a batched inference endpoint exists (TS-2's
    GPU is the bottleneck, not the HTTP overhead), this module is the
    one place to change.

Concurrency cap matters: TS-2 holds a GPU lock per call; firing 1000
parallel requests at it would queue 1000 deep on the GPU and starve
every other caller (transcription orchestrator, dashboard, etc.). The
default of 4 worker threads is conservative; bump
`INFERENCE_FANOUT_CONCURRENCY` when running against a multi-GPU box.

Failure mode: per-clip exception → that clip's hypothesis stays None
in the returned dict. Caller decides whether to score it as a fully
wrong sample (the existing strategies already handle None hypothesis
that way) or to fail the whole eval.
"""
from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import requests


log = logging.getLogger(__name__)


DEFAULT_TRANSCRIPTION_SERVICE_URL = "http://transcription-service-2:8005"
DEFAULT_CONCURRENCY = 4
DEFAULT_TIMEOUT_SECONDS = 60.0


class InferenceFanoutError(Exception):
    """Raised only on input-shape problems the caller can't recover
    from (missing audio_path on a clip that needs inference). Per-clip
    network/HTTP failures don't raise — they leave that clip's slot
    None and log at WARNING."""

    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _service_url() -> str:
    return os.getenv(
        "TRANSCRIPTION_SERVICE_2_URL", DEFAULT_TRANSCRIPTION_SERVICE_URL,
    ).rstrip("/")


def _concurrency() -> int:
    raw = os.getenv("INFERENCE_FANOUT_CONCURRENCY")
    if not raw:
        return DEFAULT_CONCURRENCY
    try:
        n = int(raw)
        return max(1, n)
    except ValueError:
        return DEFAULT_CONCURRENCY


def _transcribe_one(
    audio_path: str,
    *,
    adapter_name: Optional[str],
    base_url: str,
    timeout_seconds: float,
) -> Optional[str]:
    """Single-clip POST. Returns the predicted text, or None on any
    failure. The HTTP shape mirrors `transcription-service-2/main.py`
    line 168: multipart `audio` file + form fields `language` (omitted
    here — eval manifest doesn't declare per-clip language for the
    inference call) and `domain` (the adapter name, or "base" / blank
    for vendor-baseline runs)."""
    p = Path(audio_path)
    if not p.is_file():
        log.warning(
            "inference fan-out: audio file %s not found, skipping", audio_path,
        )
        return None
    domain = adapter_name if adapter_name else "base"
    try:
        with p.open("rb") as fh:
            files = {"audio": (p.name, fh)}
            data = {"domain": domain}
            response = requests.post(
                f"{base_url}/transcribe",
                files=files,
                data=data,
                timeout=timeout_seconds,
            )
    except requests.RequestException as err:
        log.warning(
            "inference fan-out: %s POST failed for %s: %s",
            base_url, audio_path, err,
        )
        return None
    if not response.ok:
        log.warning(
            "inference fan-out: %s returned HTTP %s for %s",
            base_url, response.status_code, audio_path,
        )
        return None
    try:
        body = response.json()
    except ValueError:
        log.warning(
            "inference fan-out: non-JSON response for %s", audio_path,
        )
        return None
    text = body.get("text")
    if text is None:
        log.warning(
            "inference fan-out: response for %s has no `text` field",
            audio_path,
        )
    return text


def fan_out(
    audio_paths: Iterable[str],
    *,
    adapter_name: Optional[str] = None,
    base_url: Optional[str] = None,
    concurrency: Optional[int] = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> Dict[str, Optional[str]]:
    """Run inference for a batch of audio paths. Returns a dict mapping
    each input audio path to its predicted text (or None on failure).

    Order is not preserved (ThreadPoolExecutor.as_completed); callers
    look up by audio_path key. Duplicate audio_paths in the input
    iterable are deduplicated before fanning out — a manifest with the
    same clip on two lines only invokes inference once.
    """
    paths_seen: List[str] = []
    seen_set = set()
    for ap in audio_paths:
        if ap and ap not in seen_set:
            seen_set.add(ap)
            paths_seen.append(ap)
    if not paths_seen:
        return {}

    url = (base_url or _service_url()).rstrip("/")
    workers = concurrency if concurrency is not None else _concurrency()

    out: Dict[str, Optional[str]] = {p: None for p in paths_seen}
    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_path = {
            executor.submit(
                _transcribe_one,
                p,
                adapter_name=adapter_name,
                base_url=url,
                timeout_seconds=timeout_seconds,
            ): p
            for p in paths_seen
        }
        for fut in as_completed(future_to_path):
            path = future_to_path[fut]
            try:
                out[path] = fut.result()
            except Exception as err:  # noqa: BLE001 — log + leave None
                log.warning(
                    "inference fan-out: unexpected error for %s: %s",
                    path, err,
                )
                out[path] = None
    return out


def split_samples_needing_inference(samples) -> Tuple[list, list]:
    """Partition a sample list into (already-have-hypothesis, need-inference).

    A sample needs inference when its hypothesis is None (manifest
    omitted the field). Empty-string hypotheses are kept as-is — that's
    the "model deliberately predicted nothing" case which the
    strategies already score as a fully wrong sample.

    Samples needing inference must have an `audio_path`; one without
    raises `InferenceFanoutError(400)` so the caller can return a
    helpful error to the engineer.
    """
    have_hyp = []
    need = []
    for s in samples:
        if s.hypothesis is None:
            if not s.audio_path:
                raise InferenceFanoutError(
                    f"manifest sample (reference={s.reference[:40]!r}…) "
                    f"is missing both 'hypothesis' and 'audio_path'; cannot "
                    f"score or fan out inference"
                )
            need.append(s)
        else:
            have_hyp.append(s)
    return have_hyp, need
