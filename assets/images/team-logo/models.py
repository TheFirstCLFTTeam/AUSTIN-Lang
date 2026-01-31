from sqlalchemy import Column, String, Text, Integer, DateTime, func
from database import Base

class Transcript(Base):
    __tablename__ = "transcripts"

    id = Column(String, primary_key=True, index=True)  # use uuid string
    audio_id = Column(String, index=True, nullable=True)

    original_transcript = Column(Text, nullable=False)
    edited_transcript = Column(Text, nullable=True)

    rating = Column(Integer, nullable=True)
    status = Column(String, nullable=False, default="unreviewed")  # unreviewed|verified

    verified_by = Column(String, nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)
