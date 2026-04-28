from typing import Dict, Iterable, List, Sequence

from .base import Sample, StrategyResult
from .registry import get_strategy


class MetricsRunner:
    def __init__(self, strategy_names: Sequence[str]):
        if not strategy_names:
            raise ValueError("MetricsRunner requires at least one strategy name")
        self._strategies = [get_strategy(name) for name in strategy_names]

    def run(self, samples: Iterable[Sample]) -> Dict[str, StrategyResult]:
        # Materialise once so each strategy sees the same iteration; eval
        # datasets are bounded (manifest size), so the memory cost is fine.
        materialised: List[Sample] = list(samples)
        return {s.name: s.compute(materialised) for s in self._strategies}
