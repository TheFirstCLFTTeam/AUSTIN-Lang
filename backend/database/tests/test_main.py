import pytest

def test_get_audio_files_empty(client):
    """Verify that the GET audio-files returns an empty list initially."""
    response = client.get("/audio-files/")
    assert response.status_code == 200
    assert response.json() == []

def test_create_and_get_audio_file(client):
    """Verify that we can create an audio file and then retrieve it."""
    # Create
    response = client.post("/audio-files/", json={"file_name": "api_test.wav"})
    assert response.status_code == 200
    file_id = response.json()
    assert file_id > 0

    # Get single
    response = client.get(f"/audio-files/{file_id}")
    assert response.status_code == 200
    data = response.json()
    assert data['file_name'] == "api_test.wav"
    assert data['id'] == file_id

def test_get_audio_file_not_found(client):
    """Verify that a GET for a non-existent ID returns 404."""
    response = client.get("/audio-files/99999")
    assert response.status_code == 404
    assert response.json()['detail'] == "Audio file not found"

def test_create_raw_transcript_with_segments(client):
    """Verify complex nested creation of raw transcripts."""
    # First, create an audio file to link to
    file_id = client.post("/audio-files/", json={"file_name": "transcription_host.wav"}).json()

    # Create raw transcript
    payload = {
        "audio_file_id": file_id,
        "rating": 5,
        "transcript_segments": [
            {"start": 0.0, "end": 1.5, "text": "First segment"},
            {"start": 1.5, "end": 3.0, "text": "Second segment"}
        ]
    }
    response = client.post("/raw-transcripts/", json=payload)
    assert response.status_code == 200
    transcript_id = response.json()
    assert transcript_id > 0

    # Retrieve and verify
    response = client.get("/raw-transcripts/", params={"audio_file_id": file_id})
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]['rating'] == 5
    assert len(data[0]['transcript_segments']) == 2
    assert data[0]['transcript_segments'][0]['text'] == "First segment"

def test_update_audio_file(client):
    """Verify that we can update an existing audio file's metadata."""
    file_id = client.post("/audio-files/", json={"file_name": "old.wav"}).json()
    response = client.put(f"/audio-files/{file_id}", json={"file_name": "new.wav"})
    assert response.status_code == 200
    assert response.json() == {"message": "Updated successfully"}
    
    data = client.get(f"/audio-files/{file_id}").json()
    assert data["file_name"] == "new.wav"

def test_update_raw_transcript(client):
    """Verify that we can update an existing raw transcript and its segments."""
    file_id = client.post("/audio-files/", json={"file_name": "test.wav"}).json()
    payload = {
        "audio_file_id": file_id,
        "rating": 3,
        "transcript_segments": [{"start": 0.0, "end": 1.0, "text": "Old text"}]
    }
    transcript_id = client.post("/raw-transcripts/", json=payload).json()
    
    # Update
    update_payload = {
        "audio_file_id": file_id,
        "rating": 5,
        "transcript_segments": [{"start": 0.0, "end": 1.0, "text": "New text"}]
    }
    response = client.put(f"/raw-transcripts/{transcript_id}", json=update_payload)
    assert response.status_code == 200
    
    # Verify
    data = client.get("/raw-transcripts/", params={"audio_file_id": file_id}).json()
    assert data[0]["rating"] == 5
    assert data[0]["transcript_segments"][0]["text"] == "New text"

def test_create_and_get_edited_transcript(client):
    """Verify the lifecycle of edited transcripts."""
    # Setup dependencies
    file_id = client.post("/audio-files/", json={"file_name": "test.wav"}).json()
    raw_id = client.post("/raw-transcripts/", json={
        "audio_file_id": file_id, "rating": 0, "transcript_segments": []
    }).json()
    
    # Create Edited
    payload = {
        "raw_transcript_id": raw_id,
        "transcript_segments": [{"start": 0.0, "end": 1.0, "text": "Edited"}]
    }
    response = client.post("/edited-transcripts/", json=payload)
    assert response.status_code == 200
    edited_id = response.json()
    
    # Get all
    response = client.get("/edited-transcripts/")
    assert response.status_code == 200
    assert any(et["id"] == edited_id for et in response.json())
    
    # Get filtered
    response = client.get("/edited-transcripts/", params={"raw_transcript_id": raw_id})
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["transcript_segments"][0]["text"] == "Edited"

