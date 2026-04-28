"""Financial term accuracy — fraction of approved-dictionary terms in the
reference that the model also produced correctly in the hypothesis.

This is the metric that closes the loop on the financial-terms-dictionary
microservice (slice 4 of docs/07 Integration CAA 27APR2026/financial-terms-
dictionary.md). The dictionary's `/dictionary/snapshot` is consumed at
manifest-build time by `dataset_builder.py`, which intersects each
sample's reference text with the approved-terms list and stamps the
result on `Sample.critical_terms`. This strategy then computes the per-
sample correctness score and macro-averages.

Algorithm:
    For each sample with at least one critical term:
        score_i = |{ t ∈ critical_terms_i : t appears in hypothesis_i }|
                  / |critical_terms_i|
    value = mean(score_i for samples with critical_terms)

Samples with no critical terms are excluded from the denominator
entirely — they don't score 1.0 (which would inflate the metric on
non-finance corpora). The breakdown carries the count of skipped
samples so admins can spot a manifest that lacks term tags.

Matching uses the same `tokenise_words` normalisation as WER/F1: case-
fold, punctuation-strip, whitespace-collapse. Multi-word terms ("hedge
fund") match as a contiguous token subsequence.
"""
from typing import Iterable, List

from ._text import tokenise_words
from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


def _phrase_in_tokens(needle_tokens: List[str], haystack_tokens: List[str]) -> bool:
    """True when `needle_tokens` appears as a contiguous subsequence in
    `haystack_tokens`. Single-token terms degenerate to plain `in`."""
    n = len(needle_tokens)
    if n == 0:
        return False
    if n == 1:
        return needle_tokens[0] in haystack_tokens
    for i in range(len(haystack_tokens) - n + 1):
        if haystack_tokens[i:i + n] == needle_tokens:
            return True
    return False


@register_strategy
class FinancialTermAccuracy(MetricStrategy):
    name = "financial_term_accuracy"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        scores: List[float] = []
        total_terms = 0
        total_correct = 0
        skipped_no_terms = 0
        skipped_no_tag = 0

        for sample in samples:
            terms = sample.critical_terms
            if terms is None:
                # Manifest pre-dates the field; skip silently but count for
                # the breakdown so admins see the manifest needs an upgrade.
                skipped_no_tag += 1
                continue
            if len(terms) == 0:
                # Manifest is term-aware but this sample has no listed
                # terms — exclude from denominator (would inflate the metric).
                skipped_no_terms += 1
                continue

            hyp_tokens = tokenise_words(sample.hypothesis)
            correct = 0
            for term in terms:
                term_tokens = tokenise_words(term)
                if not term_tokens:
                    continue
                if _phrase_in_tokens(term_tokens, hyp_tokens):
                    correct += 1
            total_terms += len(terms)
            total_correct += correct
            scores.append(correct / len(terms))

        n = len(scores)
        if n == 0:
            return StrategyResult(
                strategy_name=self.name,
                value=0.0,
                breakdown={
                    "samples_scored": 0.0,
                    "samples_skipped_no_terms": float(skipped_no_terms),
                    "samples_skipped_no_tag": float(skipped_no_tag),
                    "terms_seen": 0.0,
                    "terms_correct": 0.0,
                },
                sample_count=0,
            )

        return StrategyResult(
            strategy_name=self.name,
            value=sum(scores) / n,
            breakdown={
                "samples_scored": float(n),
                "samples_skipped_no_terms": float(skipped_no_terms),
                "samples_skipped_no_tag": float(skipped_no_tag),
                "terms_seen": float(total_terms),
                "terms_correct": float(total_correct),
            },
            sample_count=n,
        )
