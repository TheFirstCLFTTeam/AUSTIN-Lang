"""
Shared pytest configuration and fixtures for the server test suite.
"""

import os


def pytest_addoption(parser):
    """Register custom CLI options."""
    parser.addoption(
        "--audio-dir",
        action="store",
        default=os.path.join(os.path.dirname(__file__), "audio_clips"),
        help=(
            "Path to a directory containing audio files to send to the server. "
            "All files with supported extensions (.mp3, .wav, .m4a, .flac, .ogg, "
            ".webm, .mp4) found recursively under this directory will be tested. "
            "Defaults to test/audio_clips."
        ),
    )
    parser.addoption(
        "--base-url",
        action="store",
        default="http://localhost:8000",
        help=(
            "Base URL of the already-running transcription server. "
            "Defaults to http://localhost:8000."
        ),
    )
