"""Shared helper for per-language accuracy strategies.

`english_accuracy.py` and `mandarin_accuracy.py` are thin wrappers that
filter samples to a language tag set and compute (1 - WER) on what's
left. The filter logic + breakdown shape live here so adding a new
language ("yue", "ja", "ko") is one new file with three lines:

    from ._per_language import per_language_accuracy

    @register_strategy
    class YueAccuracy(MetricStrategy):
        name = "yue_accuracy"
        def compute(self, samples):
            return per_language_accuracy(self.name, samples, {"yue"})

The function returns a `StrategyResult` directly so the wrapper class
doesn't have to assemble breakdowns. Value is the *accuracy* in
[0, 1] — `1 - WER` — to match the dashboard card semantics
("english_accuracy", not "english_wer"). The merge layer
(`live-dashboard-metrics.js::formatMetricValue`) scales the [0, 1]
fraction up to a percentage at display time.
"""
from __future__ import annotations

from typing import Iterable, List, Set

from ._text import levenshtein, tokenise_words
from .base import Sample, StrategyResult


def per_language_accuracy(
    metric_name: str,
    samples: Iterable[Sample],
    accept_languages: Set[str],
) -> StrategyResult:
    """Compute (1 - WER) on samples whose language tag is in
    `accept_languages`. Macro-averaged across the matched samples.

    Tag matching is case-insensitive. Samples without a language tag
    are excluded (counted in the breakdown so a manifest gap is
    visible). Samples with a language not in the accept set are
    excluded silently — they're scored by their own metric.

    Returns 0.0 with `sample_count=0` when no samples matched. That's
    the correct fallback for the dashboard: the chart renders an
    empty series rather than a misleading 100% accuracy.
    """
    accept_lower = {lang.lower() for lang in accept_languages}
    per_sample_wer: List[float] = []
    skipped_no_language = 0
    skipped_other_language = 0
    skipped_empty_ref = 0
    edits_total = 0
    ref_tokens_total = 0

    for sample in samples:
        if not sample.language:
            skipped_no_language += 1
            continue
        if sample.language.lower() not in accept_lower:
            skipped_other_language += 1
            continue

        ref = tokenise_words(sample.reference)
        if not ref:
            skipped_empty_ref += 1
            continue
        hyp = tokenise_words(sample.hypothesis)
        distance = levenshtein(ref, hyp)
        sample_wer = min(1.0, distance / len(ref))
        per_sample_wer.append(sample_wer)
        edits_total += distance
        ref_tokens_total += len(ref)

    n = len(per_sample_wer)
    if n == 0:
        return StrategyResult(
            strategy_name=metric_name,
            value=0.0,
            breakdown={
                "samples_scored": 0.0,
                "samples_skipped_no_language": float(skipped_no_language),
                "samples_skipped_other_language": float(skipped_other_language),
                "samples_skipped_empty_ref": float(skipped_empty_ref),
                "languages_accepted": float(len(accept_lower)),
            },
            sample_count=0,
        )

    avg_wer = sum(per_sample_wer) / n
    accuracy = 1.0 - avg_wer
    micro_wer = edits_total / ref_tokens_total if ref_tokens_total > 0 else 0.0

    return StrategyResult(
        strategy_name=metric_name,
        value=accuracy,
        breakdown={
            "samples_scored": float(n),
            "samples_skipped_no_language": float(skipped_no_language),
            "samples_skipped_other_language": float(skipped_other_language),
            "samples_skipped_empty_ref": float(skipped_empty_ref),
            "macro_wer": avg_wer,
            "micro_wer": micro_wer,
            "edits_total": float(edits_total),
            "reference_tokens_total": float(ref_tokens_total),
        },
        sample_count=n,
    )
