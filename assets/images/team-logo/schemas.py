from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class TranscriptOut(BaseModel):
    id: str
    audio_id: Optional[str] = None
    original_transcript: str
    edited_transcript: Optional[str] = None
    rating: Optional[int] = None
    status: str
    verified_by: Optional[str] = None
    verified_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class VerifyTranscriptIn(BaseModel):
    edited_transcript: str = Field(min_length=1)
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    verified_by: Optional[str] = None  # later you can derive from auth token
