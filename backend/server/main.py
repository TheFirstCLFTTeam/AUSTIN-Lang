"""
AUSTIN-Lang Transcription Server
FastAPI server for receiving audio files and returning transcriptions using Whisper.
"""

import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from model_interface import TranscriptionModel, WhisperModel


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

# Initialize FastAPI app
app = FastAPI(
    title="AUSTIN-Lang Transcription API",
    description="API for transcribing audio files using OpenAI Whisper",
    version="1.0.0",
)

# CORS middleware - adjust origins for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model instance (loaded on startup)
model: Optional[TranscriptionModel] = None

# Supported audio formats
SUPPORTED_FORMATS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".webm", ".mp4"}


class TranscriptionResponse(BaseModel):
    """Response model for transcription results."""

    text: str
    language: Optional[str] = None
    duration: Optional[float] = None
    segments: Optional[list] = None


class HealthResponse(BaseModel):
    """Response model for health check."""

    status: str
    model_loaded: bool
    model_name: str


# Configuration
MODEL_NAME = os.getenv(
    "WHISPER_MODEL", "base"
)  # Options: tiny, base, small, medium, large


@app.on_event("startup")
async def load_model():
    """Load Whisper model on server startup."""
    global model
    model = WhisperModel(MODEL_NAME)


@app.get("/", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        model_loaded=model is not None,
        model_name=MODEL_NAME,
    )


@app.get("/health", response_model=HealthResponse)
async def health():
    """Alternative health check endpoint."""
    return await health_check()


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: Optional[str] = None,
    include_segments: bool = False,
):
    """
    Transcribe an uploaded audio file.

    Args:
        audio: Audio file to transcribe (mp3, wav, m4a, flac, ogg, webm, mp4)
        language: Optional language code (e.g., 'en', 'es', 'zh'). Auto-detected if not provided.
        include_segments: Whether to include detailed segment information in response.

    Returns:
        TranscriptionResponse with the transcribed text and metadata.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    # Validate file extension
    file_ext = Path(audio.filename).suffix.lower() if audio.filename else ""
    if file_ext not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format: {file_ext}. Supported formats: {', '.join(SUPPORTED_FORMATS)}",
        )

    # Save uploaded file to temporary location
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp_file:
            content = await audio.read()
            tmp_file.write(content)
            tmp_path = tmp_file.name
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to save uploaded file: {str(e)}"
        )

    try:
        # Transcribe the audio
        options = {}
        if language:
            options["language"] = language

        result = model.transcribe(tmp_path, **options)

        # Build response
        response = TranscriptionResponse(
            text=result["text"].strip(),
            language=result.get("language"),
        )

        # Include segments if requested
        if include_segments and "segments" in result:
            response.segments = [
                {
                    "start": seg["start"],
                    "end": seg["end"],
                    "text": seg["text"].strip(),
                }
                for seg in result["segments"]
            ]
            # Calculate total duration from segments
            if result["segments"]:
                response.duration = result["segments"][-1]["end"]

        return response

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

    finally:
        # Clean up temporary file
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


@app.post("/transcribe/batch")
async def transcribe_batch(
    audio_files: list[UploadFile] = File(...),
    language: Optional[str] = None,
):
    """
    Transcribe multiple audio files in a single request.

    Args:
        audio_files: List of audio files to transcribe
        language: Optional language code for all files

    Returns:
        List of transcription results
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    results = []
    for audio in audio_files:
        try:
            result = await transcribe_audio(audio, language, include_segments=False)
            results.append(
                {
                    "filename": audio.filename,
                    "success": True,
                    "text": result.text,
                    "language": result.language,
                }
            )
        except HTTPException as e:
            results.append(
                {
                    "filename": audio.filename,
                    "success": False,
                    "error": e.detail,
                }
            )

    return JSONResponse(content={"results": results})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # Enable hot reload during development
    )
