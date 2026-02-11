from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from db_client import DatabaseClient
import os

app = FastAPI(title="AUSTIN-Lang Database Service")
db = DatabaseClient(db_path='poc.db', schema_path='schema.sql')

# --- Pydantic Models ---

class AudioFileBase(BaseModel):
    file_name: str

class AudioFileCreate(AudioFileBase):
    pass

class AudioFile(AudioFileBase):
    id: int
    uploaded_at: str

class RawTranscriptBase(BaseModel):
    transcript: str
    rating: Optional[int] = None
    audio_file_id: int

class RawTranscriptCreate(RawTranscriptBase):
    pass

class RawTranscript(RawTranscriptBase):
    id: int
    created_at: str

class EditedTranscriptBase(BaseModel):
    raw_transcript_id: int
    transcript: str

class EditedTranscriptCreate(EditedTranscriptBase):
    pass

class EditedTranscript(EditedTranscriptBase):
    id: int
    created_at: str

# --- Endpoints: Audio Files ---

@app.get("/audio-files/", response_model=List[AudioFile])
async def get_audio_files():
    """
    Sample Input: None
    Sample Output: [{"id": 1, "file_name": "meeting.wav", "uploaded_at": "2023-01-01 12:00:00"}]
    """
    return db.fetch_all("SELECT * FROM audio_file")

@app.post("/audio-files/", response_model=int)
async def create_audio_file(data: AudioFileCreate):
    """
    Sample Input: {"file_name": "meeting.wav"}
    Sample Output: 1
    """
    return db.execute_query("INSERT INTO audio_file (file_name) VALUES (?)", (data.file_name,))

@app.put("/audio-files/{file_id}")
async def update_audio_file(file_id: int, data: AudioFileCreate):
    """
    Sample Input: file_id=1, {"file_name": "updated.wav"}
    Sample Output: {"message": "Updated successfully"}
    """
    db.execute_query("UPDATE audio_file SET file_name = ? WHERE id = ?", (data.file_name, file_id))
    return {"message": "Updated successfully"}

# --- Endpoints: Raw Transcripts ---

@app.get("/raw-transcripts/", response_model=List[RawTranscript])
async def get_raw_transcripts():
    """
    Sample Input: None
    Sample Output: [{"id": 1, "transcript": "Hello", "rating": 5, "audio_file_id": 1, "created_at": "..."}]
    """
    return db.fetch_all("SELECT * FROM raw_transcript")

@app.post("/raw-transcripts/", response_model=int)
async def create_raw_transcript(data: RawTranscriptCreate):
    """
    Sample Input: {"transcript": "Hello world", "rating": 5, "audio_file_id": 1}
    Sample Output: 1
    """
    return db.execute_query(
        "INSERT INTO raw_transcript (transcript, rating, audio_file_id) VALUES (?, ?, ?)",
        (data.transcript, data.rating, data.audio_file_id)
    )

@app.put("/raw-transcripts/{transcript_id}")
async def update_raw_transcript(transcript_id: int, data: RawTranscriptCreate):
    """
    Sample Input: transcript_id=1, {"transcript": "Updated", "rating": 4, "audio_file_id": 1}
    Sample Output: {"message": "Updated successfully"}
    """
    db.execute_query(
        "UPDATE raw_transcript SET transcript = ?, rating = ? WHERE id = ?",
        (data.transcript, data.rating, transcript_id)
    )
    return {"message": "Updated successfully"}

# --- Endpoints: Edited Transcripts ---

@app.get("/edited-transcripts/", response_model=List[EditedTranscript])
async def get_edited_transcripts():
    """
    Sample Input: None
    Sample Output: [{"id": 1, "raw_transcript_id": 1, "transcript": "Corrected text", "created_at": "..."}]
    """
    return db.fetch_all("SELECT * FROM edited_transcript")

@app.post("/edited-transcripts/", response_model=int)
async def create_edited_transcript(data: EditedTranscriptCreate):
    """
    Sample Input: {"raw_transcript_id": 1, "transcript": "Manually corrected"}
    Sample Output: 1
    """
    return db.execute_query(
        "INSERT INTO edited_transcript (raw_transcript_id, transcript) VALUES (?, ?)",
        (data.raw_transcript_id, data.transcript)
    )

@app.put("/edited-transcripts/{transcript_id}")
async def update_edited_transcript(transcript_id: int, data: EditedTranscriptCreate):
    """
    Sample Input: transcript_id=1, {"raw_transcript_id": 1, "transcript": "Final text"}
    Sample Output: {"message": "Updated successfully"}
    """
    db.execute_query(
        "UPDATE edited_transcript SET transcript = ? WHERE id = ?",
        (data.transcript, transcript_id)
    )
    return {"message": "Updated successfully"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
