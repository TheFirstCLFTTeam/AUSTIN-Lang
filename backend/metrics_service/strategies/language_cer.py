"""Language-stratified CER — character error rate broken out by the
sample's language tag, then macro-averaged across languages.

Plain CER bundles every language together. For a financial-call corpus
that mixes English, Mandarin, and Cantonese, that hides the per-language
story — a model can look fine in aggregate while collapsing on one
language. `language_cer` groups samples by `Sample.language` (BCP-47
short form) and reports per-language CER in the breakdown plus the
macro-average as the headline value.

Macro vs. micro: macro gives every language equal weight regardless of
sample count, which matches the "are we strong on every language" framing
the dashboard wants. The breakdown also includes per-language sample
counts so a reviewer can spot a language with too few samples to trust.

Samples without a `language` tag are excluded from scoring — counting
them under "unknown" would confuse aggregate readings. The skipped count
surfaces in the breakdown so manifest gaps are obvious.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable, List

from ._text import levenshtein, tokenise_chars
from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


@register_strategy
class LanguageCer(MetricStrategy):
    name = "language_cer"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        # language → (total_edits, total_ref_chars, sample_count)
        per_lang: Dict[str, List[float]] = defaultdict(lambda: [0.0, 0.0, 0])
        skipped_no_language = 0
        skipped_empty_ref = 0

        for sample in samples:
            lang = sample.language
            if not lang:
                skipped_no_language += 1
                continue

            ref_chars = tokenise_chars(sample.reference)
            if not ref_chars:
                skipped_empty_ref += 1
                continue
            hyp_chars = tokenise_chars(sample.hypothesis)
            edits = levenshtein(ref_chars, hyp_chars)

            slot = per_lang[lang]
            slot[0] += edits
            slot[1] += len(ref_chars)
            slot[2] += 1

        if not per_lang:
            return StrategyResult(
                strategy_name=self.name,
                value=0.0,
                breakdown={
                    "languages_scored": 0.0,
                    "samples_skipped_no_language": float(skipped_no_language),
                    "samples_skipped_empty_ref": float(skipped_empty_ref),
                },
                sample_count=0,
            )

        per_lang_cer: Dict[str, float] = {}
        total_samples = 0
        for lang, (edits, ref_len, count) in per_lang.items():
            cer = edits / ref_len if ref_len > 0 else 0.0
            per_lang_cer[lang] = cer
            total_samples += count

        # Macro-average across languages.
        macro = sum(per_lang_cer.values()) / len(per_lang_cer)

        breakdown: Dict[str, float] = {
            "languages_scored": float(len(per_lang_cer)),
            "samples_total": float(total_samples),
            "samples_skipped_no_language": float(skipped_no_language),
            "samples_skipped_empty_ref": float(skipped_empty_ref),
        }
        # Per-language values surface as `cer.<lang>` and counts as
        # `samples.<lang>` so the FE can plot per-language bars without
        # a separate query.
        for lang, cer in per_lang_cer.items():
            breakdown[f"cer.{lang}"] = cer
            breakdown[f"samples.{lang}"] = float(per_lang[lang][2])

        return StrategyResult(
            strategy_name=self.name,
            value=macro,
            breakdown=breakdown,
            sample_count=total_samples,
        )
