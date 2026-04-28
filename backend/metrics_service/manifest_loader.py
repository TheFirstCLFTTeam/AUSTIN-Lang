import json
from pathlib import Path
from typing import List, Optional

from strategies.base import Sample


class ManifestError(ValueError):
    pass


def load_manifest(path: str) -> List[Sample]:
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"manifest not found: {path}")

    samples: List[Sample] = []
    with p.open(encoding="utf-8") as fh:
        for line_no, raw in enumerate(fh, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError as err:
                raise ManifestError(
                    f"manifest line {line_no} is not valid JSON: {err.msg}"
                ) from err
            if not isinstance(data, dict):
                raise ManifestError(
                    f"manifest line {line_no} must be a JSON object, got {type(data).__name__}"
                )
            if "reference" not in data:
                raise ManifestError(
                    f"manifest line {line_no} missing required field 'reference'"
                )
            critical_terms = data.get("critical_terms")
            if critical_terms is not None:
                if not isinstance(critical_terms, list):
                    raise ManifestError(
                        f"manifest line {line_no} 'critical_terms' must be a list, "
                        f"got {type(critical_terms).__name__}"
                    )
                critical_terms = [str(t) for t in critical_terms]

            info_values = data.get("info_values")
            if info_values is not None:
                if not isinstance(info_values, list):
                    raise ManifestError(
                        f"manifest line {line_no} 'info_values' must be a list, "
                        f"got {type(info_values).__name__}"
                    )
                try:
                    info_values = [float(v) for v in info_values]
                except (TypeError, ValueError) as err:
                    raise ManifestError(
                        f"manifest line {line_no} 'info_values' must be numeric: {err}"
                    ) from err

            language = data.get("language")
            if language is not None and not isinstance(language, str):
                raise ManifestError(
                    f"manifest line {line_no} 'language' must be a string, "
                    f"got {type(language).__name__}"
                )

            entity_spans = _parse_span_list(data.get("entity_spans"), "entity_spans", line_no)
            speakers = _parse_span_list(data.get("speakers"), "speakers", line_no)
            hypothesis_speakers = _parse_span_list(
                data.get("hypothesis_speakers"), "hypothesis_speakers", line_no,
            )
            language_spans = _parse_span_list(
                data.get("language_spans"), "language_spans", line_no,
            )

            # Distinguish "hypothesis key absent" (None — fan-out should
            # fill via inference) from "hypothesis key present with
            # empty string" (model silently predicted nothing — score
            # as a fully wrong sample, no fan-out).
            if "hypothesis" in data:
                raw_hyp = data["hypothesis"]
                hypothesis_value: Optional[str] = (
                    str(raw_hyp) if raw_hyp is not None else None
                )
            else:
                hypothesis_value = None

            samples.append(
                Sample(
                    reference=str(data["reference"]),
                    hypothesis=hypothesis_value,
                    audio_path=data.get("audio_path"),
                    critical_terms=critical_terms,
                    info_values=info_values,
                    language=language,
                    entity_spans=entity_spans,
                    speakers=speakers,
                    hypothesis_speakers=hypothesis_speakers,
                    language_spans=language_spans,
                    tags=dict(data.get("tags") or {}),
                )
            )
    return samples


def _parse_span_list(raw, field_name: str, line_no: int):
    """Validate + normalise a `[start, end, label]` triple list.

    Returns None when `raw` is None (manifest pre-dates the field) so
    Sample stays at its dataclass default. Returns `[]` for an empty
    list (semantically meaningful — "no spans on this sample").
    """
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise ManifestError(
            f"manifest line {line_no} {field_name!r} must be a list, "
            f"got {type(raw).__name__}"
        )
    cleaned = []
    for idx, span in enumerate(raw):
        if not isinstance(span, (list, tuple)) or len(span) != 3:
            raise ManifestError(
                f"manifest line {line_no} '{field_name}[{idx}]' must be "
                f"[start, end, label], got {span!r}"
            )
        try:
            start, end, label = int(span[0]), int(span[1]), str(span[2])
        except (TypeError, ValueError) as err:
            raise ManifestError(
                f"manifest line {line_no} '{field_name}[{idx}]' has bad types: {err}"
            ) from err
        if start < 0 or end < start:
            raise ManifestError(
                f"manifest line {line_no} '{field_name}[{idx}]' has invalid range "
                f"({start}, {end})"
            )
        cleaned.append((start, end, label))
    return cleaned
