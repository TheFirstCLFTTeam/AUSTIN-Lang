"""Weighted WER — WER with a per-word importance weight on the reference.

Standard WER treats every reference word equally: a missed `the` and a
missed `EBITDA` cost the same point. In a financial-call setting they
shouldn't — getting `EBITDA` wrong matters far more than mangling a stop
word. `info_values` carries that weight per reference token; the metric
computes Levenshtein over the token lists, then scales each ref-side
edit (substitution, deletion) by the corresponding weight.

When `info_values` is missing (manifest pre-dates the field) or empty,
we fall back to uniform weights — i.e. plain WER — and surface the
fallback count in the breakdown so a reviewer can spot a misconfigured
manifest. This keeps the strategy useful on legacy data while still
landing the upgrade path.

Formula (Wagner-Fischer with weighted ref-side edits):
    Score = sum(weight_i for each ref word edited)
            ────────────────────────────────────────
                   sum(weight_i over all ref words)

Insertions in the hypothesis don't have a ref weight; they're charged
the *mean* ref weight on that sample, which keeps the metric bounded
in [0, 1] in the typical case (ref words far outnumber spurious
insertions). Documented as a known approximation in the breakdown
field `insertion_weight_policy`.

Macro-averaged across samples that have at least one ref word.
"""
from __future__ import annotations

from typing import Iterable, List, Sequence, Tuple

from ._text import tokenise_words
from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


def _weighted_alignment_cost(
    ref: Sequence[str],
    hyp: Sequence[str],
    weights: Sequence[float],
) -> float:
    """DP that returns the total weighted edit cost.

    Sub/del cost = weights[i-1]; ins cost = mean(weights). Same
    Wagner-Fischer recurrence as plain Levenshtein but each cell stores
    a float instead of an integer count.
    """
    n, m = len(ref), len(hyp)
    if n == 0:
        # No ref words → can't score meaningfully; caller filters.
        return 0.0
    mean_weight = sum(weights) / n if weights else 1.0
    # First row: m insertions, each charged mean_weight.
    prev = [j * mean_weight for j in range(m + 1)]
    for i in range(1, n + 1):
        wi = weights[i - 1]
        # First column: i ref-side deletions, accumulating wi.
        curr = [prev[0] + wi] + [0.0] * m
        for j in range(1, m + 1):
            sub_cost = 0.0 if ref[i - 1] == hyp[j - 1] else wi
            curr[j] = min(
                prev[j] + wi,                 # delete ref[i-1]
                curr[j - 1] + mean_weight,    # insert hyp[j-1]
                prev[j - 1] + sub_cost,       # match or substitute
            )
        prev = curr
    return prev[m]


@register_strategy
class WeightedWer(MetricStrategy):
    name = "weighted_wer"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        per_sample: List[float] = []
        weighted_count = 0
        uniform_fallback_count = 0
        skipped_empty_ref = 0

        for sample in samples:
            ref_tokens = tokenise_words(sample.reference)
            hyp_tokens = tokenise_words(sample.hypothesis)
            if not ref_tokens:
                skipped_empty_ref += 1
                continue

            iv = sample.info_values
            if iv and len(iv) == len(ref_tokens):
                weights = [float(w) for w in iv]
                weighted_count += 1
            else:
                weights = [1.0] * len(ref_tokens)
                uniform_fallback_count += 1

            cost = _weighted_alignment_cost(ref_tokens, hyp_tokens, weights)
            denom = sum(weights)
            # Cap at 1.0 — an insertion-heavy hyp could otherwise push
            # the per-sample WER above 1, which is technically correct
            # for WER but breaks downstream display logic that assumes
            # "WER < 1 = better than nothing". Industry convention.
            per_sample.append(min(1.0, cost / denom) if denom > 0 else 0.0)

        n = len(per_sample)
        if n == 0:
            return StrategyResult(
                strategy_name=self.name,
                value=0.0,
                breakdown={
                    "samples_scored": 0.0,
                    "samples_skipped_empty_ref": float(skipped_empty_ref),
                    "samples_weighted": 0.0,
                    "samples_uniform_fallback": 0.0,
                    "insertion_weight_policy": 0.0,  # 0 = mean-of-ref-weights
                },
                sample_count=0,
            )
        return StrategyResult(
            strategy_name=self.name,
            value=sum(per_sample) / n,
            breakdown={
                "samples_scored": float(n),
                "samples_skipped_empty_ref": float(skipped_empty_ref),
                "samples_weighted": float(weighted_count),
                "samples_uniform_fallback": float(uniform_fallback_count),
                "insertion_weight_policy": 0.0,
            },
            sample_count=n,
        )