def test_update_edited_transcript(client):
    """Verify that we can update an existing edited transcript."""
    # Setup
    file_id = client.post("/audio-files/", json={"file_name": "test.wav"}).json()
    raw_id = client.post("/raw-transcripts/", json={"audio_file_id": file_id, "rating": 0, "transcript_segments": []}).json()
    edited_id = client.post("/edited-transcripts/", json={"raw_transcript_id": raw_id, "transcript_segments": []}).json()
    
    # Update
    update_payload = {
        "raw_transcript_id": raw_id,
        "transcript_segments": [{"start": 0.5, "end": 2.5, "text": "Final version"}]
    }
    response = client.put(f"/edited-transcripts/{edited_id}", json=update_payload)
    assert response.status_code == 200
    
    # Verify
    data = client.get("/edited-transcripts/", params={"raw_transcript_id": raw_id}).json()
    assert data[0]["transcript_segments"][0]["text"] == "Final version"

# --- ROBUSTNESS TESTS ---

def test_create_audio_file_invalid_payload(client):
    """Verify that POST with malformed JSON returns 422 Unprocessable Entity."""
    # Missing required field 'file_name'
    response = client.post("/audio-files/", json={"wrong_field": "test.wav"})
    assert response.status_code == 422
    
    # Empty payload
    response = client.post("/audio-files/", json={})
    assert response.status_code == 422

def test_create_raw_transcript_invalid_audio_id(client):
    """Verify that creating a transcript for a non-existent audio file fails."""
    # audio_file_id 9999 does not exist
    payload = {
        "audio_file_id": 9999,
        "rating": 5,
        "transcript_segments": [{"start": 0.0, "end": 1.0, "text": "test"}]
    }
    response = client.post("/raw-transcripts/", json=payload)
    
    # SQLite raises an IntegrityError (foreign key), handled by global handler returning 400
    assert response.status_code == 400
    assert "Database integrity error" in response.json()["detail"]

def test_get_raw_transcripts_invalid_id_filter(client):
    """Verify that filtering by a non-existent audio_file_id returns empty list."""
    response = client.get("/raw-transcripts/", params={"audio_file_id": 8888})
    assert response.status_code == 200
    assert response.json() == []

def test_update_audio_file_not_found(client):
    """Verify that updating a non-existent audio file returns success message 
    (due to current implementation not checking row count)."""
    # Current main.py doesn't check if row was actually updated, it just returns "Updated successfully"
    response = client.put("/audio-files/7777", json={"file_name": "new.wav"})
    assert response.status_code == 200
    assert response.json() == {"message": "Updated successfully"}

def test_bulk_context(client):
    """Verify that the bulk-context endpoint returns joined data with ordered segments."""
    # Setup: Create audio file, raw transcript, and edited transcript
    file_id = client.post("/audio-files/", json={"file_name": "bulk_test.wav"}).json()
    
    raw_payload = {
        "audio_file_id": file_id,
        "rating": 4,
        "transcript_segments": [
            {"start": 1.0, "end": 2.0, "text": "World"},
            {"start": 0.0, "end": 1.0, "text": "Hello"} # Out of order
        ]
    }
    raw_id = client.post("/raw-transcripts/", json=raw_payload).json()
    
    edited_payload = {
        "raw_transcript_id": raw_id,
        "transcript_segments": [
            {"start": 1.0, "end": 2.0, "text": "Edited World"},
            {"start": 0.0, "end": 1.0, "text": "Edited Hello"} # Out of order
        ]
    }
    client.post("/edited-transcripts/", json=edited_payload)

    # Get bulk context
    response = client.get("/audio-files/bulk-context")
    assert response.status_code == 200
    data = response.json()
    
    assert len(data) >= 1
    target = next(item for item in data if item["id"] == file_id)
    
    # Verify ordering and joining
    assert target["raw_text"] == "Hello World"
    assert target["edited_text"] == "Edited Hello Edited World"
    assert "uploaded_at" in target
