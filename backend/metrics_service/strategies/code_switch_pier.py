"""CS-PIER — Code-Switch Phrase Identification Error Rate.

Measures how well an ASR model preserves intra-sentence language switches.
For a multilingual financial-call corpus with utterances like
"佢話 the deal is challa gaya 先" (Cantonese / English / Hindi), a model
that drops or mistranslates the foreign-language phrase scores poorly
here even if the surrounding monolingual portion is fine.

The reference manifest carries `language_spans` over the reference
text — half-open char ranges + a BCP-47 tag `[(start, end, "yue"),
(start, end, "en"), …]`. This metric:

  1. Skips monolingual samples (only one distinct language tag, or no
     spans recorded).
  2. For each non-dominant-language span, extracts the surface form's
     normalised tokens.
  3. Looks for those tokens as a contiguous-token subsequence in the
     hypothesis.
  4. Per-language `recovered / total` lands in the breakdown
     (`recovered.<lang>` + `total.<lang>`).
  5. Returns `1 - macro_recovery_rate` so the value is an *error rate*
     matching the dashboard card name (CS-**PIER**, lower-is-better).

Limitations called out in the breakdown via `scoring_mode_closed = 1.0`:

  - Doesn't measure the model getting the language *boundary* right,
    only whether the foreign-language span survived. A future
    upgrade could compare hypothesis-side language tags too once
    the diarisation / language-id pipeline produces them.
  - Substring match in the normalised hypothesis means the metric is
    case + punctuation insensitive (consistent with WER/CER).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable, List

from ._text import tokenise_words
from .base import LanguageSpan, MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


def _phrase_in_tokens(needle: List[str], haystack: List[str]) -> bool:
    n = len(needle)
    if n == 0:
        return False
    if n == 1:
        return needle[0] in haystack
    for i in range(len(haystack) - n + 1):
        if haystack[i:i + n] == needle:
            return True
    return False


def _surface(reference: str, span: LanguageSpan) -> str:
    start, end, _ = span
    return reference[start:end] if 0 <= start <= end <= len(reference) else ""


@register_strategy
class CodeSwitchPier(MetricStrategy):
    name = "code_switch_pier"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        # language → [recovered, total]
        per_lang: Dict[str, List[int]] = defaultdict(lambda: [0, 0])
        per_sample_recovery: List[float] = []
        skipped_no_spans = 0
        skipped_monolingual = 0

        for sample in samples:
            spans = sample.language_spans
            if spans is None or len(spans) == 0:
                skipped_no_spans += 1
                continue
            distinct_langs = {label for _, _, label in spans}
            if len(distinct_langs) < 2:
                skipped_monolingual += 1
                continue

            hyp_tokens = tokenise_words(sample.hypothesis)
            sample_recovered = 0
            sample_total = 0
            for span in spans:
                _start, _end, lang = span
                surface_text = _surface(sample.reference, span)
                needle = tokenise_words(surface_text)
                if not needle:
                    continue
                sample_total += 1
                per_lang[lang][1] += 1
                if _phrase_in_tokens(needle, hyp_tokens):
                    sample_recovered += 1
                    per_lang[lang][0] += 1
            if sample_total > 0:
                per_sample_recovery.append(sample_recovered / sample_total)

        n = len(per_sample_recovery)
        if n == 0:
            return StrategyResult(
                strategy_name=self.name,
                value=0.0,
                breakdown={
                    "samples_scored": 0.0,
                    "samples_skipped_no_spans": float(skipped_no_spans),
                    "samples_skipped_monolingual": float(skipped_monolingual),
                    "scoring_mode_closed": 1.0,
                },
                sample_count=0,
            )

        macro_recovery = sum(per_sample_recovery) / n
        value = 1.0 - macro_recovery

        breakdown: Dict[str, float] = {
            "samples_scored": float(n),
            "samples_skipped_no_spans": float(skipped_no_spans),
            "samples_skipped_monolingual": float(skipped_monolingual),
            "macro_recovery_rate": macro_recovery,
            "scoring_mode_closed": 1.0,
        }
        for lang, (rec, tot) in per_lang.items():
            breakdown[f"recovered.{lang}"] = float(rec)
            breakdown[f"total.{lang}"] = float(tot)

        return StrategyResult(
            strategy_name=self.name,
            value=value,
            breakdown=breakdown,
            sample_count=n,
        )
