docker compose run --rm -e PYTHONPATH=/app database pytest tests
docker compose run --rm -e PYTHONPATH=/app audio_submission pytest tests
docker compose run --rm -v "%cd%/transcription_orchestrator:/app" -e PYTHONPATH=/app transcription-orchestrator pytest tests