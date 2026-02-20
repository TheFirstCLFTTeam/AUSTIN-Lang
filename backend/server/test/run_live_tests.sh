#!/usr/bin/env bash
# Run the live-server integration tests in transcribe_live_test.py.
#
# The transcription server must already be running before executing this script.
#
# Usage:
#   ./run_live_tests.sh                                  # defaults: localhost:8000, audio_clips/
#   ./run_live_tests.sh --base-url http://host:8000
#   ./run_live_tests.sh --audio-dir /path/to/audio
#   ./run_live_tests.sh --base-url http://host:8000 --audio-dir /path/to/audio

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default values (must match conftest.py defaults)
BASE_URL="http://localhost:8000"
AUDIO_DIR="$SCRIPT_DIR/audio_clips/monolang/english"

# Parse optional overrides
while [[ $# -gt 0 ]]; do
    case "$1" in
        --base-url)
            BASE_URL="$2"; shift 2 ;;
        --audio-dir)
            AUDIO_DIR="$2"; shift 2 ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Usage: $0 [--base-url URL] [--audio-dir PATH]" >&2
            exit 1 ;;
    esac
done

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/transcription_${TIMESTAMP}.log"

mkdir -p "$LOG_DIR"

echo "Running live tests against: $BASE_URL"
echo "Audio directory:            $AUDIO_DIR"
echo "Log file:                   $LOG_FILE"
echo ""

pytest "$SCRIPT_DIR/transcribe_live_test.py" -v -s \
    --base-url "$BASE_URL" \
    --audio-dir "$AUDIO_DIR" \
    2>&1 | tee "$LOG_FILE"
