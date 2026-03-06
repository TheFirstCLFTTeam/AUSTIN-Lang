import difflib
import os
import sys

from dotenv import load_dotenv
from huggingface_hub import HfApi, snapshot_download

# Models to download. snapshot_download mirrors the full repo, including
# custom config/modeling .py files required by models like MERaLiON-2.
MODEL_IDS: list[str] = [
    "openai/whisper-base",
    "MERaLiON/MERaLiON-2-10B-ASR",
    "mistralai/Voxtral-Mini-4B-Realtime-2602",
    "Qwen/Qwen3-ASR-1.7B",
]

_PRETRAINED_WEIGHTS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "pretrained_weights"
)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def load_config() -> tuple[str, float | None]:
    """Load and validate runtime configuration from backend/.env.

    Returns:
        hf_token: Hugging Face API token.
        size_threshold_gb: Optional maximum model size in GB; ``None`` means
            no limit.

    Raises:
        ValueError: If ``HF_TOKEN`` is absent from the environment.
    """
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    load_dotenv(dotenv_path=env_path)

    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        raise ValueError(
            "HF_TOKEN not found. Make sure backend/.env exists and contains HF_TOKEN=..."
        )

    threshold_raw = os.environ.get("MODEL_SIZE_THRESHOLD_GB")
    size_threshold_gb = float(threshold_raw) if threshold_raw else None

    return hf_token, size_threshold_gb


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------


def get_local_model_dir(
    model_id: str, weights_root: str = _PRETRAINED_WEIGHTS_DIR
) -> str:
    """Return the local directory path for *model_id*.

    Hyphens in the model ID are replaced with underscores so that the folder
    name is a valid Python identifier (consistent with how ``model_interface``
    discovers models).

    Example: ``"openai/whisper-base"`` → ``<weights_root>/openai/whisper_base``
    """
    model_id_safe = model_id.replace("-", "_")
    org, model_name = model_id_safe.split("/", 1)
    return os.path.join(weights_root, org, model_name)


def is_already_downloaded(local_dir: str) -> bool:
    """Return ``True`` if *local_dir* exists and contains at least one file."""
    return os.path.exists(local_dir) and bool(os.listdir(local_dir))


# ---------------------------------------------------------------------------
# Size check
# ---------------------------------------------------------------------------


def get_model_size_gb(model_id: str, api: HfApi) -> float:
    """Query the Hugging Face Hub and return the total size of *model_id* in GB."""
    info = api.model_info(model_id, files_metadata=True)
    total_bytes = sum(s.size for s in (info.siblings or []) if s.size is not None)
    return total_bytes / (1024**3)


def exceeds_size_threshold(model_id: str, api: HfApi, threshold_gb: float) -> bool:
    """Return ``True`` if *model_id* is larger than *threshold_gb* GB.

    Prints a status line either way so the caller can always `continue` on
    ``True`` without extra logging.
    """
    total_gb = get_model_size_gb(model_id, api)
    if total_gb > threshold_gb:
        print(
            f"Skipping {model_id}: size {total_gb:.2f} GB exceeds "
            f"MODEL_SIZE_THRESHOLD_GB={threshold_gb} GB."
        )
        return True
    print(f"{model_id} size: {total_gb:.2f} GB — within threshold, proceeding.")
    return False


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------


def download_model(model_id: str, local_dir: str, hf_token: str) -> None:
    """Download *model_id* from the Hugging Face Hub into *local_dir*."""
    os.makedirs(local_dir, exist_ok=True)
    print(f"Downloading {model_id} to {local_dir}...")
    snapshot_download(
        repo_id=model_id,
        local_dir=local_dir,
        token=hf_token,
    )
    print(f"Downloaded {model_id} successfully.")


# ---------------------------------------------------------------------------
# Fuzzy search
# ---------------------------------------------------------------------------


def fuzzy_find_model(
    query: str,
    model_ids: list[str] = MODEL_IDS,
    cutoff: float = 0.4,
) -> str | None:
    """Return the best-matching model ID for *query*, or ``None`` if no
    candidate is close enough.

    Matching is attempted against both the full ID (e.g. ``"Qwen/Qwen3-ASR-1.7B"``)
    and just the model-name portion after the ``/``.  The search is
    case-insensitive and treats hyphens and underscores as equivalent so that
    e.g. ``"qwen3 asr"`` still resolves to ``"Qwen/Qwen3-ASR-1.7B"``.
    """

    def normalise(s: str) -> str:
        return s.lower().replace("-", "_").replace(" ", "_")

    query_norm = normalise(query)

    # Build a lookup: normalised candidate → original model ID
    candidates: dict[str, str] = {}
    for mid in model_ids:
        candidates[normalise(mid)] = mid
        candidates[normalise(mid.split("/", 1)[-1])] = mid

    matches = difflib.get_close_matches(
        query_norm, candidates.keys(), n=1, cutoff=cutoff
    )
    return candidates[matches[0]] if matches else None


# ---------------------------------------------------------------------------
# Single-model ensure
# ---------------------------------------------------------------------------


def ensure_model(
    model_name: str,
    model_ids: list[str] = MODEL_IDS,
    weights_root: str = _PRETRAINED_WEIGHTS_DIR,
) -> None:
    """Ensure *model_name* is downloaded, using fuzzy matching to resolve it.

    The query is matched against ``MODEL_IDS`` (full ID and name portion).
    If a match is found and the model is not yet present locally the download
    is triggered; if already present it is skipped.  Raises ``ValueError``
    when no sufficiently close match can be found.
    """
    matched_id = fuzzy_find_model(model_name, model_ids)
    if matched_id is None:
        raise ValueError(
            f"No model matching '{model_name}' found in the known model list.\n"
            f"Available: {model_ids}"
        )

    if matched_id != model_name:
        print(f"Fuzzy-matched '{model_name}' → '{matched_id}'")

    local_dir = get_local_model_dir(matched_id, weights_root)

    if is_already_downloaded(local_dir):
        print(f"'{matched_id}' is already downloaded at {local_dir}.")
        return

    hf_token, size_threshold_gb = load_config()
    api = HfApi(token=hf_token)

    if size_threshold_gb is not None and exceeds_size_threshold(
        matched_id, api, size_threshold_gb
    ):
        return

    download_model(matched_id, local_dir, hf_token)


def preload_models(
    model_ids: list[str] = MODEL_IDS,
    weights_root: str = _PRETRAINED_WEIGHTS_DIR,
) -> None:
    """Download all *model_ids* into *weights_root*, skipping those that are
    already present or exceed the configured size threshold."""
    hf_token, size_threshold_gb = load_config()
    api = HfApi(token=hf_token)

    for model_id in model_ids:
        local_dir = get_local_model_dir(model_id, weights_root)

        if is_already_downloaded(local_dir):
            print(f"{local_dir} already exists and is not empty. Skipping download.")
            continue

        if size_threshold_gb is not None and exceeds_size_threshold(
            model_id, api, size_threshold_gb
        ):
            continue

        download_model(model_id, local_dir, hf_token)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Single model mode: python preload.py "Qwen3 ASR"
        ensure_model(sys.argv[1])
    else:
        preload_models()

# Load locally (custom code files are present in the snapshot, so trust_remote_code works):
# from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
# processor = AutoProcessor.from_pretrained(local_dir, trust_remote_code=True)
# model = AutoModelForSpeechSeq2Seq.from_pretrained(local_dir, trust_remote_code=True)
