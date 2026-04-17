"""
Masking policy. Pure functions over span lists — no I/O, no DB. The
orchestrator wires these together with the gliner client and persistence.

Three rules from the implementation plan §5:
  1. Manual Alt+G masks win over model spans (user intent wins on overlap).
  2. Overlapping model spans resolve longest-first.
  3. Recurring entity within a run gets a stable placeholder index, so
     downstream training sees [MASKED_NAME_01] consistently for the same
     person across the transcript.
"""

import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Tuple

from .labels import LABEL_TO_ID, placeholder

# Matches both the raw `[MASK]` Alt+G inserts and pre-typed `[MASKED_*_NN]`.
MANUAL_MASK_RE = re.compile(r"\[MASK(?:ED_[A-Z_]+_\d+)?\]")


@dataclass
class ModelSpan:
    segment_id: str
    start: int
    end: int
    text: str
    label: str          # gliner label string
    score: float

    @property
    def length(self) -> int:
        return self.end - self.start


@dataclass
class ManualSpan:
    segment_id: str
    start: int
    end: int
    raw: str            # the matched `[MASK]` or `[MASKED_*_NN]` text


@dataclass
class FinalSpan:
    segment_id: str
    start: int
    end: int
    original_text: str
    entity_id: str
    placeholder: str
    confidence: float
    source: str         # 'model' | 'manual'


@dataclass
class _Counter:
    """Monotonic per-entity counter with stable-text dedupe."""
    next_idx: Dict[str, int] = field(default_factory=dict)
    seen: Dict[Tuple[str, str], str] = field(default_factory=dict)

    def assign(self, entity_id: str, text: str) -> str:
        key = (entity_id, text.strip().lower())
        if key in self.seen:
            return self.seen[key]
        idx = self.next_idx.get(entity_id, 0) + 1
        self.next_idx[entity_id] = idx
        token = placeholder(entity_id, idx)
        self.seen[key] = token
        return token


def find_manual_masks(segment_id: str, text: str) -> List[ManualSpan]:
    """Locate any pre-existing manual `[MASK]` / `[MASKED_*_NN]` regions."""
    return [
        ManualSpan(segment_id=segment_id, start=m.start(), end=m.end(), raw=m.group(0))
        for m in MANUAL_MASK_RE.finditer(text)
    ]


def resolve_overlaps(spans: Iterable[ModelSpan]) -> List[ModelSpan]:
    """Longest-first; discard any span enclosed by an already-kept span."""
    by_seg: Dict[str, List[ModelSpan]] = {}
    for s in spans:
        by_seg.setdefault(s.segment_id, []).append(s)

    kept: List[ModelSpan] = []
    for seg_id, group in by_seg.items():
        # Sort by length desc, then by score desc for ties.
        ordered = sorted(group, key=lambda s: (-s.length, -s.score))
        accepted: List[ModelSpan] = []
        for cand in ordered:
            if any(_overlaps(cand, k) for k in accepted):
                continue
            accepted.append(cand)
        # Re-sort by start so downstream rendering is left-to-right.
        kept.extend(sorted(accepted, key=lambda s: s.start))
    return kept


def drop_model_spans_overlapping_manual(
    model_spans: Iterable[ModelSpan],
    manual_by_segment: Dict[str, List[ManualSpan]],
) -> List[ModelSpan]:
    """User intent wins — drop any model span that intersects a manual mask."""
    kept: List[ModelSpan] = []
    for s in model_spans:
        manuals = manual_by_segment.get(s.segment_id, [])
        if any(_intersects(s.start, s.end, m.start, m.end) for m in manuals):
            continue
        kept.append(s)
    return kept


def assign_placeholders(
    model_spans: Iterable[ModelSpan],
    manual_spans: Iterable[ManualSpan],
    segment_text: Dict[str, str],
) -> List[FinalSpan]:
    """
    Produce the final span list with stable placeholder tokens. Manual masks
    keep their existing token if already typed (`[MASKED_*_NN]`); raw `[MASK]`
    regions get upgraded by inferring entity type from neighbouring model
    spans within the same segment, falling back to person_name (the most
    common Alt+G case).
    """
    counter = _Counter()
    out: List[FinalSpan] = []

    # Pre-register any pre-typed manual placeholders so the counter stays
    # in sync (avoids handing out a duplicate index downstream).
    for m in manual_spans:
        if m.raw != "[MASK]":
            entity_id = _entity_from_typed_placeholder(m.raw)
            if entity_id:
                _bump_counter_for_typed(counter, entity_id, m.raw)

    # Manual spans first (deterministic), then model spans.
    for m in manual_spans:
        seg_text = segment_text.get(m.segment_id, "")
        original = seg_text[m.start:m.end]
        if m.raw == "[MASK]":
            entity_id = "person_name"   # safe default for Alt+G upgrades
            token = counter.assign(entity_id, f"_alt_g_{m.start}")  # unique
        else:
            entity_id = _entity_from_typed_placeholder(m.raw) or "person_name"
            token = m.raw                # already a stable token, keep as-is
        out.append(FinalSpan(
            segment_id=m.segment_id,
            start=m.start,
            end=m.end,
            original_text=original,
            entity_id=entity_id,
            placeholder=token,
            confidence=1.0,              # manual = certain by definition
            source="manual",
        ))

    for s in model_spans:
        entity_id = LABEL_TO_ID.get(s.label, s.label.replace(" ", "_"))
        token = counter.assign(entity_id, s.text)
        out.append(FinalSpan(
            segment_id=s.segment_id,
            start=s.start,
            end=s.end,
            original_text=s.text,
            entity_id=entity_id,
            placeholder=token,
            confidence=s.score,
            source="model",
        ))

    out.sort(key=lambda f: (f.segment_id, f.start))
    return out


def render_masked_text(segment_text: str, finals: List[FinalSpan]) -> str:
    """Apply final spans to a segment, replacing original text with placeholders."""
    pieces: List[str] = []
    cursor = 0
    for span in sorted(finals, key=lambda f: f.start):
        if span.start < cursor:
            continue            # safety: skip any overlap that slipped through
        pieces.append(segment_text[cursor:span.start])
        pieces.append(span.placeholder)
        cursor = span.end
    pieces.append(segment_text[cursor:])
    return "".join(pieces)


# ── helpers ──────────────────────────────────────────────────────────────

_TYPED_PREFIX_RE = re.compile(r"\[MASKED_([A-Z_]+)_(\d+)\]")


def _overlaps(a: ModelSpan, b: ModelSpan) -> bool:
    return _intersects(a.start, a.end, b.start, b.end)


def _intersects(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return not (a_end <= b_start or b_end <= a_start)


def _entity_from_typed_placeholder(raw: str) -> str | None:
    m = _TYPED_PREFIX_RE.match(raw)
    if not m:
        return None
    prefix = m.group(1)
    # Reverse-lookup against ID_TO_PREFIX.
    from .labels import ID_TO_PREFIX
    for entity_id, p in ID_TO_PREFIX.items():
        if p == prefix:
            return entity_id
    return None


def _bump_counter_for_typed(counter: _Counter, entity_id: str, raw: str) -> None:
    m = _TYPED_PREFIX_RE.match(raw)
    if not m:
        return
    idx = int(m.group(2))
    current = counter.next_idx.get(entity_id, 0)
    if idx > current:
        counter.next_idx[entity_id] = idx
