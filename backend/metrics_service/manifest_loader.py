import json
from pathlib import Path
from typing import List

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
            samples.append(
                Sample(
                    reference=str(data["reference"]),
                    hypothesis=str(data.get("hypothesis", "")),
                    audio_path=data.get("audio_path"),
                    tags=dict(data.get("tags") or {}),
                )
            )
    return samples
