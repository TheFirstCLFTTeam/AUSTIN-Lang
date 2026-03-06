"""
Transcription model abstraction.
Define the TranscriptionModel interface here and add concrete implementations below.
"""

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import torch
import whisper

# Root of the pretrained weights directory, resolved relative to this file.
_PRETRAINED_WEIGHTS_DIR = Path(__file__).parent / "pretrained_weights"


def _discover_pretrained_models(weights_root: Path) -> dict[str, Path]:
    """Scan *weights_root* two levels deep and return a mapping of
    ``"<vendor>/<model_folder>"`` keys to their absolute ``Path``.

    Only sub-directories at the ``<vendor>/<model>`` depth are included;
    loose files at either level are ignored.

    Example keys: ``"openai/whisper_base"``, ``"Qwen/Qwen3_ASR_1.7B"``.
    """
    models: dict[str, Path] = {}
    if not weights_root.is_dir():
        return models
    for vendor in sorted(os.listdir(weights_root)):
        vendor_path = weights_root / vendor
        if not vendor_path.is_dir():
            continue
        for model in sorted(os.listdir(vendor_path)):
            model_path = vendor_path / model
            if model_path.is_dir():
                models[f"{vendor}/{model}"] = model_path
    return models


# Available pretrained models, keyed by "<vendor>/<model_folder>".
# Populated at import time by scanning pretrained_weights/.
PRETRAINED_MODELS: dict[str, Path] = _discover_pretrained_models(
    _PRETRAINED_WEIGHTS_DIR
)

# Registry keys used to look up each model in PRETRAINED_MODELS.
_WHISPER_V3_KEY = "openai/whisper_base"
_QWEN_ASR_KEY = "Qwen/Qwen3_ASR_1.7B"


class TranscriptionModel(ABC):
    """Abstract interface for transcription backends."""

    @abstractmethod
    def transcribe(self, audio_path: str, **kwargs: Any) -> dict[str, Any]:
        """
        Transcribe the audio file at *audio_path*.

        Returns a dict with at least:
            - ``text``     (str)  – full transcript
            - ``language`` (str)  – detected/forced language code
            - ``segments`` (list) – per-segment detail (may be empty)
        """
        pass


class WhisperModel(TranscriptionModel):
    """Concrete transcription backend backed by OpenAI Whisper large-v3.

    Weights are loaded from the local pretrained_weights/openai/ directory.
    If the checkpoint file is not present at that path, whisper will fall back
    to downloading it and caching it in the same directory.
    """

    def __init__(self, model_name: str = "whisper_base") -> None:
        # Prefer the local checkpoint file; otherwise use download_root so
        # whisper caches the download inside pretrained_weights/openai/.
        weights_path: Path | None = PRETRAINED_MODELS.get(_WHISPER_V3_KEY)
        if weights_path is not None and weights_path.exists():
            load_target: str | Path = weights_path
            print(f"Loading Whisper model from local weights: {weights_path}")
        else:
            load_target = model_name
            _PRETRAINED_WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
            print(
                f"Local weights not found for key '{_WHISPER_V3_KEY}'. "
                f"Downloading '{model_name}' to {_PRETRAINED_WEIGHTS_DIR} ..."
            )

        self._model = whisper.load_model(
            str(load_target),
            download_root=str(_PRETRAINED_WEIGHTS_DIR),
        )
        print("Whisper model loaded successfully!")

    def transcribe(self, audio_path: str, **kwargs: Any) -> dict[str, Any]:
        return self._model.transcribe(audio_path, **kwargs)


class QwenModel(TranscriptionModel):
    """Concrete transcription backend backed by Qwen3-ASR-1.7B.

    Weights are loaded from the local pretrained_weights/Qwen/Qwen3_ASR_1.7B/
    directory using the ``qwen-asr`` Python package.  If the directory is not
    present the model identifier ``"Qwen/Qwen3-ASR-1.7B"`` is passed directly
    so the package can download on first use.
    """

    def __init__(
        self,
        device_map: str = "auto",
        max_new_tokens: int = 256,
        max_inference_batch_size: int = 32,
    ) -> None:
        from qwen_asr import (
            Qwen3ASRModel,
        )  # imported lazily to keep whisper-only setups working

        weights_path: Path | None = PRETRAINED_MODELS.get(_QWEN_ASR_KEY)
        if weights_path is not None and weights_path.exists():
            model_id = str(weights_path)
            print(f"Loading Qwen3-ASR model from local weights: {weights_path}")
        else:
            model_id = "Qwen/Qwen3-ASR-1.7B"
            print(
                f"Local Qwen weights not found for key '{_QWEN_ASR_KEY}'. "
                f"Downloading '{model_id}' from Hugging Face ..."
            )

        self._model = Qwen3ASRModel.from_pretrained(
            model_id,
            dtype=torch.bfloat16,
            device_map=device_map,
            max_new_tokens=max_new_tokens,
            max_inference_batch_size=max_inference_batch_size,
        )
        print("Qwen3-ASR model loaded successfully!")

    def transcribe(self, audio_path: str, **kwargs: Any) -> dict[str, Any]:
        """Transcribe *audio_path* and return a normalised result dict.

        Accepted kwargs forwarded to ``Qwen3ASRModel.transcribe``:
            - ``language`` (str | None) – force a language or set ``None`` for
              automatic detection (default: ``None``).
        """
        language = kwargs.pop("language", None)
        results = self._model.transcribe(audio=audio_path, language=language, **kwargs)
        result = results[0]

        # Normalise to the common interface:
        #   {"text": str, "language": str, "segments": list}
        segments: list = []
        if getattr(result, "time_stamps", None):
            segments = [
                {"start": ts.start, "end": ts.end, "text": ts.text}
                for ts in result.time_stamps
            ]

        return {
            "text": result.text,
            "language": result.language,
            "segments": segments,
        }
