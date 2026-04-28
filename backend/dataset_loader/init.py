"""Download a random sample of audio files from one or more Hugging Face datasets.

Dataset cards are read, one per line, from a ``.txt`` file in the Source folder
(``Source`` by default, next to this script). Blank lines and lines starting
with ``#`` are ignored.

Usage:
    python init.py                    # interactive picker over Source folder
    python init.py -f my_cards.txt    # file in Source folder
    python init.py -f path/to/cards.txt   # any path
"""

import argparse
import json
import os
from datetime import datetime
from typing import List, Optional, Tuple

from dotenv import load_dotenv
from huggingface_hub import login

from backend.dataset_loader.utils.hf_data_loader import download_random_audio_sample


SOURCE_DIR = "Source"
FAILURE_RUNS_SUBDIR = "failure_runs"
SPLIT = "train"
NUM_SAMPLES = 10
SEED = 42


def read_dataset_cards(path: str) -> List[str]:
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    return [
        line.strip()
        for line in lines
        if line.strip() and not line.lstrip().startswith("#")
    ]


def resolve_cards_file(arg: Optional[str], source_dir: str) -> str:
    """Resolve ``--file`` argument to an absolute path. Falls back to an
    interactive picker over ``source_dir`` if no argument is given."""
    if arg:
        # Try as given (absolute or relative to cwd), then as name inside source_dir.
        for candidate in (arg, os.path.join(source_dir, arg)):
            if os.path.isfile(candidate):
                return os.path.abspath(candidate)
        raise FileNotFoundError(f"Could not find cards file: {arg}")

    return pick_cards_file_interactive(source_dir)


def pick_cards_file_interactive(source_dir: str) -> str:
    if not os.path.isdir(source_dir):
        raise FileNotFoundError(f"Source folder not found: {source_dir}")

    candidates = sorted(
        f
        for f in os.listdir(source_dir)
        if f.lower().endswith(".txt") and os.path.isfile(os.path.join(source_dir, f))
    )
    if not candidates:
        raise FileNotFoundError(f"No .txt files in {source_dir}")

    if len(candidates) == 1:
        only = candidates[0]
        print(f"Using only .txt file in {source_dir}: {only}")
        return os.path.join(source_dir, only)

    print(f"\nDataset card files in {source_dir}:")
    for i, name in enumerate(candidates, start=1):
        print(f"  [{i}] {name}")

    while True:
        choice = input(f"Select a file [1-{len(candidates)}]: ").strip()
        if choice.isdigit():
            idx = int(choice)
            if 1 <= idx <= len(candidates):
                return os.path.join(source_dir, candidates[idx - 1])
        print("Invalid selection, try again.")


def parse_card(card: str) -> Tuple[str, Optional[str], Optional[str]]:
    """Split ``dataset/name[:config][@split]`` into ``(name, config, split)``."""
    rest = card.strip()
    split_override: Optional[str] = None
    if "@" in rest:
        rest, _, split_part = rest.partition("@")
        split_override = split_part.strip() or None
    if ":" in rest:
        name, _, config = rest.partition(":")
        return name.strip(), (config.strip() or None), split_override
    return rest.strip(), None, split_override


def process_dataset(card: str, output_root: str, datasets_cache: str) -> None:
    dataset_name, config_name, split_override = parse_card(card)
    split = split_override or SPLIT
    label = f"{dataset_name}:{config_name}" if config_name else dataset_name
    print("\n" + "=" * 60)
    print(f"Processing: {label} (split={split})")
    print("=" * 60)

    rows = download_random_audio_sample(
        dataset_name=dataset_name,
        split=split,
        num_samples=NUM_SAMPLES,
        seed=SEED,
        cache_dir=datasets_cache,
        config_name=config_name,
    )

    subdir = dataset_name.replace("/", "-")
    if config_name:
        subdir = f"{subdir}-{config_name}"
    dataset_dir = os.path.join(output_root, subdir)
    audio_dir = os.path.join(dataset_dir, "audio")
    os.makedirs(audio_dir, exist_ok=True)

    manifest = []
    for i, row in enumerate(rows):
        out_row = {}
        for col, val in row.items():
            # Undecoded audio entries look like {"bytes": b"...", "path": "..."}.
            if isinstance(val, dict) and val.get("bytes"):
                ext = os.path.splitext(val.get("path") or "")[1] or ".wav"
                fname = f"{i:04d}_{col}{ext}"
                with open(os.path.join(audio_dir, fname), "wb") as f:
                    f.write(val["bytes"])
                out_row[col] = f"audio/{fname}"
            else:
                out_row[col] = val
        manifest.append(out_row)

    manifest_path = os.path.join(dataset_dir, "sample.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(rows)} samples to {dataset_dir}")


