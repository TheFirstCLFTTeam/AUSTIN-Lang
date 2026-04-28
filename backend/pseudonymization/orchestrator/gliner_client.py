"""
Thin HTTP client over the gliner enclave service. Owns the retry policy:
3 attempts with exponential backoff (1s, 4s, 16s) on 5xx; 4xx surfaces
immediately as an admin-review signal.

The submission service NEVER calls HuggingFace directly — only this client
talks to the gliner enclave. That invariant holds from laptop to prod.
"""

import os
import time
from dataclasses import dataclass
from typing import Dict, List, Tuple

import httpx

from .labels import LABEL_NAMES, THRESHOLDS
from .masking import ModelSpan

GLINER_URL = os.getenv("GLINER_URL", "http://localhost:5001")
GLINER_SHARED_SECRET = os.getenv("GLINER_SHARED_SECRET", "dev-shared-secret")
GLINER_TIMEOUT_S = float(os.getenv("GLINER_TIMEOUT_S", "30"))
GLINER_MAX_ATTEMPTS = int(os.getenv("GLINER_MAX_ATTEMPTS", "3"))
GLINER_BACKOFF_BASE_S = float(os.getenv("GLINER_BACKOFF_BASE_S", "1"))


class GlinerBadInput(Exception):
    """4xx from the inference service. Schema drift — flag for admin."""


class GlinerInferenceFailure(Exception):
    """5xx after exhausting retries."""


@dataclass
class GlinerResult:
    run_id: str
    spans: List[ModelSpan]


def pseudonymise_segments(segments: List[Dict[str, str]]) -> GlinerResult:
    """
    segments: list of {"id": str, "text": str, "lang"?: str}
    """
    payload = {
        "segments": segments,
        "labels": LABEL_NAMES,
        "thresholds": THRESHOLDS,
        "default_threshold": 0.5,
    }
    headers = {"X-Austin-Internal": GLINER_SHARED_SECRET}

    last_err: Exception | None = None
    for attempt in range(1, GLINER_MAX_ATTEMPTS + 1):
        try:
            with httpx.Client(timeout=GLINER_TIMEOUT_S) as client:
                resp = client.post(
                    f"{GLINER_URL}/pseudonymise", json=payload, headers=headers
                )
        except httpx.HTTPError as exc:
            last_err = exc
            _sleep_backoff(attempt)
            continue

        if 400 <= resp.status_code < 500:
            raise GlinerBadInput(f"{resp.status_code}: {resp.text}")
        if resp.status_code >= 500:
            last_err = GlinerInferenceFailure(f"{resp.status_code}: {resp.text}")
            _sleep_backoff(attempt)
            continue

        data = resp.json()
        spans = [
            ModelSpan(
                segment_id=s["segmentId"],
                start=int(s["start"]),
                end=int(s["end"]),
                text=s["text"],
                label=s["label"],
                score=float(s["score"]),
            )
            for s in data.get("spans", [])
        ]
        return GlinerResult(run_id=data.get("runId", ""), spans=spans)

    raise GlinerInferenceFailure(
        f"gliner failed after {GLINER_MAX_ATTEMPTS} attempts: {last_err}"
    )


def _sleep_backoff(attempt: int) -> None:
    # 1s, 4s, 16s for base=1.
    time.sleep(GLINER_BACKOFF_BASE_S * (4 ** (attempt - 1)))
