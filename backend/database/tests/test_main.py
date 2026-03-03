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
