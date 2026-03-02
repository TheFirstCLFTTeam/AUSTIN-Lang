from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import requests

app = FastAPI()

origins = [
    "http://localhost:3000",
    "http://localhost:8080",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/transcribe/")
async def transcribe(file: UploadFile = File(...)):
    """
    Orchestrates the full transcription workflow:
    1. Uploads the file to the audio submission service.
    2. Transcribes the file using the transcription server.
    3. Registers the audio file, raw transcript, and initial edited transcript in the database.
    """
    file_content = await file.read()
    
    # 1. Call audio submission api
    audio_submission_port = os.getenv("AUDIO_SUBMISSION_PORT", 8000)
    submission_url = f"http://audio_submission:{audio_submission_port}/upload-audio/"
    files = {"file": (file.filename, file_content, file.content_type)}
    
    try:
        submission_response = requests.post(submission_url, files=files)
        submission_response.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Audio submission failed: {str(e)}")

    # 2. Call transcription server
    transcription_server_host = os.getenv("TRANSCRIPTION_SERVER_HOST", "transcription-server")
    transcription_server_port = os.getenv("SERVER_PORT", 8003)
    transcription_url = f"http://{transcription_server_host}:{transcription_server_port}/transcribe"
    
    # We need segments for the database
    params = {"include_segments": "true"}
    transcription_files = {"audio": (file.filename, file_content, file.content_type)}
    
    try:
        transcription_response = requests.post(transcription_url, params=params, files=transcription_files)
        transcription_response.raise_for_status()
        whisper_data = transcription_response.json()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Transcription service failed: {str(e)}")

    # 3. Database Registration
    db_host = os.getenv("DATABASE_HOST", "database")
    db_port = os.getenv("DATABASE_PORT", 8002)
    db_base_url = f"http://{db_host}:{db_port}"

    # Default dummy segments if whisper returns none
    segments = whisper_data.get("segments")
    # segments = [ {"start": 0.0, "end": 5.0, "text": "Dummy segment 1"}, {"start": 5.0, "end": 10.0, "text": "Dummy segment 2"} ] # dummy_segments

    try:
        # 3a. Register Audio File
        db_file_response = requests.post(f"{db_base_url}/audio-files/", json={"file_name": file.filename})
        db_file_response.raise_for_status()
        audio_file_id = db_file_response.json()

        # 3b. Create Raw Transcript
        raw_transcript_payload = {
            "audio_file_id": audio_file_id,
            "rating": 0,
            "transcript_segments": segments
        }
        db_raw_response = requests.post(f"{db_base_url}/raw-transcripts/", json=raw_transcript_payload)
        db_raw_response.raise_for_status()
        raw_transcript_id = db_raw_response.json()

        # 3c. Create Initial Edited Transcript (copy of raw)
        edited_transcript_payload = {
            "raw_transcript_id": raw_transcript_id,
            "transcript_segments": segments
        }
        db_edited_response = requests.post(f"{db_base_url}/edited-transcripts/", json=edited_transcript_payload)
        db_edited_response.raise_for_status()
        edited_transcript_id = db_edited_response.json()

    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Database registration failed: {str(e)}")

    return {
        "audio_file_id": audio_file_id,
        "raw_transcript_id": raw_transcript_id,
        "edited_transcript_id": edited_transcript_id,
        "filename": file.filename,
        "transcription": whisper_data
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("TRANSCRIPTION_ORCHESTRATOR_PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)