"""Streaming helpers for pulling random rows out of Hugging Face datasets."""
import re
from typing import Any, Dict, List, Optional

from datasets import Audio, load_dataset


_CONFIG_LIST_RE = re.compile(r"\[([^\]]+)\]")


def _first_available_config(err: Exception) -> Optional[str]:
    """Parse the first config name out of HF's "Config name is missing" error."""
    msg = str(err)
    if "Config name is missing" not in msg and "BuilderConfig" not in msg:
        return None
    match = _CONFIG_LIST_RE.search(msg)
    if not match:
        return None
    parts = [p.strip().strip("'\"") for p in match.group(1).split(",")]
    return parts[0] if parts and parts[0] else None


def _first_available_split(err: Exception) -> Optional[str]:
    """Parse the first split name out of HF's "Bad split" error."""
    msg = str(err)
    if "Bad split" not in msg and "Available splits" not in msg:
        return None
    match = _CONFIG_LIST_RE.search(msg)
    if not match:
        return None
    parts = [p.strip().strip("'\"") for p in match.group(1).split(",")]
    return parts[0] if parts and parts[0] else None


def download_random_audio_sample(
    dataset_name: str,
    split: str = "train",
    num_samples: int = 10,
    seed: int = 42,
    shuffle_buffer: int = 1000,
    cache_dir: Optional[str] = None,
    config_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Stream a HF dataset and return ``num_samples`` randomly-chosen rows.

    Audio columns come back undecoded (raw encoded bytes + original filename),
    so no FFmpeg/torchcodec install is required. Buffered shuffle keeps us from
    iterating the entire stream — only ~``shuffle_buffer`` rows are pulled.

    If ``config_name`` is omitted and the dataset requires one, the first
    config advertised in HF's error is used as a fallback.
    """
    label = f"{dataset_name}:{config_name}" if config_name else dataset_name
    print(f"Streaming {label} (split={split})...")

    def _load(name: Optional[str], split_: str):
        return load_dataset(
            dataset_name,
            name=name,
            split=split_,
            streaming=True,
            cache_dir=cache_dir,
        )

    try:
        stream = _load(config_name, split)
    except ValueError as e:
        cfg_fallback = _first_available_config(e) if config_name is None else None
        split_fallback = _first_available_split(e)
        if cfg_fallback:
            print(f"  No config specified; falling back to '{cfg_fallback}'.")
            try:
                stream = _load(cfg_fallback, split)
            except ValueError as e2:
                split_fallback = _first_available_split(e2)
                if not split_fallback:
                    raise
                print(f"  Split '{split}' unavailable; falling back to '{split_fallback}'.")
                stream = _load(cfg_fallback, split_fallback)
        elif split_fallback:
            print(f"  Split '{split}' unavailable; falling back to '{split_fallback}'.")
            stream = _load(config_name, split_fallback)
        else:
            raise

    for col, feat in (stream.features or {}).items():
        if isinstance(feat, Audio):
            stream = stream.cast_column(col, Audio(decode=False))

    shuffled = stream.shuffle(seed=seed, buffer_size=shuffle_buffer)
    rows = list(shuffled.take(num_samples))
    print(f"Pulled {len(rows)} rows.")
    return rows
