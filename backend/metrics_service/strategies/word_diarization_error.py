"""WDER — Word Diarization Error Rate.

Once a diarisation post-processor produces per-segment speaker labels
on the hypothesis (`Sample.hypothesis_speakers`), this metric measures
the fraction of hypothesis chars whose speaker assignment disagrees
with the reference's char-aligned speaker. Today's pipeline doesn't
emit those — see the module docstring of `_diarization.py` for the
plan. The metric ships with correct semantics so it auto-flows the
moment the field starts being populated.

Algorithm (when both sides have speaker labels):

  1. Build a char→speaker assignment array for the reference and one
     for the hypothesis (same char count as their respective texts).
  2. Align ref ↔ hyp by their global edit distance — but at the WORD
     level, not char level, since speaker boundaries align to word
     turns in practice. We approximate by sliding hypothesis tokens
     over the reference and counting per-token agreement on the
     speaker label of the first char.
  3. Per-sample WDER = `disagreement_words / total_hyp_words`.
  4. Macro-average across samples.

When either side's speakers is missing, the sample is skipped and a
counter increments. Returns 0.0 with sample_count=0 when no sample
has both sides.
"""
from __future__ import annotations

from typing import Iterable, List

from ._diarization import char_assignment
from ._text import tokenise_words
from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


def _word_to_char_offset(text: str, words: List[str]) -> List[int]:
    """For each whitespace-tokenised word, find its first-char offset
    in the original (un-normalised) text. We use this to look up the
    char→speaker mapping at the word's anchor position. Approximate
    only — case and punctuation can throw alignment off by a few
    chars. Acceptable for a metric whose error budget is "did the
    speaker change at the right place" rather than "is each char's
    speaker correct"."""
    offsets: List[int] = []
    cursor = 0
    lowered = text.lower()
    for w in words:
        idx = lowered.find(w.lower(), cursor)
        if idx == -1:
            offsets.append(cursor)  # best-effort fallback
        else:
            offsets.append(idx)
            cursor = idx + len(w)
    return offsets


@register_strategy
class WordDiarizationError(MetricStrategy):
    name = "word_diarization_error"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        per_sample: List[float] = []
        skipped_no_ref_speakers = 0
        skipped_no_hyp_speakers = 0
        total_disagreements = 0
        total_words = 0

        for s in samples:
            if not s.speakers:
                skipped_no_ref_speakers += 1
                continue
            if not s.hypothesis_speakers:
                skipped_no_hyp_speakers += 1
                continue

            ref_assign = char_assignment(len(s.reference), s.speakers)
            hyp_assign = char_assignment(len(s.hypothesis), s.hypothesis_speakers)

            hyp_words = tokenise_words(s.hypothesis)
            if not hyp_words:
                continue
            offsets = _word_to_char_offset(s.hypothesis, hyp_words)

            disagreements = 0
            for word, off in zip(hyp_words, offsets):
                hyp_label = (
                    hyp_assign[off] if 0 <= off < len(hyp_assign)
                    else "__unassigned__"
                )
                # Reference label sourced at the same proportional
                # offset — the texts can differ in length so we map
                # by relative position rather than absolute char.
                ref_off = (
                    int(off * len(ref_assign) / len(hyp_assign))
                    if hyp_assign else 0
                )
                ref_label = (
                    ref_assign[ref_off] if 0 <= ref_off < len(ref_assign)
                    else "__unassigned__"
                )
                if ref_label != hyp_label:
                    disagreements += 1
            per_sample.append(disagreements / len(hyp_words))
            total_disagreements += disagreements
            total_words += len(hyp_words)

        n = len(per_sample)
        if n == 0:
            return StrategyResult(
                strategy_name=self.name,
                value=0.0,
                breakdown={
                    "samples_scored": 0.0,
                    "samples_skipped_no_ref_speakers": float(skipped_no_ref_speakers),
                    "samples_skipped_no_hypothesis_speakers": float(skipped_no_hyp_speakers),
                },
                sample_count=0,
            )

        return StrategyResult(
            strategy_name=self.name,
            value=sum(per_sample) / n,
            breakdown={
                "samples_scored": float(n),
                "samples_skipped_no_ref_speakers": float(skipped_no_ref_speakers),
                "samples_skipped_no_hypothesis_speakers": float(skipped_no_hyp_speakers),
                "macro_disagreement_rate": sum(per_sample) / n,
                "micro_disagreement_rate": (
                    total_disagreements / total_words if total_words > 0 else 0.0
                ),
                "total_disagreements": float(total_disagreements),
                "total_words": float(total_words),
            },
            sample_count=n,
        )
