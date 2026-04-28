from typing import Iterable, List

from ._text import levenshtein, tokenise_words
from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


@register_strategy
class WER(MetricStrategy):
    """Word Error Rate — Levenshtein over normalised word lists.

    Macro-averaged across samples (per-utterance WER then averaged), which
    matches how the dashboard renders trajectories. Use jiwer-style
    micro-aggregation if/when a dedicated `wer_micro` strategy is added.
    """

    name = "wer"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        scores: List[float] = []
        substitutions_total = 0
        insertions_total = 0
        deletions_total = 0
        ref_tokens_total = 0

        for sample in samples:
            ref = tokenise_words(sample.reference)
            hyp = tokenise_words(sample.hypothesis)
            ref_tokens_total += len(ref)

            if not ref and not hyp:
                scores.append(0.0)
                continue
            if not ref:
                # All-insertion case — denominator falls back to hyp length
                # so the score caps at 1.0 (every hyp token is an error).
                scores.append(1.0)
                insertions_total += len(hyp)
                continue

            distance = levenshtein(ref, hyp)
            scores.append(min(1.0, distance / len(ref)))
            # Approximate edit-type breakdown: not exact (the Levenshtein
            # backtrace would be needed for true counts) but close enough
            # for a directional read at the breakdown level.
            if len(hyp) > len(ref):
                insertions_total += len(hyp) - len(ref)
            elif len(ref) > len(hyp):
                deletions_total += len(ref) - len(hyp)
            substitutions_total += distance - abs(len(ref) - len(hyp))

        n = len(scores)
        if n == 0:
            return StrategyResult(strategy_name=self.name, value=0.0)

        return StrategyResult(
            strategy_name=self.name,
            value=sum(scores) / n,
            breakdown={
                "substitutions": float(max(0, substitutions_total)),
                "insertions": float(insertions_total),
                "deletions": float(deletions_total),
                "reference_tokens": float(ref_tokens_total),
            },
            sample_count=n,
        )
