"""Shared text normalisation + edit-distance helpers used by multiple strategies.

Kept private (leading underscore) — strategies should not depend on each
other's internals, only on these utilities.
"""

import re
from typing import List, Sequence


_PUNCT_RE = re.compile(r"[^\w\s']+", flags=re.UNICODE)
_WS_RE = re.compile(r"\s+", flags=re.UNICODE)


def normalise(text: str) -> str:
    if not text:
        return ""
    text = text.lower()
    text = _PUNCT_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()


def tokenise_words(text: str) -> List[str]:
    norm = normalise(text)
    return norm.split(" ") if norm else []


def tokenise_chars(text: str) -> List[str]:
    # Character-level CER also benefits from the same normalisation: case
    # and punctuation are noise for ASR comparisons.
    return list(normalise(text).replace(" ", ""))


def levenshtein(ref: Sequence, hyp: Sequence) -> int:
    """Iterative two-row Levenshtein. Works for word lists or char lists."""
    n, m = len(ref), len(hyp)
    if n == 0:
        return m
    if m == 0:
        return n
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        curr = [i] + [0] * m
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        prev = curr
    return prev[m]
