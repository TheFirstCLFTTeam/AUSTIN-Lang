"""Shared helpers for the diarisation strategies (word_diarization_error
+ speaker_diarization). Both depend on `Sample.speakers` (reference
side) + `Sample.hypothesis_speakers` (hypothesis side).

Today no part of the AUSTIN pipeline produces hypothesis-side speaker
labels — Whisper Large-v3-turbo doesn't output them, and a diarisation
post-processor (WhisperX + pyannote, or similar) hasn't landed. So
both metrics will short-circuit on every real sample with the
`samples_skipped_no_hypothesis_speakers` counter ticking up. The
metrics are still worth shipping shaped-correctly so the day a
diarisation step appears, the code wires through with no schema
changes — just populate `Sample.hypothesis_speakers` in the manifest
loader (already supported) and the metric values start surfacing on
the dashboard automatically.

Both metrics also short-circuit on samples without `Sample.speakers`
(the reference manifest hasn't carried speaker labels). The two
counters are kept distinct so admins can tell which side of the
pipeline is the bottleneck.
"""
from __future__ import annotations

from typing import Iterable, Set, Tuple

from .base import Sample, SpeakerSpan


def speaker_set(spans) -> Set[str]:
    """Collect the distinct speaker ids from a span list. Returns an
    empty set when `spans` is falsy. Used as the input to
    speaker_diarization's count-match heuristic."""
    if not spans:
        return set()
    return {label for _, _, label in spans}


def split_skip_counts(samples: Iterable[Sample]) -> Tuple[int, int]:
    """Count how many samples have to be skipped because of missing
    metadata. Returned tuple is `(skipped_no_ref_speakers,
    skipped_no_hyp_speakers)`."""
    no_ref = 0
    no_hyp = 0
    for s in samples:
        if not s.speakers:
            no_ref += 1
        elif not s.hypothesis_speakers:
            no_hyp += 1
    return no_ref, no_hyp


def char_assignment(text_len: int, spans) -> list:
    """Build a per-char speaker label array of length `text_len`.

    Chars not covered by any span land in the `__unassigned__` bucket
    so the comparison can treat ref ↔ hyp char-by-char without losing
    coverage information. Out-of-range spans are clamped silently —
    the manifest_loader's range check should already prevent this."""
    out = ["__unassigned__"] * text_len
    if not spans:
        return out
    for start, end, label in spans:
        s = max(0, min(text_len, start))
        e = max(s, min(text_len, end))
        for i in range(s, e):
            out[i] = label
    return out
