"""English accuracy — (1 - WER) on samples tagged as English.

Sibling of `language_cer` but at the word level and filtered to a single
language. Matches the `english_accuracy` dashboard card directly so the
auto-flow merge in `live-dashboard-metrics.js` picks it up by name.

Accept-list covers BCP-47 short forms commonly used in our manifests:

    "en"        → English (generic)
    "en-us"     → US English
    "en-gb"     → British English
    "en-sg"     → Singapore English (matters for SG-specific corpora)

Tag matching is case-insensitive.
"""
from __future__ import annotations

from typing import Iterable

from ._per_language import per_language_accuracy
from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


_ENGLISH_TAGS = {"en", "en-us", "en-gb", "en-au", "en-sg", "en-in"}


@register_strategy
class EnglishAccuracy(MetricStrategy):
    name = "english_accuracy"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        return per_language_accuracy(self.name, samples, _ENGLISH_TAGS)
