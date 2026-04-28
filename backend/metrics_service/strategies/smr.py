from typing import Iterable

from ._text import normalise
from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


@register_strategy
class SMR(MetricStrategy):
    """Sequence Match Rate — fraction of samples where reference == hypothesis.

    All-or-nothing per sample. Designed for cases where a partial match has
    no business value (SWIFT codes, IBANs, GST numbers) — see metric menu
    in docs/02 frontend/metrics_research/metrics_dashboard.md §6.
    """

    name = "sequence_match_rate"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        matches = 0
        total = 0
        for sample in samples:
            total += 1
            if normalise(sample.reference) == normalise(sample.hypothesis):
                matches += 1

        if total == 0:
            return StrategyResult(strategy_name=self.name, value=0.0)
        return StrategyResult(
            strategy_name=self.name,
            value=matches / total,
            breakdown={"matches": float(matches), "total": float(total)},
            sample_count=total,
        )
