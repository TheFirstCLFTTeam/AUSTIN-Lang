"""
Integration tests for the AUSTIN-Lang Transcription Server.

Starts the server in a background process, discovers every audio file inside
a directory (passed via --audio-dir, default: test/audio_clips), POSTs each
file to /transcribe, and asserts that a non-empty transcription is returned.

Usage examples
--------------
# Run with the default audio clip directory:
    pytest test/default_eng_monolang_test.py -v

# Run with a custom directory:
    pytest test/default_eng_monolang_test.py -v --audio-dir /path/to/my/clips

# Point at the built-in English mono-lang clips explicitly:
    pytest test/default_eng_monolang_test.py -v \
        --audio-dir test/audio_clips/monolang/english
"""

from __future__ import annotations

import multiprocessing
import os
import sys
import time
from pathlib import Path
from typing import Generator

import pytest
import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SERVER_HOST = "127.0.0.1"
SERVER_PORT = int(os.environ.get("SERVER_PORT", "8003"))
SERVER_BASE_URL = f"http://{SERVER_HOST}:{SERVER_PORT}"
TRANSCRIBE_ENDPOINT = f"{SERVER_BASE_URL}/transcribe"
HEALTH_ENDPOINT = f"{SERVER_BASE_URL}/health"

SUPPORTED_AUDIO_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".webm", ".mp4"
}

STARTUP_TIMEOUT_SECONDS = 120   # Whisper model load can be slow on first run.
POLL_INTERVAL_SECONDS = 2
REQUEST_TIMEOUT_SECONDS = 300   # Allow generous time for transcription.


# ---------------------------------------------------------------------------
# Server startup helpers
# ---------------------------------------------------------------------------

def _run_server(host: str, port: int, model: str = "tiny") -> None:
    """Target function executed in a subprocess — starts the uvicorn server.

    Uses the *tiny* Whisper model by default so that tests start up quickly.
    Set the WHISPER_MODEL env var before running pytest to override.
    """
    # Add the server package directory to sys.path so relative imports work.
    server_dir = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(server_dir))

    os.environ.setdefault("WHISPER_MODEL", model)

    import uvicorn  # noqa: PLC0415 — imported inside subprocess intentionally
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        log_level="warning",  # Suppress noisy startup logs during tests.
    )


def _wait_for_server(base_url: str, timeout: float, poll_interval: float) -> bool:
    """Poll the health endpoint until the server responds or the timeout elapses.

    Returns True when the server is ready, False on timeout.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            response = requests.get(f"{base_url}/health", timeout=5)
            if response.status_code == 200:
                return True
        except requests.exceptions.ConnectionError:
            pass
        time.sleep(poll_interval)
    return False


# ---------------------------------------------------------------------------
# Pytest fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def server_process() -> Generator[None, None, None]:
    """Session-scoped fixture: spin up the transcription server once per run.

    The subprocess is terminated (and joined) when the test session ends.
    """
    model = os.environ.get("WHISPER_MODEL", "tiny")
    proc = multiprocessing.Process(
        target=_run_server,
        args=(SERVER_HOST, SERVER_PORT, model),
        daemon=True,          # Die automatically if the test runner exits.
    )
    proc.start()

    ready = _wait_for_server(SERVER_BASE_URL, STARTUP_TIMEOUT_SECONDS, POLL_INTERVAL_SECONDS)

    if not ready:
        proc.terminate()
        proc.join(timeout=10)
        pytest.fail(
            f"Server did not become ready within {STARTUP_TIMEOUT_SECONDS} s. "
            "Check that all dependencies are installed and the model can be downloaded."
        )

    yield  # Tests run here.

    proc.terminate()
    proc.join(timeout=10)


@pytest.fixture(scope="session")
def audio_dir(request) -> Path:
    """Return the directory that contains audio clips to test."""
    path = Path(request.config.getoption("--audio-dir")).resolve()
    if not path.exists():
        pytest.fail(f"--audio-dir does not exist: {path}")
    if not path.is_dir():
        pytest.fail(f"--audio-dir is not a directory: {path}")
    return path


@pytest.fixture(scope="session")
def audio_files(audio_dir: Path) -> list[Path]:
    """Collect every supported audio file found recursively under *audio_dir*."""
    files = sorted(
        f
        for f in audio_dir.rglob("*")
        if f.is_file() and f.suffix.lower() in SUPPORTED_AUDIO_EXTENSIONS
    )
    if not files:
        pytest.fail(
            f"No supported audio files found under {audio_dir}. "
            f"Supported extensions: {', '.join(sorted(SUPPORTED_AUDIO_EXTENSIONS))}"
        )
    return files


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestServerHealth:
    """Basic sanity-check that the server is up and the model is loaded."""

    def test_health_check_returns_200(self, server_process):
        response = requests.get(HEALTH_ENDPOINT, timeout=10)
        assert response.status_code == 200, (
            f"Health endpoint returned {response.status_code}: {response.text}"
        )

    def test_health_check_model_loaded(self, server_process):
        response = requests.get(HEALTH_ENDPOINT, timeout=10)
        data = response.json()
        assert data.get("model_loaded") is True, (
            "Server reported model_loaded=False — the Whisper model did not start correctly."
        )


class TestTranscription:
    """Send each audio file in the configured directory to /transcribe."""

    def _transcribe(self, file_path: Path) -> dict:
        """POST *file_path* to the transcribe endpoint and return the JSON body."""
        with file_path.open("rb") as fh:
            response = requests.post(
                TRANSCRIBE_ENDPOINT,
                files={"audio": (file_path.name, fh, "audio/mpeg")},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        assert response.status_code == 200, (
            f"Transcription of '{file_path.name}' failed with HTTP "
            f"{response.status_code}: {response.text}"
        )
        return response.json()

    def test_all_audio_files_return_nonempty_transcription(
        self, server_process, audio_files: list[Path]
    ):
        """Every audio file must produce a non-empty 'text' field."""
        failed: list[str] = []

        for audio_file in audio_files:
            try:
                data = self._transcribe(audio_file)
                text = data.get("text", "")
                if not isinstance(text, str) or not text.strip():
                    failed.append(
                        f"{audio_file.name}: response received but 'text' is empty "
                        f"(full response: {data})"
                    )
            except AssertionError as exc:
                failed.append(str(exc))
            except Exception as exc:  # noqa: BLE001
                failed.append(f"{audio_file.name}: unexpected error — {exc}")

        if failed:
            joined = "\n  ".join(failed)
            pytest.fail(
                f"{len(failed)} / {len(audio_files)} file(s) did not produce a valid "
                f"transcription:\n  {joined}"
            )

    def test_each_audio_file_individually(
        self, server_process, audio_files: list[Path]
    ):
        """One sub-test per audio file so failures are reported individually."""
        for audio_file in audio_files:
            data = self._transcribe(audio_file)

            assert "text" in data, (
                f"'{audio_file.name}': response JSON is missing the 'text' field. "
                f"Full response: {data}"
            )
            assert isinstance(data["text"], str), (
                f"'{audio_file.name}': 'text' field is not a string (got {type(data['text'])})."
            )
            assert data["text"].strip(), (
                f"'{audio_file.name}': transcription text is empty or whitespace-only."
            )
