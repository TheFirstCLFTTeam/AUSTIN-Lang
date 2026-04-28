from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional


@dataclass(frozen=True)
class Sample:
    reference: str
    hypothesis: str
    audio_path: Optional[str] = None
    # Approved-dictionary terms detected in this sample's reference at
    # manifest-build time. Drives `financial_term_accuracy` and any future
    # term-aware metric. None = manifest pre-dates the field; [] =
    # manifest is term-aware but this sample had no matches.
    # See docs/07 Integration CAA 27APR2026/financial-terms-dictionary.md §8.
    critical_terms: Optional[List[str]] = None
    tags: Dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class StrategyResult:
    strategy_name: str
    value: float
    breakdown: Dict[str, float] = field(default_factory=dict)
    sample_count: int = 0


class MetricStrategy(ABC):
    name: str

    @abstractmethod
    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        ...
