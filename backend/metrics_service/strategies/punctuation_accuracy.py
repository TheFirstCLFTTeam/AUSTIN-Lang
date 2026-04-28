"""Punctuation accuracy — F1 over the punctuation positions in the
hypothesis vs. the reference.

Punctuation is a frequent miss for fine-tuned ASR models because Whisper
tokenisation collapses some punctuation classes and most loss formulations
underweight them. This strategy isolates the signal: extract the
punctuation tokens (in order) from each side, treat them as a sequence,
and compute precision + recall via Levenshtein-style alignment so an
inserted comma counts as a false positive without invalidating the rest
of the sequence.

Operates over Sample.reference / Sample.hypothesis directly — no extra
manifest metadata needed, so this strategy ships ahead of the four
metadata-dependent ones.

Returns macro-F1 across samples that have at least one punctuation
mark in either reference or hypothesis. Samples with no punctuation in
either side are excluded from the denominator (counting them as 1.0
would inflate the metric on punctuation-free corpora; counting them
as 0.0 would tank it). Excluded counts surface in the breakdown so
reviewers can spot a manifest with no punctuation.
"""
from __future__ import annotations

import re
from typing import Iterable, List

from ._text import levenshtein
from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


# Western + CJK terminal/internal punctuation. Tilde/em-dash etc. are
# left out — they're stylistic and would add noise.
_PUNCT_RE = re.compile(r"[.!?,;:'\"()\[\]{}。！？，；：]")


def _extract_punctuation(text: str) -> List[str]:
    if not text:
        return []
    return _PUNCT_RE.findall(text)


def _align_counts(ref: List[str], hyp: List[str]) -> tuple:
    """Use levenshtein on the punctuation sequences to count substitutions
    + insertions + deletions, then reconstruct precision + recall.

    levenshtein() returns just the edit count, not the operation breakdown.
    We approximate: matched = total_in_both - max(len_ref, len_hyp) +
    edit_distance; this is a tight upper bound on substitutions + missed.
    Cleaner: walk the DP grid manually — done via a small wrapper here so
    the semantics are explicit.
    """
    n, m = len(ref), len(hyp)
    if n == 0 and m == 0:
        return 0, 0, 0  # matches, fp, fn
    # DP table for full back-trace.
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            dp[i][j] = min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost,
            )
    # Trace back to count match/insert/delete/substitute.
    matches = inserts = deletes = subs = 0
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and ref[i - 1] == hyp[j - 1] and dp[i][j] == dp[i - 1][j - 1]:
            matches += 1
            i -= 1
            j -= 1
        elif i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            subs += 1
            i -= 1
            j -= 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            deletes += 1  # ref had a punct that hyp omitted
            i -= 1
        else:
            inserts += 1  # hyp had a spurious punct
            j -= 1
    # F1 inputs:
    # tp = matches; fp = inserts + subs; fn = deletes + subs
    return matches, inserts + subs, deletes + subs


@register_strategy
class PunctuationAccuracy(MetricStrategy):
    name = "punctuation_accuracy"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        per_sample_f1: List[float] = []
        skipped_no_punct = 0
        total_tp = 0
        total_fp = 0
        total_fn = 0

        for sample in samples:
            ref = _extract_punctuation(sample.reference)
            hyp = _extract_punctuation(sample.hypothesis)
            if not ref and not hyp:
                skipped_no_punct += 1
                continue
            tp, fp, fn = _align_counts(ref, hyp)
            total_tp += tp
            total_fp += fp
            total_fn += fn
            denom = tp + 0.5 * (fp + fn)
            f1 = (tp / denom) if denom > 0 else 0.0
            per_sample_f1.append(f1)

        n = len(per_sample_f1)
        if n == 0:
            return StrategyResult(
                strategy_name=self.name,
                value=0.0,
                breakdown={
                    "samples_scored": 0.0,
                    "samples_skipped_no_punct": float(skipped_no_punct),
                },
                sample_count=0,
            )
        return StrategyResult(
            strategy_name=self.name,
            value=sum(per_sample_f1) / n,
            breakdown={
                "samples_scored": float(n),
                "samples_skipped_no_punct": float(skipped_no_punct),
                "tp": float(total_tp),
                "fp": float(total_fp),
                "fn": float(total_fn),
            },
            sample_count=n,
        )
