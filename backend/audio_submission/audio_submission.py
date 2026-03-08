import os
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import shutil

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directory where audio files will be stored
UPLOAD_DIR = "audio_files"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount the audio files directory to serve static files
app.mount("/audio_files", StaticFiles(directory=UPLOAD_DIR), name="audio_files")

@app.get("/get-all-audio/")
async def get_all_audio():
    """
    List all uploaded audio files.
    """
    files = os.listdir(UPLOAD_DIR)
    # Filter for .wav files just in case
    audio_files = [f for f in files if f.endswith(".wav")]
    return {"audio_files": audio_files}

# Supported audio formats
SUPPORTED_FORMATS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".webm", ".mp4"}

@app.post("/upload-audio/")
async def upload_audio(file: UploadFile = File(...)):
    """
    Upload an audio file (mp3, wav, m4a, flac, ogg, webm, mp4).

    Usage (Python):
    ```python
    import requests

    url = "http://localhost:8000/upload-audio/"
    files = {"file": open("audio.wav", "rb")}
    response = requests.post(url, files=files)
    print(response.json())
    ```
    """
    # Sanitize filename to prevent directory traversal
    filename = os.path.basename(file.filename)
    
    # Validate file extension
    file_ext = os.path.splitext(filename)[1].lower()
    if file_ext not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=400, 
            detail=f"Unsupported audio format: {file_ext}. Supported formats: {', '.join(SUPPORTED_FORMATS)}"
        )

    # Store the file in UPLOAD_DIR
    file_path = os.path.join(UPLOAD_DIR, filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"filename": filename, "message": "Audio file received successfully"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AUDIO_SUBMISSION_PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)