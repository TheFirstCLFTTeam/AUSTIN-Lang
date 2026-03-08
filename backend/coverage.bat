@echo off
echo Running Coverage for Database...
docker compose run --rm -e PYTHONPATH=/app database pytest --cov=. --cov-report=term-missing tests

echo.
echo Running Coverage for Audio Submission...
docker compose run --rm -e PYTHONPATH=/app audio_submission pytest --cov=. --cov-report=term-missing tests

echo.
echo Running Coverage for Transcription Orchestrator...
docker compose run --rm -v "%cd%/transcription_orchestrator:/app" -e PYTHONPATH=/app transcription-orchestrator pytest --cov=. --cov-report=term-missing tests
