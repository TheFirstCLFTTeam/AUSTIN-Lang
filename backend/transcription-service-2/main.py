import os
import tempfile
from pathlib import Path
from typing import Optional, List, Dict, Any

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import pipeline, AutoModelForSpeechSeq2Seq, AutoProcessor

# ---------------------------------------------------------------------------
# FastAPI app setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="AUSTIN-Lang Transcription Service 2",
    description="Transcription service using Hugging Face's whisper-large-v3-turbo",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Model Initialization
# ---------------------------------------------------------------------------

MODEL_ID = "openai/whisper-large-v3-turbo"
device = "cuda:0" if torch.cuda.is_available() else "cpu"
torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32

print(f"Loading model {MODEL_ID} on {device}...")

# Load model and processor
model = AutoModelForSpeechSeq2Seq.from_pretrained(
    MODEL_ID, 
    torch_dtype=torch_dtype, 
    low_cpu_mem_usage=True, 
    use_safetensors=True
)
model.to(device)

processor = AutoProcessor.from_pretrained(MODEL_ID)

# Create the pipeline
pipe = pipeline(
    "automatic-speech-recognition",
    model=model,
    tokenizer=processor.tokenizer,
    feature_extractor=processor.feature_extractor,
    max_new_tokens=128,
    chunk_length_s=30,
    batch_size=16,
    return_timestamps=True,
    torch_dtype=torch_dtype,
    device=device,
)

print(f"Model {MODEL_ID} loaded successfully!")

# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------

class Segment(BaseModel):
    start: float
    end: float
    text: str

class TranscriptionResponse(BaseModel):
    text: str
    chunks: List[Segment]
    language: Optional[str] = None

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "healthy", "model": MODEL_ID, "device": device}

@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: Optional[str] = None
):
    """
    Transcribe an uploaded audio file using whisper-large-v3-turbo.
    """
    # Validate file extension
    file_ext = Path(audio.filename).suffix.lower() if audio.filename else ""
    supported_formats = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".webm", ".mp4"}
    
    if file_ext not in supported_formats:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {file_ext}. Use: {', '.join(supported_formats)}"
        )

    # Save to temporary file
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp_file:
            content = await audio.read()
            tmp_file.write(content)
            tmp_path = tmp_file.name
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File save error: {str(e)}")

    try:
        # Run inference
        generate_kwargs = {}
        if language:
            generate_kwargs["language"] = language

        # HF Whisper pipeline handles the audio loading internally via ffmpeg/librosa
        result = pipe(tmp_path, generate_kwargs=generate_kwargs)

        # Build response
        response = TranscriptionResponse(
            text=result["text"],
            chunks=[
                Segment(
                    start=chunk["timestamp"][0],
                    end=chunk["timestamp"][1],
                    text=chunk["text"]
                ) for chunk in result.get("chunks", [])
            ]
        )
        
        return response

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

    finally:
        # Cleanup
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("TRANSCRIPTION_PORT", 8004))
    uvicorn.run(app, host="0.0.0.0", port=port)
