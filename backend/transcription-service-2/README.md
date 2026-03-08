# Transcription Service 2 (LoRA-Enabled)

This module supports **Hot-Swappable Domain Adapters** using PEFT/LoRA.

## Key Features
- **Base Model**: Uses `openai/whisper-large-v3-turbo` for general English/Multi-lingual tasks.
- **Hot-Swapping**: Dynamically load domain-specific adapters (e.g., Singlish, Finance, Medical) without restarting the server.
- **Version Compatibility**: Includes built-in configuration cleaning to allow adapters trained on newer PEFT versions to work on older inference environments.

## Architecture
On startup, the service loads the base Whisper model. When a request is made with a specific `domain` parameter, the service:
1. Checks if the adapter exists in `/app/adapters/`.
2. Cleans the `adapter_config.json` to ensure cross-version compatibility.
3. Injects the LoRA weights into the model.
4. Switches the active model weights for that specific request.

## Setup & Usage

### 1. Requirements
- Docker and Docker Compose.

### 2. Deployment
```
cd backend
docker compose build transcription-service-2
docker compose up -d transcription-service-2
```

### 3. API Endpoints

#### `GET /health`
Returns the status of the model, the device being used (CPU/CUDA), and a list of currently loaded domain adapters.

#### `POST /transcribe`
Transcribes an audio file.
- **Parameters**:
    - `audio`: File (UploadFile)
    - `language`: (Optional) string, e.g., "en" or "zh"
    - `domain`: (Optional) string, the folder name of the adapter in the adapters directory (e.g., `meralion_v1`).
- **Response**:
    - `text`: Full transcript.
    - `chunks`: List of segments with timestamps.

## Testing with Adapters
To test if your retrained model is working, use the following `curl` command (Windows CMD):

```cmd
curl -X POST "http://localhost:8005/transcribe?domain=meralion_v1" -F "audio=@path/to/your/audio.wav"
```

## Adding New Adapters
1. Run the retraining pipeline in `backend/retraining-pipeline`.
2. The pipeline will save adapters into `backend/retraining-pipeline/adapters/<your_domain_name>`.
3. Because this folder is volume-mounted in `compose.yaml`, the transcription service will see the new adapter immediately.
4. Simply call `/transcribe?domain=<your_domain_name>` to use it.

## Developer Notes
- **Port**: Defaults to `8005` (mapped from internal `8005`).
- **Cache**: Models are cached in the `hf_models_cache` volume to prevent re-downloading on every restart.
