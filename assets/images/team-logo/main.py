from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from database import Base, engine, SessionLocal
from models import Transcript
from schemas import TranscriptOut, VerifyTranscriptIn

Base.metadata.create_all(bind=engine)

app = FastAPI()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/transcripts/{transcript_id}", response_model=TranscriptOut)
def get_transcript(transcript_id: str, db: Session = Depends(get_db)):
    t = db.query(Transcript).filter(Transcript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return t

@app.post("/transcripts/{transcript_id}/verify", response_model=TranscriptOut)
def verify_transcript(transcript_id: str, payload: VerifyTranscriptIn, db: Session = Depends(get_db)):
    t = db.query(Transcript).filter(Transcript.id == transcript_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transcript not found")

    t.edited_transcript = payload.edited_transcript.strip()
    t.rating = payload.rating
    t.status = "verified"
    t.verified_by = payload.verified_by or "unknown"
    t.verified_at = datetime.now(timezone.utc)

    db.add(t)
    db.commit()
    db.refresh(t)
    return t
