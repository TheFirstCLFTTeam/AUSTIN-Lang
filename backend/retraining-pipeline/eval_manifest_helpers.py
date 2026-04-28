"""Helpers for the eval-manifest writer (slice 4 of the financial-terms-
dictionary integration).

Kept in its own module — separate from `dataset_builder.py` — because:

  1. `dataset_builder.py` imports librosa + soundfile, which the helpers
     don't need. Tests can exercise these helpers without the audio
     stack installed.
  2. The eval-manifest writer hasn't been built yet. When it lands
     (separate slice), it'll import these helpers; today the metric
     strategy ships first and these helpers wait for the writer.

Only standard library + requests, no heavy deps.
"""
from __future__ import annotations

import os
import re
from typing import List, Optional, Tuple

import requests


FINANCIAL_TERMS_URL = os.getenv(
    "FINANCIAL_TERMS_URL",
    "http://financial-terms-dictionary:8009",
)


# Same casefold + punctuation strip + whitespace collapse as
# metrics_service/strategies/_text.py::tokenise_words. Kept as a private
# copy so this module is dependency-free of the metrics service.
_PUNCT_RE = re.compile(r"[^\w\s']+", flags=re.UNICODE)
_WS_RE = re.compile(r"\s+", flags=re.UNICODE)


def _tokenise(text: Optional[str]) -> List[str]:
    if not text:
        return []
    lowered = str(text).lower()
    cleaned = _PUNCT_RE.sub(" ", lowered)
    cleaned = _WS_RE.sub(" ", cleaned).strip()
    return cleaned.split(" ") if cleaned else []


def _phrase_in_tokens(needle: List[str], haystack: List[str]) -> bool:
    n = len(needle)
    if n == 0:
        return False
    if n == 1:
        return needle[0] in haystack
    for i in range(len(haystack) - n + 1):
        if haystack[i:i + n] == needle:
            return True
    return False


def fetch_dictionary_snapshot(timeout_s: float = 10.0) -> Tuple[Optional[str], List[dict]]:
    """Pull the approved-terms snapshot from the dictionary microservice.

    Fail-quiet: returns `(None, [])` for every failure mode (HTTP 5xx,
    connection error, malformed JSON). The eval-manifest writer treats
    that as "skip term stamping" — the resulting manifest has no
    `critical_terms`, which the metric strategy handles via its
    `samples_skipped_no_tag` counter.

    Returns: (version, terms) where each term is a dict
    `{id, term, term_normalized, category, definition}`.
    """
    try:
        resp = requests.get(
            f"{FINANCIAL_TERMS_URL}/dictionary/snapshot",
            headers={
                "Accept": "application/json",
                "X-User-Id": "system:dataset-builder",
                "X-User-Role": "system",
            },
            timeout=timeout_s,
        )
        if resp.status_code >= 400:
            print(
                f"[eval_manifest_helpers] dictionary snapshot {resp.status_code}; "
                f"continuing without term stamping"
            )
            return None, []
        body = resp.json()
        return body.get("version"), body.get("terms", [])
    except Exception as exc:  # noqa: BLE001 — fail-quiet on every error
        print(
            f"[eval_manifest_helpers] dictionary unreachable ({exc}); "
            f"continuing without term stamping"
        )
        return None, []


def stamp_critical_terms(
    reference_text: Optional[str],
    terms: List[dict],
) -> List[str]:
    """For one reference text + the approved-terms list, return the canonical
    forms of terms whose tokens appear (as a contiguous subsequence) in the
    reference. Empty list when the reference is empty or no terms match.

    Output: list of `term` strings (the canonical-cased form, e.g. "EBITDA"),
    not normalised forms — matches what `Sample.critical_terms` consumes
    in the metric strategy.
    """
    if not reference_text or not terms:
        return []
    ref_tokens = _tokenise(reference_text)
    if not ref_tokens:
        return []
    out: List[str] = []
    for term in terms:
        canonical = term.get("term_normalized") or term.get("term") or ""
        needle = _tokenise(canonical)
        if not needle:
            continue
        if _phrase_in_tokens(needle, ref_tokens):
            out.append(term.get("term") or canonical)
    return out
