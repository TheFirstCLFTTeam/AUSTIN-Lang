# Running the Transcription Server

The transcription server is a FastAPI app that accepts audio files and returns transcriptions using OpenAI Whisper. It lives in `backend/server/`.

---

## Prerequisites

- Python 3.10+
- `ffmpeg` installed and on your PATH (required by Whisper for audio decoding)
    - Windows: `winget install ffmpeg` or download from <https://ffmpeg.org/download.html>
- A Hugging Face token in `backend/.env` (required for model pre-downloading only):

  ```
  HF_TOKEN=hf_...
  ```

---

## Option 1 — Run Locally (Recommended for Development)

### 1. Install dependencies

From the repo root:

```bash
cd backend/server
pip install -r configs/requirements.txt
```

Or, if you are using the full Conda environment (includes CUDA/GPU support):

```bash
conda env create -f configs/server_dev_env.yml
conda activate austin_back
```

### 2. (Optional) Pre-download model weights

This downloads Whisper and other model weights from Hugging Face into `backend/server/pretrained_weights/`. Requires `HF_TOKEN` in `backend/.env`.

```bash
python utils/preload.py
```

### 3. Start the server

```bash
# Default — base Whisper model on port 8003
python run.py

# Specify a different model
python run.py --model small

# Specify a different port
python run.py --port 8000

# Enable hot-reload for development
python run.py --reload

# Full example
python run.py --model medium --port 8003 --reload
```

The server will be available at **<http://localhost:8003>** (or whichever port you chose).

#### Available CLI options

| Flag        | Default                              | Description                               |
|-------------|--------------------------------------|-------------------------------------------|
| `--host`    | `0.0.0.0`                            | Host to bind to                           |
| `--port`    | `8003` (or `$SERVER_PORT` env var)   | Port to listen on                         |
| `--model`   | `base`                               | Whisper model size (see table below)      |
| `--reload`  | off                                  | Enable hot-reload (development only)      |
| `--workers` | `1`                                  | Number of worker processes (no-reload only)|

#### Whisper model sizes

| Model    | VRAM  | Relative Speed | Notes                    |
|----------|-------|----------------|--------------------------|
| tiny     | ~1 GB | ~32x           | Fastest, lowest accuracy |
| base     | ~1 GB | ~16x           | Default                  |
| small    | ~2 GB | ~6x            | Good balance             |
| medium   | ~5 GB | ~2x            | High accuracy            |
| large    | ~10 GB| 1x             | Best accuracy, slowest   |
| large-v2 | ~10 GB| 1x             | Improved large           |
| large-v3 | ~10 GB| 1x             | Latest large             |

The model can also be set via the environment variable `WHISPER_MODEL` instead of the CLI flag.

---

## Option 2 — Run with Docker (Standalone)

```bash
cd backend/server
docker build --build-arg SERVER_PORT=8003 -t austin-server .
docker run -p 8003:8003 -e SERVER_PORT=8003 austin-server
```

---

## Option 3 — Run with Docker Compose (Full Stack)

From `backend/`, with a `.env` file that sets the required ports:

```bash
# Example backend/.env
SERVER_PORT=8003
AUDIO_SUBMISSION_PORT=8001
TRANSCRIPTION_ORCHESTRATOR_PORT=8002
DATABASE_PORT=5432
SKIP_TRANSCRIPTION_SERVER=false
```

```bash
cd backend
docker compose up --build transcription-server
# or bring up the entire stack:
docker compose up --build
```

---

## Verifying the Server is Running

```bash
# Health check
curl http://localhost:8003/health

# Expected response
# {"status":"healthy","model_loaded":true,"model_name":"base"}
```

---

## API Endpoints

| Method | Path                  | Description                        |
|--------|-----------------------|------------------------------------|
| GET    | `/` or `/health`      | Health check                       |
| POST   | `/transcribe`         | Transcribe a single audio file     |
| POST   | `/transcribe/batch`   | Transcribe multiple audio files    |

### Quick transcription example

```bash
curl -X POST "http://localhost:8003/transcribe" \
  -F "audio=@your_audio.mp3"

# With optional parameters
curl -X POST "http://localhost:8003/transcribe?language=en&include_segments=true" \
  -F "audio=@your_audio.mp3"
```

Supported audio formats: `.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`, `.webm`, `.mp4`

### Interactive API docs

Once the server is running, visit:

- **Swagger UI**: <http://localhost:8003/docs>
- **ReDoc**: <http://localhost:8003/redoc>

---

## Running Tests

```bash
cd backend/server

# Unit/integration tests
pytest test/

# Quick live API smoke test (server must be running)
python test_api.py <path-to-audio-file>
```