def derive_cards_name(cards_path: str) -> str:
    """Extract ``{name}`` from a ``dataset_cards_{name}.txt`` filename. Falls
    back to the bare stem if the prefix isn't present."""
    stem = os.path.splitext(os.path.basename(cards_path))[0]
    prefix = "dataset_cards_"
    return stem[len(prefix) :] if stem.startswith(prefix) else stem


def write_failures_file(
    failures: List[Tuple[str, str]], source_dir: str, cards_path: str
) -> str:
    """Write failed cards to ``Source/failure_runs/failed_<name>_<timestamp>.txt``
    so the user can re-run against it (via the picker or ``-f``)."""
    failures_dir = os.path.join(source_dir, FAILURE_RUNS_SUBDIR)
    os.makedirs(failures_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = derive_cards_name(cards_path)
    out_path = os.path.join(failures_dir, f"failed_{name}_{timestamp}.txt")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(f"# Failed downloads from {cards_path}\n")
        f.write(f"# Generated: {datetime.now().isoformat(timespec='seconds')}\n")
        f.write("# Error details follow each entry as a comment.\n\n")
        for card, err in failures:
            f.write(f"{card}\n")
            f.write(f"#   error: {err}\n\n")

    return out_path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Download random audio samples from Hugging Face datasets listed in a cards file."
    )
    parser.add_argument(
        "-f",
        "--file",
        help="Path to cards file, or filename inside the Source folder. "
        "If omitted, an interactive picker is shown.",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    project_dir = os.path.dirname(os.path.abspath(__file__))
    output_root = os.path.join(project_dir, "sampled_datasets")
    cache_root = os.path.join(output_root, ".hf_cache")
    datasets_cache = os.path.join(cache_root, "datasets")
    source_dir = os.path.join(project_dir, SOURCE_DIR)
    os.makedirs(datasets_cache, exist_ok=True)

    # Pin HF caches inside the project so re-runs reuse downloaded shards.
    os.environ["HF_HOME"] = cache_root
    os.environ["HF_DATASETS_CACHE"] = datasets_cache

    load_dotenv(os.path.join(project_dir, ".env"))
    token = os.getenv("HF_TOKEN")
    if token:
        login(token=token)
    else:
        print("Warning: no HF_TOKEN in .env — gated datasets will fail.")

    cards_path = resolve_cards_file(args.file, source_dir)
    cards = read_dataset_cards(cards_path)
    if not cards:
        print(f"No dataset cards found in {cards_path}.")
        return

    print(f"\nFound {len(cards)} dataset card(s) in {cards_path}.")

    failures = []
    for card in cards:
        try:
            process_dataset(card, output_root, datasets_cache)
        except Exception as e:
            print(f"Failed to process {card}: {e}")
            failures.append((card, str(e)))

    print("\n" + "=" * 60)
    print(f"Done. {len(cards) - len(failures)}/{len(cards)} succeeded.")
    if failures:
        print("Failures:")
        for card, err in failures:
            print(f"  - {card}: {err}")
        failures_path = write_failures_file(failures, source_dir, cards_path)
        print(f"\nWrote failure list to {failures_path}")
        rerun_arg = os.path.relpath(failures_path, source_dir).replace(os.sep, "/")
        print(f"Re-run with: python init.py -f {rerun_arg}")


if __name__ == "__main__":
    main()
