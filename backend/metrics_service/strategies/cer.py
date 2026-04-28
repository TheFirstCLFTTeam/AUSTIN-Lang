from typing import Iterable, List

from ._text import levenshtein, tokenise_chars
from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


@register_strategy
class CER(MetricStrategy):
    """Character Error Rate — Levenshtein over normalised character lists.

    Whitespace is stripped before comparison so the metric is meaningful
    on languages where words aren't whitespace-separated (Mandarin, Thai),
    which is the whole reason character-level metrics exist for ASR.
    """

    name = "cer"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        scores: List[float] = []
        ref_chars_total = 0
        hyp_chars_total = 0

        for sample in samples:
            ref = tokenise_chars(sample.reference)
            hyp = tokenise_chars(sample.hypothesis)
            ref_chars_total += len(ref)
            hyp_chars_total += len(hyp)

            if not ref and not hyp:
                scores.append(0.0)
                continue
            if not ref:
                scores.append(1.0)
                continue

            distance = levenshtein(ref, hyp)
            scores.append(min(1.0, distance / len(ref)))

        n = len(scores)
        if n == 0:
            return StrategyResult(strategy_name=self.name, value=0.0)

        return StrategyResult(
            strategy_name=self.name,
            value=sum(scores) / n,
            breakdown={
                "reference_chars": float(ref_chars_total),
                "hypothesis_chars": float(hyp_chars_total),
            },
            sample_count=n,
        )
