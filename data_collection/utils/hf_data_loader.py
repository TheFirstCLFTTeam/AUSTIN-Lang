"""Streaming helpers for pulling random rows out of Hugging Face datasets."""
from typing import Any, Dict, List, Optional

from datasets import Audio, load_dataset


def download_random_audio_sample(
    dataset_name: str,
    split: str = "train",
    num_samples: int = 10,
    seed: int = 42,
    shuffle_buffer: int = 1000,
    cache_dir: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Stream a HF dataset and return ``num_samples`` randomly-chosen rows.

    Audio columns come back undecoded (raw encoded bytes + original filename),
    so no FFmpeg/torchcodec install is required. Buffered shuffle keeps us from
    iterating the entire stream — only ~``shuffle_buffer`` rows are pulled.
    """
    print(f"Streaming {dataset_name} (split={split})...")
    stream = load_dataset(
        dataset_name,
        split=split,
        streaming=True,
        cache_dir=cache_dir,
    )

    for col, feat in (stream.features or {}).items():
        if isinstance(feat, Audio):
            stream = stream.cast_column(col, Audio(decode=False))

    shuffled = stream.shuffle(seed=seed, buffer_size=shuffle_buffer)
    rows = list(shuffled.take(num_samples))
    print(f"Pulled {len(rows)} rows.")
    return rows
