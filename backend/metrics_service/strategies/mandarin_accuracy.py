"""Mandarin accuracy — (1 - WER) on samples tagged as Mandarin.

Sibling of `english_accuracy`. The accept set covers the BCP-47 short
forms common in our corpora:

    "zh"        → Chinese (generic — usually Mandarin)
    "zh-cn"     → Simplified, Mainland
    "zh-tw"     → Traditional, Taiwan
    "zh-hans"   → Simplified script
    "zh-hant"   → Traditional script
    "cmn"       → Mandarin (specific ISO 639-3)

Cantonese ("yue") is intentionally NOT included — `mandarin_accuracy`
should not double-count Cantonese samples. A future `cantonese_accuracy`
strategy would mirror this with `{"yue", "yue-hk"}`.

Word tokenisation note: the shared `tokenise_words` splits on whitespace
+ punctuation. CJK without spaces collapses to one giant "word" per
sentence — that's not a faithful WER. For Mandarin a character-level
metric (`language_cer`) is the more reliable signal; this strategy is
provided to fill the dashboard card and surfaces a `tokenisation_warning`
in the breakdown when the average word length exceeds 6 chars (a
heuristic for "this looks like CJK without spaces").
"""
from __future__ import annotations

from typing import Iterable

from ._per_language import per_language_accuracy
from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


_MANDARIN_TAGS = {"zh", "zh-cn", "zh-tw", "zh-hans", "zh-hant", "cmn"}


@register_strategy
class MandarinAccuracy(MetricStrategy):
    name = "mandarin_accuracy"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        result = per_language_accuracy(self.name, samples, _MANDARIN_TAGS)
        # Add the tokenisation-warning heuristic. We can't recompute the
        # ref tokens here (the helper threw them away), but the breakdown
        # already carries reference_tokens_total + edits_total. A more
        # faithful version of this would shell out to `jieba` or a
        # word-segmenter; that's a follow-up.
        ref_tokens = result.breakdown.get("reference_tokens_total", 0.0)
        scored = result.breakdown.get("samples_scored", 0.0)
        if scored > 0:
            avg_tokens_per_sample = ref_tokens / scored
            # Heuristic: short token count on Mandarin samples means the
            # tokeniser didn't split — CJK without spaces collapses to
            # one or two "words" per sentence regardless of length.
            warning = 1.0 if avg_tokens_per_sample < 3.0 else 0.0
            updated = dict(result.breakdown)
            updated["tokenisation_warning"] = warning
            updated["avg_tokens_per_sample"] = avg_tokens_per_sample
            return StrategyResult(
                strategy_name=result.strategy_name,
                value=result.value,
                breakdown=updated,
                sample_count=result.sample_count,
            )
        return result
