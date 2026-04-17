"""Mix two per-recording datasets into a 2-speaker overlay dataset.

Recording A plays from t=0. Recording B is offset by 1 second and overlaid on
top of A, so the result starts with A alone and then has B join in.

Both source recordings must share the same file extension (either both ``.wav``
or both ``.mp3``), otherwise the run aborts.

Usage:
    python mix.py                         # interactive picker for A and B
    python mix.py <A_folder> <B_folder> [--limit N]

``<A_folder>`` and ``<B_folder>`` are folder names under ``sampled_datasets/``
(e.g., ``AlienKevin-wordshk_cantonese_speech``). If either is omitted, an
interactive picker is shown. Output is written to
``multispeak_maker/MIX-{firstA}-{firstB}/`` where ``firstX`` is the substring
before the first ``-`` in the folder name.
"""

import argparse
import json
import os
from typing import Any, Dict, List, Optional, Tuple

from pydub import AudioSegment


TRANSCRIPT_KEYS_PRIORITY = [
    "transcript",
    "transcription",
    "transcript_whisper",
    "sentence",
    "text",
]

OFFSET_MS = 1000
SUPPORTED_EXTS = {".wav", ".mp3"}


def first_word(folder_name: str) -> str:
    """First token of a folder name up to the first ``-`` (e.g.,
    ``AlienKevin-foo`` -> ``AlienKevin``)."""
    return folder_name.split("-", 1)[0]


