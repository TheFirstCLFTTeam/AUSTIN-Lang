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
