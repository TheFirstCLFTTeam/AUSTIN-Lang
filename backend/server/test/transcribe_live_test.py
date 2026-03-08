"""
Live-server integration tests for the /transcribe endpoint.

Assumes the transcription server is **already running** — no server process is
started by this module.  Point the tests at any running instance via --base-url.

Usage
-----
# Against the default localhost:8000
    pytest test/transcribe_live_test.py -v

# Custom server URL and audio directory
    pytest test/transcribe_live_test.py -v \
        --base-url http://localhost:8000 \
        --audio-dir /path/to/audio/clips

# English mono-lang clips bundled with the repo
    pytest test/transcribe_live_test.py -v \
        --audio-dir test/audio_clips/monolang/english
"""

from __future__ import annotations

from pathlib import Path

import pytest
import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SUPPORTED_AUDIO_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".webm", ".mp4"
}

REQUEST_TIMEOUT_SECONDS = 300  # Generous timeout; transcription can be slow.


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def base_url(request) -> str:
    """Return the base URL of the running server (from --base-url)."""
    return request.config.getoption("--base-url").rstrip("/")


@pytest.fixture(scope="session")
def audio_dir(request) -> Path:
    """Return the directory that contains audio clips to test (from --audio-dir)."""
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
# Helpers
# ---------------------------------------------------------------------------

def _post_audio(base_url: str, file_path: Path) -> dict:
    """POST *file_path* to /transcribe and return the parsed JSON body.

    Raises AssertionError if the HTTP status code is not 200.
    """
    with file_path.open("rb") as fh:
        response = requests.post(
            f"{base_url}/transcribe",
            files={"audio": (file_path.name, fh, "audio/octet-stream")},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    assert response.status_code == 200, (
        f"POST /transcribe for '{file_path.name}' returned HTTP "
        f"{response.status_code}: {response.text}"
    )
    return response.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestServerReachable:
    """Quick sanity-check before running transcription tests."""

    def test_health_endpoint_responds(self, base_url: str):
        """GET /health must return 200 — confirms the server is up."""
        try:
            response = requests.get(f"{base_url}/health", timeout=10)
        except requests.exceptions.ConnectionError as exc:
            pytest.fail(
                f"Could not reach server at {base_url}. "
                f"Make sure it is running before executing these tests.\n{exc}"
            )
        assert response.status_code == 200, (
            f"Health endpoint returned {response.status_code}: {response.text}"
        )

    def test_model_is_loaded(self, base_url: str):
        """The health response must report model_loaded=True."""
        response = requests.get(f"{base_url}/health", timeout=10)
        data = response.json()
        assert data.get("model_loaded") is True, (
            "Server reported model_loaded=False — the Whisper model has not "
            f"finished loading. Full response: {data}"
        )


class TestTranscribeEndpoint:
    """Send every audio file in the configured directory to /transcribe."""

    def test_all_files_return_response(self, base_url: str, audio_files: list[Path]):
        """Every file must receive a 200 response with a non-empty 'text' field.

        All files are tested before reporting failures so the full picture is
        visible in a single run.
        """
        failed: list[str] = []

        for audio_file in audio_files:
            try:
                data = _post_audio(base_url, audio_file)
                text = data.get("text", "")
                print(f"\n[{audio_file.name}] transcription: {text!r}")
                if not isinstance(text, str) or not text.strip():
                    failed.append(
                        f"{audio_file.name}: 'text' is empty or missing "
                        f"(full response: {data})"
                    )
            except AssertionError as exc:
                failed.append(str(exc))
            except Exception as exc:  # noqa: BLE001
                failed.append(f"{audio_file.name}: unexpected error — {exc}")

        if failed:
            joined = "\n  ".join(failed)
            pytest.fail(
                f"{len(failed)} / {len(audio_files)} file(s) did not return a valid "
                f"transcription:\n  {joined}"
            )

    def test_file_returns_nonempty_text(self, base_url: str, audio_file: Path):
        """One parametrized sub-test per file for granular failure reporting."""
        data = _post_audio(base_url, audio_file)
        print(f"\n[{audio_file.name}] transcription: {data.get('text', '')!r}")

        assert "text" in data, (
            f"'{audio_file.name}': response JSON missing 'text' field. "
            f"Full response: {data}"
        )
        assert isinstance(data["text"], str), (
            f"'{audio_file.name}': 'text' is not a string "
            f"(got {type(data['text']).__name__})."
        )
        assert data["text"].strip(), (
            f"'{audio_file.name}': transcription text is empty or whitespace-only."
        )


def pytest_generate_tests(metafunc):
    """Dynamically parametrize test_file_returns_nonempty_text with audio files."""
    if "audio_file" in metafunc.fixturenames and metafunc.function.__name__ == "test_file_returns_nonempty_text":
        audio_dir = Path(metafunc.config.getoption("--audio-dir")).resolve()
        files = sorted(
            f
            for f in audio_dir.rglob("*")
            if f.is_file() and f.suffix.lower() in SUPPORTED_AUDIO_EXTENSIONS
        )
        metafunc.parametrize(
            "audio_file",
            files,
            ids=[f.name for f in files],
        )
