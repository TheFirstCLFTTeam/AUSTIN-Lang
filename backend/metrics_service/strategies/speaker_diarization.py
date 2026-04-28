"""Speaker-diarization error — proxy metric for DER (Diarization Error
Rate) until a real time-aligned diarization output exists.

Classical DER needs frame-level (or word-level) timestamps + speaker
ids on both ref and hyp; we don't have time alignment at the metric
boundary today. As a stand-in, this metric looks at the *speaker set
match* between reference and hypothesis: did the model produce
roughly the right cast of speakers, even if their assignments
disagree word-for-word? That's the cheaper signal and it's the one
the dashboard card surfaces ("how many speakers did the model find,
and were they the right ones?").

When the diarisation pipeline lands and produces time-aligned outputs,
this strategy gets replaced (or upgraded in place) to compute true DER.
For now:

  - Skip samples without ref speakers.
  - Skip samples without hypothesis speakers.
  - For the remaining, compute Jaccard distance between the speaker
    sets: |ref ∆ hyp| / |ref ∪ hyp|. Macro-average.
  - 0.0 = perfect set match (the cast lines up). 1.0 = entirely
    disjoint speaker sets (worst case).

Per-sample-error in the breakdown so a reviewer can spot a sample
where the model invented a phantom speaker.
"""
from __future__ import annotations

from typing import Iterable, List

from ._diarization import speaker_set
from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


@register_strategy
class SpeakerDiarization(MetricStrategy):
    name = "speaker_diarization"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        per_sample: List[float] = []
        skipped_no_ref_speakers = 0
        skipped_no_hyp_speakers = 0
        ref_count_total = 0
        hyp_count_total = 0

        for s in samples:
            if not s.speakers:
                skipped_no_ref_speakers += 1
                continue
            if not s.hypothesis_speakers:
                skipped_no_hyp_speakers += 1
                continue

            ref_set = speaker_set(s.speakers)
            hyp_set = speaker_set(s.hypothesis_speakers)
            union = ref_set | hyp_set
            if not union:
                continue
            jaccard_distance = len(ref_set ^ hyp_set) / len(union)
            per_sample.append(jaccard_distance)
            ref_count_total += len(ref_set)
            hyp_count_total += len(hyp_set)

        n = len(per_sample)
        if n == 0:
            return StrategyResult(
                strategy_name=self.name,
                value=0.0,
                breakdown={
                    "samples_scored": 0.0,
                    "samples_skipped_no_ref_speakers": float(skipped_no_ref_speakers),
                    "samples_skipped_no_hypothesis_speakers": float(skipped_no_hyp_speakers),
                    "scoring_mode": 0.0,  # 0 = set-match (proxy); 1.0 reserved for time-aligned DER
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
                "avg_ref_speakers": ref_count_total / n,
                "avg_hyp_speakers": hyp_count_total / n,
                "scoring_mode": 0.0,
            },
            sample_count=n,
        )
