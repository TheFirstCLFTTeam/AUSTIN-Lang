from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Iterable, Optional


@dataclass(frozen=True)
class Sample:
    reference: str
    hypothesis: str
    audio_path: Optional[str] = None
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
