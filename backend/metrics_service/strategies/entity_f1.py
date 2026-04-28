"""Entity F1 — span-tagged named-entity recovery from the hypothesis.

For each sample, the manifest carries `entity_spans` over the reference:
half-open char ranges `[(start, end, label), …]` flagging named entities
the evaluator cares about (companies, tickers, currencies, people).
This metric extracts the entity surface form from the reference, looks
for it as a contiguous-token substring in the hypothesis after the
shared text normalisation, and returns macro-F1 over samples that have
at least one tagged entity.

Two scoring modes blended into one number:

  - **recall** — fraction of tagged entities that appear in the hypothesis
  - **precision** — out of the entities the model surfaced (matching ref
    spans), what fraction of ref spans actually got matched

We don't try to find entities the model produced that weren't tagged in
the reference (open-set NER) — the manifest is the source of truth here,
not the model. So precision = recall = F1 reduces to "fraction of ref
entities recovered". That's a deliberate simplification documented as
`scoring_mode: closed` in the breakdown — when an entity-tagger upgrade
ships and stamps the hypothesis side too, this strategy can be upgraded
in place to do classical span-F1.

Per-label breakdown surfaces in the result so reviewers can see which
entity classes the model misses (e.g. `f1.PERSON`, `f1.ORG`, `f1.MONEY`).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable, List, Tuple

from ._text import tokenise_words
from .base import EntitySpan, MetricStrategy, Sample, StrategyResult
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


def _surface_form(reference: str, span: EntitySpan) -> str:
    start, end, _label = span
    return reference[start:end] if 0 <= start <= end <= len(reference) else ""


@register_strategy
class EntityF1(MetricStrategy):
    name = "entity_f1"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        # label → (recovered, total)
        per_label: Dict[str, List[int]] = defaultdict(lambda: [0, 0])
        per_sample_f1: List[float] = []
        skipped_no_spans = 0
        skipped_empty_spans = 0

        for sample in samples:
            spans = sample.entity_spans
            if spans is None:
                skipped_no_spans += 1
                continue
            if len(spans) == 0:
                skipped_empty_spans += 1
                continue

            hyp_tokens = tokenise_words(sample.hypothesis)
            recovered = 0
            for span in spans:
                surface = _surface_form(sample.reference, span)
                needle = tokenise_words(surface)
                _start, _end, label = span
                per_label[label][1] += 1
                if needle and _phrase_in_tokens(needle, hyp_tokens):
                    recovered += 1
                    per_label[label][0] += 1
            sample_f1 = recovered / len(spans) if spans else 0.0
            per_sample_f1.append(sample_f1)

        n = len(per_sample_f1)
        if n == 0:
            return StrategyResult(
                strategy_name=self.name,
                value=0.0,
                breakdown={
                    "samples_scored": 0.0,
                    "samples_skipped_no_spans": float(skipped_no_spans),
                    "samples_skipped_empty_spans": float(skipped_empty_spans),
                    "scoring_mode_closed": 1.0,
                },
                sample_count=0,
            )

        breakdown: Dict[str, float] = {
            "samples_scored": float(n),
            "samples_skipped_no_spans": float(skipped_no_spans),
            "samples_skipped_empty_spans": float(skipped_empty_spans),
            "scoring_mode_closed": 1.0,
        }
        for label, (rec, tot) in per_label.items():
            breakdown[f"f1.{label}"] = rec / tot if tot > 0 else 0.0
            breakdown[f"total.{label}"] = float(tot)

        return StrategyResult(
            strategy_name=self.name,
            value=sum(per_sample_f1) / n,
            breakdown=breakdown,
            sample_count=n,
        )