def load_manifest(dataset_dir: str) -> List[Dict[str, Any]]:
    with open(os.path.join(dataset_dir, "sample.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_transcript(row: Dict[str, Any]) -> str:
    for key in TRANSCRIPT_KEYS_PRIORITY:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value
    for key, value in row.items():
        if key == "audio":
            continue
        if isinstance(value, str) and value.strip():
            return value
    raise ValueError(
        f"No transcript-like field found in row with keys {list(row.keys())}"
    )


def audio_path(dataset_dir: str, row: Dict[str, Any]) -> str:
    rel = row.get("audio")
    if not isinstance(rel, str):
        raise ValueError(f"Row missing 'audio' field: {row}")
    return os.path.join(dataset_dir, rel)


def check_same_format(path_a: str, path_b: str) -> str:
    ext_a = os.path.splitext(path_a)[1].lower()
    ext_b = os.path.splitext(path_b)[1].lower()
    if ext_a != ext_b:
        raise ValueError(
            f"Format mismatch: A is '{ext_a}' but B is '{ext_b}'. "
            "Both recordings must share the same format."
        )
    if ext_a not in SUPPORTED_EXTS:
        raise ValueError(
            f"Unsupported format '{ext_a}'. Only {sorted(SUPPORTED_EXTS)} are supported."
        )
    return ext_a


def _normalize_to(target: AudioSegment, other: AudioSegment) -> AudioSegment:
    """Align frame rate, channels, and sample width of ``other`` to ``target``
    so overlay operates on compatible PCM."""
    return (
        other.set_frame_rate(target.frame_rate)
        .set_channels(target.channels)
        .set_sample_width(target.sample_width)
    )


def mix_pair(path_a: str, path_b: str, ext: str) -> AudioSegment:
    fmt = ext.lstrip(".")
    a = AudioSegment.from_file(path_a, format=fmt)
    b = _normalize_to(a, AudioSegment.from_file(path_b, format=fmt))

    target_len = max(len(a), OFFSET_MS + len(b))
    if target_len > len(a):
        pad = AudioSegment.silent(duration=target_len - len(a), frame_rate=a.frame_rate)
        pad = _normalize_to(a, pad)
        a = a + pad
    return a.overlay(b, position=OFFSET_MS)


def mix_datasets(
    a_folder: str,
    b_folder: str,
    sampled_root: str,
    output_root: str,
    limit: Optional[int] = None,
) -> Tuple[str, int]:
    a_dir = os.path.join(sampled_root, a_folder)
    b_dir = os.path.join(sampled_root, b_folder)
    for d in (a_dir, b_dir):
        if not os.path.isdir(d):
            raise FileNotFoundError(f"Dataset folder not found: {d}")

    manifest_a = load_manifest(a_dir)
    manifest_b = load_manifest(b_dir)
    n = min(len(manifest_a), len(manifest_b))
    if limit is not None:
        n = min(n, max(limit, 0))
    if n == 0:
        raise ValueError("Nothing to mix — one of the manifests is empty or limit is 0.")

    # Sanity-check formats up front on the first pair so we fail fast.
    ext = check_same_format(
        audio_path(a_dir, manifest_a[0]), audio_path(b_dir, manifest_b[0])
    )
    fmt = ext.lstrip(".")

    out_name = f"MIX-{first_word(a_folder)}-{first_word(b_folder)}"
    out_dir = os.path.join(output_root, out_name)
    out_audio_dir = os.path.join(out_dir, "audio")
    os.makedirs(out_audio_dir, exist_ok=True)

    mixed_manifest: List[Dict[str, Any]] = []
    for i in range(n):
        row_a, row_b = manifest_a[i], manifest_b[i]
        path_a = audio_path(a_dir, row_a)
        path_b = audio_path(b_dir, row_b)
        # Re-check per pair in case a manifest mixes formats internally.
        check_same_format(path_a, path_b)

        mixed = mix_pair(path_a, path_b, ext)
        out_filename = f"{i:04d}_audio{ext}"
        mixed.export(os.path.join(out_audio_dir, out_filename), format=fmt)

        mixed_manifest.append(
            {
                "audio": f"audio/{out_filename}",
                "speaker_1": {
                    "transcript": resolve_transcript(row_a),
                    "start_ms": 0,
                    "source_folder": a_folder,
                    "source_audio": row_a["audio"],
                },
                "speaker_2": {
                    "transcript": resolve_transcript(row_b),
                    "start_ms": OFFSET_MS,
                    "source_folder": b_folder,
                    "source_audio": row_b["audio"],
                },
            }
        )

    with open(os.path.join(out_dir, "sample.json"), "w", encoding="utf-8") as f:
        json.dump(mixed_manifest, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(mixed_manifest)} mixed recordings to {out_dir}")
    return out_dir, len(mixed_manifest)


def list_dataset_folders(sampled_root: str) -> List[str]:
    if not os.path.isdir(sampled_root):
        raise FileNotFoundError(f"sampled_datasets folder not found: {sampled_root}")
    return sorted(
        name
        for name in os.listdir(sampled_root)
        if not name.startswith(".")
        and os.path.isfile(os.path.join(sampled_root, name, "sample.json"))
    )


def pick_folder_interactive(
    sampled_root: str, role: str, exclude: Optional[str] = None
) -> str:
    candidates = [f for f in list_dataset_folders(sampled_root) if f != exclude]
    if not candidates:
        raise FileNotFoundError(
            f"No dataset folders with sample.json found under {sampled_root}"
        )

    print(f"\nAvailable datasets for recording {role}:")
    for i, name in enumerate(candidates, start=1):
        print(f"  [{i}] {name}")

    while True:
        choice = input(f"Select recording {role} [1-{len(candidates)}]: ").strip()
        if choice.isdigit():
            idx = int(choice)
            if 1 <= idx <= len(candidates):
                return candidates[idx - 1]
        print("Invalid selection, try again.")


def prompt_limit(default: Optional[int]) -> Optional[int]:
    raw = input(
        "Limit number of pairs to mix? (press Enter for all, or enter a number): "
    ).strip()
    if not raw:
        return default
    if raw.isdigit():
        return int(raw)
    print("Not a number — mixing all pairs.")
    return default


def parse_args():
    parser = argparse.ArgumentParser(
        description="Create a 2-speaker overlay dataset from two sampled_datasets folders."
    )
    parser.add_argument(
        "a_folder",
        nargs="?",
        default=None,
        help="Dataset folder name for recording A (under sampled_datasets/). Prompted if omitted.",
    )
    parser.add_argument(
        "b_folder",
        nargs="?",
        default=None,
        help="Dataset folder name for recording B (under sampled_datasets/). Prompted if omitted.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap the number of pairs to mix (default: all pairs up to the shorter manifest).",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(here)
    sampled_root = os.path.join(project_dir, "sampled_datasets")

    a_folder = args.a_folder or pick_folder_interactive(sampled_root, role="A")
    b_folder = args.b_folder or pick_folder_interactive(
        sampled_root, role="B", exclude=a_folder
    )
    limit = args.limit
    if args.a_folder is None and args.b_folder is None and limit is None:
        limit = prompt_limit(default=None)

    mix_datasets(
        a_folder,
        b_folder,
        sampled_root=sampled_root,
        output_root=here,
        limit=limit,
    )


if __name__ == "__main__":
    main()
