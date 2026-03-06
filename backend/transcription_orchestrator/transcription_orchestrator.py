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


def handle_response(response, service_name: str):
    """Checks for errors and raises appropriate HTTPExceptions."""
    if 400 <= response.status_code < 500:
        # Propagate client errors with the same message
        try:
            detail = response.json().get("detail", response.text)
        except Exception:
            detail = response.text
        raise HTTPException(status_code=400, detail=f"{service_name} error: {detail}")

    try:
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=502, detail=f"{service_name} service failed: {str(e)}"
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
        handle_response(submission_response, "Audio submission")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502, detail=f"Audio submission connection failed: {str(e)}"
        )

    # 2. Call transcription server
    skip_transcription = (
        os.getenv("SKIP_TRANSCRIPTION_SERVER", "false").lower() == "true"
    )

    if skip_transcription:
        whisper_data = {
            "text": "This is dummy transcription text because the server is skipped.",
            "language": "en",
            "segments": [
                {
                    "start": 0.0,
                    "end": 5.0,
                    "text": "Please change SKIP_TRANSCRIPTION_SERVER=false in /backend/.env ONLY when the transcription server is running",
                },
                {"start": 5.0, "end": 10.0, "text": "Dummy segment 2"},
            ],
        }
    else:
        transcription_service_host = os.getenv("TRANSCRIPTION_SERVICE_2_HOST", "transcription-service-2")
        transcription_service_port = os.getenv("TRANSCRIPTION_SERVICE_2_PORT", 8005)
        transcription_url = f"http://{transcription_service_host}:{transcription_service_port}/transcribe"
        
        # New service uses 'audio' field and returns 'chunks'
        transcription_files = {"audio": (file.filename, file_content, file.content_type)}
        
        try:
            transcription_response = requests.post(transcription_url, files=transcription_files)
            handle_response(transcription_response, "Transcription service 2")
            whisper_data = transcription_response.json()
            # Map 'chunks' to 'segments' for compatibility with database registration
            if "chunks" in whisper_data:
                whisper_data["segments"] = whisper_data["chunks"]
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Transcription service connection failed: {str(e)}",
            )

    # 3. Database Registration
    db_host = os.getenv("DATABASE_HOST", "database")
    db_port = os.getenv("DATABASE_PORT", 8002)
    db_base_url = f"http://{db_host}:{db_port}"

    # Use segments from whisper_data
    segments = whisper_data.get("segments", [])

    try:
        # 3a. Register Audio File
        db_file_response = requests.post(
            f"{db_base_url}/audio-files/", json={"file_name": file.filename}
        )
        handle_response(db_file_response, "Database (audio_file)")
        try:
            audio_file_id = db_file_response.json()
        except Exception:
            raise HTTPException(
                status_code=502, detail="Database (audio_file) returned invalid JSON"
            )

        # 3b. Create Raw Transcript
        raw_transcript_payload = {
            "audio_file_id": audio_file_id,
            "rating": 0,
            "transcript_segments": segments,
        }
        db_raw_response = requests.post(
            f"{db_base_url}/raw-transcripts/", json=raw_transcript_payload
        )
        handle_response(db_raw_response, "Database (raw_transcript)")
        try:
            raw_transcript_id = db_raw_response.json()
        except Exception:
            raise HTTPException(
                status_code=502,
                detail="Database (raw_transcript) returned invalid JSON",
            )

        # 3c. Create Initial Edited Transcript (copy of raw)
        edited_transcript_payload = {
            "raw_transcript_id": raw_transcript_id,
            "transcript_segments": segments,
        }
        db_edited_response = requests.post(
            f"{db_base_url}/edited-transcripts/", json=edited_transcript_payload
        )
        handle_response(db_edited_response, "Database (edited_transcript)")
        try:
            edited_transcript_id = db_edited_response.json()
        except Exception:
            raise HTTPException(
                status_code=502,
                detail="Database (edited_transcript) returned invalid JSON",
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502, detail=f"Database registration connection failed: {str(e)}"
        )

    return {
        "audio_file_id": audio_file_id,
        "raw_transcript_id": raw_transcript_id,
        "edited_transcript_id": edited_transcript_id,
        "filename": file.filename,
        "transcription": whisper_data,
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("TRANSCRIPTION_ORCHESTRATOR_PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
