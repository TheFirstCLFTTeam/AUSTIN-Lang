# AUSTIN-Lang Transcription Server

A FastAPI server for audio transcription using OpenAI's Whisper model.

## Features

- **Audio Transcription**: Upload audio files and receive transcriptions
- **Multiple Formats**: Supports MP3, WAV, M4A, FLAC, OGG, WebM, MP4
- **Batch Processing**: Transcribe multiple files in a single request
- **Language Detection**: Automatic language detection or specify manually
- **Segment Information**: Optional detailed timing for each segment
- **Multiple Models**: Choose from tiny, base, small, medium, large, large-v2, large-v3

## Quick Start

### 1. Install Dependencies

```bash
cd backend/server
pip install -r requirements.txt
```

> **Note**: The first run will download the Whisper model (~140MB for base, larger for other models).

### 2. Run the Server

```bash
# Simple run (base model)
python run.py

# With options
python run.py --model small --port 8000 --reload

# Available models (accuracy vs speed tradeoff):
#   tiny    - Fastest, lowest accuracy
#   base    - Good balance (default)
#   small   - Better accuracy
#   medium  - High accuracy
#   large   - Best accuracy, slowest
```

### 3. Test the API

```bash
# Check server health
curl http://localhost:8000/health

# Transcribe an audio file
curl -X POST "http://localhost:8000/transcribe" \
  -F "audio=@your_audio.mp3"

# With language and segments
curl -X POST "http://localhost:8000/transcribe?language=en&include_segments=true" \
  -F "audio=@your_audio.mp3"
```

Or use the test script:

```bash
python test_api.py your_audio.mp3
```

## API Endpoints

### `GET /` or `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "model_loaded": true,
  "model_name": "base"
}
```

### `POST /transcribe`
Transcribe a single audio file.

**Parameters:**
- `audio` (file, required): Audio file to transcribe
- `language` (string, optional): Language code (e.g., "en", "es", "zh")
- `include_segments` (bool, optional): Include segment timings

**Response:**
```json
{
  "text": "Hello, this is a test transcription.",
  "language": "en",
  "duration": 5.2,
  "segments": [
    {"start": 0.0, "end": 2.5, "text": "Hello,"},
    {"start": 2.5, "end": 5.2, "text": "this is a test transcription."}
  ]
}
```

### `POST /transcribe/batch`
Transcribe multiple audio files.

**Parameters:**
- `audio_files` (files, required): Multiple audio files
- `language` (string, optional): Language code for all files

**Response:**
```json
{
  "results": [
    {"filename": "audio1.mp3", "success": true, "text": "...", "language": "en"},
    {"filename": "audio2.mp3", "success": true, "text": "...", "language": "en"}
  ]
}
```

## API Documentation

Once the server is running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Configuration

Environment variables:
- `WHISPER_MODEL`: Model to use (default: "base")

## Model Size Comparison

| Model  | Parameters | English-only | Multilingual | VRAM  | Speed |
| ------ | ---------- | ------------ | ------------ | ----- | ----- |
| tiny   | 39M        | ~1%          | ~1%          | ~1GB  | ~32x  |
| base   | 74M        | ~3%          | ~3%          | ~1GB  | ~16x  |
| small  | 244M       | ~5%          | ~5%          | ~2GB  | ~6x   |
| medium | 769M       | ~6%          | ~6%          | ~5GB  | ~2x   |
| large  | 1550M      | ~7%          | ~7%          | ~10GB | 1x    |

*Error rates on Librispeech test-clean; lower is better.*
