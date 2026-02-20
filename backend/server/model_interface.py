"""
Transcription model abstraction.
Define the TranscriptionModel interface here and add concrete implementations below.
"""

from abc import ABC, abstractmethod
from typing import Any

import whisper


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
        ...


class WhisperModel(TranscriptionModel):
    """Concrete transcription backend backed by OpenAI Whisper."""

    def __init__(self, model_name: str) -> None:
        print(f"Loading Whisper model: {model_name}...")
        self._model = whisper.load_model(model_name)
        print(f"Model '{model_name}' loaded successfully!")

    def transcribe(self, audio_path: str, **kwargs: Any) -> dict[str, Any]:
        return self._model.transcribe(audio_path, **kwargs)
