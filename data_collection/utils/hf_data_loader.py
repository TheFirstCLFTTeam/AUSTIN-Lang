import random
from typing import Any, Dict, List, Optional

from datasets import Dataset, load_dataset


def download_random_sample(
    dataset_name: str,
    split: str = "train",
    num_samples: int = 10,
    seed: Optional[int] = 42,
    cache_dir: Optional[str] = None,
):
    """Download a random subset of instances from a Hugging Face dataset."""
    print(f"Loading dataset: {dataset_name}, split: {split}")

    stream = load_dataset(
        dataset_name,
        split=split,
        cache_dir=cache_dir,
        streaming=True,
    )

    if seed is not None:
        rng = random.Random(seed)
    else:
        rng = random.Random()

    reservoir: List[Dict[str, Any]] = []
    total_rows = 0
    for row in stream:
        total_rows += 1
        if len(reservoir) < num_samples:
            reservoir.append(row)
            continue

        replace_index = rng.randint(0, total_rows - 1)
        if replace_index < num_samples:
            reservoir[replace_index] = row

    if total_rows == 0:
        print(f"No rows found in {split} split.")
        return Dataset.from_list([])

    num_samples = min(num_samples, total_rows)
    print(f"Total instances in {split} split: {total_rows}")
    print(f"Sampling {num_samples} instances...")

    sampled_dataset = Dataset.from_list(reservoir[:num_samples])
    print(f"Successfully sampled {num_samples} instances.")
    return sampled_dataset
