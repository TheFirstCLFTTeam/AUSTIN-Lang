from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple


# All three are half-open char ranges + a string tag. Reused as the
# parsed type for Sample.entity_spans, Sample.speakers,
# Sample.hypothesis_speakers, and Sample.language_spans.
EntitySpan = Tuple[int, int, str]
SpeakerSpan = Tuple[int, int, str]
LanguageSpan = Tuple[int, int, str]


@dataclass(frozen=True)
class Sample:
    reference: str
    # Hypothesis is Optional so the manifest can declare clips without
    # pre-computed predictions and have metrics-service fan out to
    # transcription-service-2 to fill them in (see
    # `metrics_service/inference_client.py`). Distinguishes:
    #   "" — empty prediction (the model produced silence-output)
    #   None — manifest left it blank, fan-out should fill it
    #   None after fan-out — inference failed for this clip
    # Strategies treat None and "" identically when scoring (a missing
    # hypothesis is a fully wrong sample).
    hypothesis: Optional[str] = None
    audio_path: Optional[str] = None
    # Approved-dictionary terms detected in this sample's reference at
    # manifest-build time. Drives `financial_term_accuracy` and any future
    # term-aware metric. None = manifest pre-dates the field; [] =
    # manifest is term-aware but this sample had no matches.
    # See docs/07 Integration CAA 27APR2026/financial-terms-dictionary.md §8.
    critical_terms: Optional[List[str]] = None
    # Per-word importance weights aligned to the reference token list
    # (after `tokenise_words`). Drives `weighted_wer` — financial-y or
    # named-entity-y words get a higher weight so an error there hurts
    # the metric more than a stop-word substitution. None = manifest
    # didn't supply them; weighted_wer falls back to uniform weights.
    # docs/06 server/metrics-service-module.md §4.6.
    info_values: Optional[List[float]] = None
    # Per-sample language tag (BCP-47 short form: "en", "zh", "yue", …).
    # Drives `language_cer`. None = unknown / mixed; the metric skips
    # such samples and surfaces the count in its breakdown.
    language: Optional[str] = None
    # Span-tagged named entities in the reference, half-open char offsets:
    # `[(start, end, label), ...]`. Drives `entity_f1`. None = manifest
    # pre-dates the field; [] = no entities in this reference.
    entity_spans: Optional[List[EntitySpan]] = None
    # Speaker assignments over the reference, half-open char offsets:
    # `[(start, end, speaker_id), ...]`. Drives the diarization metrics
    # (word_diarization_error + speaker_diarization). None = manifest
    # pre-dates the field; [] = no speaker info available.
    speakers: Optional[List[SpeakerSpan]] = None
    # Speaker assignments over the hypothesis. Will only be populated
    # when the ASR pipeline produces diarised output (e.g. WhisperX +
    # pyannote). None today — both diarization metrics short-circuit
    # with `samples_skipped_no_hypothesis_speakers` in their breakdowns
    # when this is missing, so they ship correctly-shaped and auto-flow
    # the day a diarisation step lands.
    hypothesis_speakers: Optional[List[SpeakerSpan]] = None
    # Per-language char-span tags within a single reference, half-open:
    # `[(start, end, lang_tag), ...]`. Drives `code_switch_pier`. None =
    # manifest pre-dates the field; [] = monolingual sample (the metric
    # skips it for the denominator).
    language_spans: Optional[List[LanguageSpan]] = None
    tags: Dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class StrategyResult:
    strategy_name: str
    value: float
    breakdown: Dict[str, float] = field(default_factory=dict)
    sample_count: int = 0


class MetricStrategy(ABC):
    name: str

    @abstractmethod
    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        ...
