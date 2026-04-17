import pytest
from fastapi.testclient import TestClient
from main import app, db
import os

@pytest.fixture
def client():
    # Ensure we use the poc.db for testing (already initialized in previous step)
    return TestClient(app)

def test_get_bulk_context_empty(client):
    """Test bulk context with no data"""
    response = client.get("/audio-files/bulk-context")
    assert response.status_code == 200
    assert response.json() == []

def test_get_bulk_context_with_data(client):
    """Test bulk context with inserted data"""
    # 1. Create Audio File
    audio_id = db.execute_query("INSERT INTO audio_file (file_name) VALUES (?)", ("test.wav",))
    
    # 2. Create Raw Transcript
    rt_id = db.execute_query(
        "INSERT INTO raw_transcript (audio_file_id, transcription_started_at, transcription_ended_at) VALUES (?, ?, ?)",
        (audio_id, "2026-03-22 10:00:00", "2026-03-22 10:00:05")
    )
    db.execute_query(
        "INSERT INTO raw_transcript_segment (raw_transcript_id, start, end, text) VALUES (?, ?, ?, ?)",
        (rt_id, 0.0, 2.0, "hello world")
    )
    
    # 3. Create Edited Transcript
    et_id = db.execute_query(
        "INSERT INTO edited_transcript (raw_transcript_id, is_user_edited) VALUES (?, ?)",
        (rt_id, 1)
    )
    db.execute_query(
        "INSERT INTO edited_transcript_segment (edited_transcript_id, start, end, text) VALUES (?, ?, ?, ?)",
        (et_id, 0.0, 2.0, "hello worlds")
    )
    
    # 4. Fetch Bulk Context
    response = client.get("/audio-files/bulk-context")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["file_name"] == "test.wav"
    assert data[0]["is_user_edited"] == 1
    assert data[0]["raw_text"] == "hello world"
    assert data[0]["edited_text"] == "hello worlds"
