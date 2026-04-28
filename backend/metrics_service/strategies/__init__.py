from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy, get_strategy, list_strategies
from .runner import MetricsRunner

# Importing concrete strategies registers them via the @register_strategy
# decorator. New metrics drop in here as a single import line.
from . import f1  # noqa: F401
from . import wer  # noqa: F401
from . import cer  # noqa: F401
from . import smr  # noqa: F401
from . import financial_term_accuracy  # noqa: F401

__all__ = [
    "MetricStrategy",
    "Sample",
    "StrategyResult",
    "register_strategy",
    "get_strategy",
    "list_strategies",
    "MetricsRunner",
]
