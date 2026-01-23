import os
from fastapi import FastAPI, UploadFile, File, HTTPException
import shutil

app = FastAPI()

# Directory where audio files will be stored
UPLOAD_DIR = "audio_files"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/upload-audio/")
async def upload_audio(file: UploadFile = File(...)):
    """
    Upload an audio file (must be .wav).

    Usage (Python):
    ```python
    import requests

    url = "http://localhost:8000/upload-audio/"
    files = {"file": open("audio.wav", "rb")}
    response = requests.post(url, files=files)
    print(response.json())
    ```
    """
    # Check if the file is a .wav file
    if not file.filename.endswith(".wav"):
        raise HTTPException(status_code=400, detail="Only .wav files are allowed")

    # Store the file in UPLOAD_DIR
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # TODO: Make a database insert request


    return {"filename": file.filename, "message": "Audio file received successfully"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AUDIO_SUBMISSION_PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)