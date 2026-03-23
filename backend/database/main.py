from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from db_client import DatabaseClient
import os
from starlette.middleware.cors import CORSMiddleware # Import CORSMiddleware
import sqlite3
from fastapi.responses import JSONResponse

app = FastAPI(title="AUSTIN-Lang Database Service")

@app.exception_handler(sqlite3.IntegrityError)
async def integrity_exception_handler(request, exc):
    return JSONResponse(
        status_code=400,
        content={"detail": f"Database integrity error: {str(exc)}"},
    )

# Add CORS middleware
origins = [
    "http://localhost",
    "http://localhost:3000",  # Allow requests from your React frontend
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = DatabaseClient(db_path='poc.db', schema_path='schema.sql')

# --- Pydantic Models ---

class AudioFileBase(BaseModel):
    file_name: str

class AudioFileCreate(AudioFileBase):
    pass

class AudioFile(AudioFileBase):
    id: int
    uploaded_at: str

class RawTranscriptSegment(BaseModel):
    id: Optional[int] = None # ID from the database for existing segments
    start: float
    end: float
    text: str

class RawTranscriptBase(BaseModel):
    rating: Optional[int] = None
    audio_file_id: int
    transcription_started_at: Optional[str] = None
    transcription_ended_at: Optional[str] = None
    transcript_segments: List[RawTranscriptSegment]

class RawTranscriptCreate(RawTranscriptBase):
    pass

class RawTranscript(RawTranscriptBase):
    id: int
    created_at: str

class TranscriptSegment(BaseModel):
    id: Optional[int] = None
    start: float
    end: float
    text: str

class EditedTranscriptBase(BaseModel):
    raw_transcript_id: int
    is_user_edited: Optional[int] = 0
    transcript_segments: List[TranscriptSegment]

class EditedTranscriptCreate(EditedTranscriptBase):
    pass

class EditedTranscript(EditedTranscriptBase):
    id: int
    created_at: str

class FullContext(BaseModel):
    id: int
    file_name: str
    uploaded_at: str
    transcription_started_at: Optional[str] = None
    transcription_ended_at: Optional[str] = None
    rt_created_at: Optional[str] = None
    is_user_edited: Optional[int] = 0
    raw_text: Optional[str] = None
    edited_text: Optional[str] = None


# --- Endpoints: Audio Files ---

@app.get("/audio-files/", response_model=List[AudioFile])
async def get_audio_files():
    """
    Sample Input: None
    Sample Output: [{"id": 1, "file_name": "meeting.wav", "uploaded_at": "2023-01-01 12:00:00"}]
    """
    return db.fetch_all("SELECT * FROM audio_file")

@app.get("/audio-files/bulk-context", response_model=List[FullContext])
async def get_bulk_context(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """
    Returns a list of joined objects (file info + raw/edited segments) for metrics processing.
    """
    query = """
    SELECT af.id as id, af.file_name as file_name, af.uploaded_at as uploaded_at, 
           rt.transcription_started_at as transcription_started_at, 
           rt.transcription_ended_at as transcription_ended_at, 
           rt.created_at as rt_created_at,
           et.is_user_edited as is_user_edited,
           (SELECT GROUP_CONCAT(text, ' ') FROM (SELECT text FROM raw_transcript_segment WHERE raw_transcript_id = rt.id ORDER BY start)) as raw_text,
           (SELECT GROUP_CONCAT(text, ' ') FROM (SELECT text FROM edited_transcript_segment WHERE edited_transcript_id = et.id ORDER BY start)) as edited_text
    FROM audio_file af
    LEFT JOIN raw_transcript rt ON af.id = rt.audio_file_id
    LEFT JOIN edited_transcript et ON rt.id = et.raw_transcript_id
    """
    params = []
    if start_date and end_date:
        query += " WHERE af.uploaded_at BETWEEN ? AND ?"
        params = [start_date, end_date]
    
    return db.fetch_all(query, tuple(params))

@app.get("/audio-files/{file_id}/full-context", response_model=FullContext)
async def get_full_context(file_id: int):
    """
    Returns joined object for a specific file.
    """
    query = """
    SELECT af.id as id, af.file_name as file_name, af.uploaded_at as uploaded_at, 
           rt.transcription_started_at as transcription_started_at, 
           rt.transcription_ended_at as transcription_ended_at, 
           rt.created_at as rt_created_at,
           et.is_user_edited as is_user_edited,
           (SELECT GROUP_CONCAT(text, ' ') FROM (SELECT text FROM raw_transcript_segment WHERE raw_transcript_id = rt.id ORDER BY start)) as raw_text,
           (SELECT GROUP_CONCAT(text, ' ') FROM (SELECT text FROM edited_transcript_segment WHERE edited_transcript_id = et.id ORDER BY start)) as edited_text
    FROM audio_file af
    LEFT JOIN raw_transcript rt ON af.id = rt.audio_file_id
    LEFT JOIN edited_transcript et ON rt.id = et.raw_transcript_id
    WHERE af.id = ?
    """
    result = db.fetch_one(query, (file_id,))
    if not result:
        raise HTTPException(status_code=404, detail="Audio file context not found")
    return result

@app.get("/audio-files/{file_id}", response_model=AudioFile)
async def get_audio_file(file_id: int):
    """
    Sample Input: file_id=1
    Sample Output: {"id": 1, "file_name": "meeting.wav", "uploaded_at": "2023-01-01 12:00:00"}
    """
    audio_file = db.fetch_one("SELECT id, file_name, uploaded_at FROM audio_file WHERE id = ?", (file_id,))
    if not audio_file:
        raise HTTPException(status_code=404, detail="Audio file not found")
    return audio_file

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
async def get_raw_transcripts(audio_file_id: Optional[int] = None):
    """
    Sample Input: None or audio_file_id=1
    Sample Output: [{"id": 1, "rating": 5, "audio_file_id": 1, "created_at": "...", "transcript_segments": [{"id": 1, "start": 0.0, "end": 1.5, "text": "Hello"}]}]
    """
    if audio_file_id:
        raw_transcripts_data = db.fetch_all("SELECT * FROM raw_transcript WHERE audio_file_id = ?", (audio_file_id,))
    else:
        raw_transcripts_data = db.fetch_all("SELECT * FROM raw_transcript")
    
    raw_transcripts = []
    for rt_data in raw_transcripts_data:
        segments_data = db.fetch_all(
            "SELECT id, start, end, text FROM raw_transcript_segment WHERE raw_transcript_id = ?",
            (rt_data['id'],)
        )
        segments = [RawTranscriptSegment(**segment) for segment in segments_data]
        raw_transcripts.append(
            RawTranscript(
                id=rt_data['id'],
                rating=rt_data['rating'],
                audio_file_id=rt_data['audio_file_id'],
                created_at=rt_data['created_at'],
                transcription_started_at=rt_data.get('transcription_started_at'),
                transcription_ended_at=rt_data.get('transcription_ended_at'),
                transcript_segments=segments
            )
        )
    return raw_transcripts

@app.post("/raw-transcripts/", response_model=int)
async def create_raw_transcript(data: RawTranscriptCreate):
    """
    Sample Input: {"audio_file_id": 1, "rating": 5, "transcription_started_at": "...", "transcription_ended_at": "...", "transcript_segments": [{"start": 0.0, "end": 1.5, "text": "Hello"}]}
    Sample Output: 1
    """
    # Insert the main raw_transcript record
    raw_transcript_id = db.execute_query(
        "INSERT INTO raw_transcript (rating, audio_file_id, transcription_started_at, transcription_ended_at) VALUES (?, ?, ?, ?)",
        (data.rating, data.audio_file_id, data.transcription_started_at, data.transcription_ended_at)
    )

    # Insert each segment
    for segment in data.transcript_segments:
        db.execute_query(
            "INSERT INTO raw_transcript_segment (raw_transcript_id, start, end, text) VALUES (?, ?, ?, ?)",
            (raw_transcript_id, segment.start, segment.end, segment.text)
        )
    return raw_transcript_id

@app.put("/raw-transcripts/{transcript_id}")
async def update_raw_transcript(transcript_id: int, data: RawTranscriptCreate):
    """
    Sample Input: transcript_id=1, {"rating": 4, "audio_file_id": 1, "transcript_segments": [{"start": 0.0, "end": 1.5, "text": "Updated segment"}]}
    Sample Output: {"message": "Updated successfully"}
    """
    # Update the main raw_transcript record (e.g., rating)
    db.execute_query(
        "UPDATE raw_transcript SET rating = ?, transcription_started_at = ?, transcription_ended_at = ? WHERE id = ?",
        (data.rating, data.transcription_started_at, data.transcription_ended_at, transcript_id)
    )

    # Delete existing segments for this raw_transcript
    db.execute_query("DELETE FROM raw_transcript_segment WHERE raw_transcript_id = ?", (transcript_id,))

    # Insert new segments
    for segment in data.transcript_segments:
        db.execute_query(
            "INSERT INTO raw_transcript_segment (raw_transcript_id, start, end, text) VALUES (?, ?, ?, ?)",
            (transcript_id, segment.start, segment.end, segment.text)
        )
    return {"message": "Updated successfully"}

# --- Endpoints: Edited Transcripts ---

@app.get("/edited-transcripts/", response_model=List[EditedTranscript])
async def get_edited_transcripts(raw_transcript_id: Optional[int] = None):
    """
    Sample Input: None or raw_transcript_id=1
    Sample Output: [{"id": 1, "raw_transcript_id": 1, "created_at": "...", "transcript_segments": [{"id": 1, "start": 0.0, "end": 1.5, "text": "Hello"}]}]
    """
    if raw_transcript_id:
        edited_transcripts_data = db.fetch_all("SELECT * FROM edited_transcript WHERE raw_transcript_id = ?", (raw_transcript_id,))
    else:
        edited_transcripts_data = db.fetch_all("SELECT * FROM edited_transcript")
    
    edited_transcripts = []
    for et_data in edited_transcripts_data:
        segments_data = db.fetch_all(
            "SELECT id, start, end, text FROM edited_transcript_segment WHERE edited_transcript_id = ?",
            (et_data['id'],)
        )
        segments = [TranscriptSegment(**segment) for segment in segments_data]
        edited_transcripts.append(
            EditedTranscript(
                id=et_data['id'],
                raw_transcript_id=et_data['raw_transcript_id'],
                is_user_edited=et_data['is_user_edited'],
                created_at=et_data['created_at'],
                transcript_segments=segments
            )
        )
    return edited_transcripts

@app.post("/edited-transcripts/", response_model=int)
async def create_edited_transcript(data: EditedTranscriptCreate):
    """
    Sample Input: {"raw_transcript_id": 1, "is_user_edited": 1, "transcript_segments": [{"start": 0.0, "end": 1.5, "text": "Hello"}, {"start": 2.0, "end": 3.0, "text": "World"}]}
    Sample Output: 1
    """
    # Insert the main edited_transcript record
    edited_transcript_id = db.execute_query(
        "INSERT INTO edited_transcript (raw_transcript_id, is_user_edited) VALUES (?, ?)",
        (data.raw_transcript_id, data.is_user_edited)
    )

    # Insert each segment
    for segment in data.transcript_segments:
        db.execute_query(
            "INSERT INTO edited_transcript_segment (edited_transcript_id, start, end, text) VALUES (?, ?, ?, ?)",
            (edited_transcript_id, segment.start, segment.end, segment.text)
        )
    return edited_transcript_id

@app.put("/edited-transcripts/{transcript_id}")
async def update_edited_transcript(transcript_id: int, data: EditedTranscriptCreate):
    """
    Sample Input: transcript_id=1, {"raw_transcript_id": 1, "is_user_edited": 1, "transcript_segments": [{"start": 0.0, "end": 1.5, "text": "Updated segment"}]}
    Sample Output: {"message": "Updated successfully"}
    """
    # Verify that the raw_transcript_id in the payload matches the existing one for integrity, if necessary
    # For now, we assume the raw_transcript_id in data is the correct one to associate.

    # Update main record
    db.execute_query(
        "UPDATE edited_transcript SET is_user_edited = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (data.is_user_edited, transcript_id)
    )

    # Delete existing segments for this edited_transcript
    db.execute_query("DELETE FROM edited_transcript_segment WHERE edited_transcript_id = ?", (transcript_id,))

    # Insert new segments
    for segment in data.transcript_segments:
        db.execute_query(
            "INSERT INTO edited_transcript_segment (edited_transcript_id, start, end, text) VALUES (?, ?, ?, ?)",
            (transcript_id, segment.start, segment.end, segment.text)
        )
    return {"message": "Updated successfully"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
