import io
import pytest
from unittest.mock import patch, MagicMock

def test_transcribe_full_success(client):
    """Test the complete successful orchestration workflow."""
    
    # 1. Setup mock responses
    mock_submission_resp = MagicMock()
    mock_submission_resp.status_code = 200
    mock_submission_resp.json.return_value = {"filename": "test.wav", "message": "Success"}
    
    mock_transcription_resp = MagicMock()
    mock_transcription_resp.status_code = 200
    mock_transcription_resp.json.return_value = {
        "text": "Hello world",
        "language": "en",
        "segments": [{"start": 0.0, "end": 1.0, "text": "Hello world"}]
    }
    
    mock_db_file_resp = MagicMock()
    mock_db_file_resp.status_code = 200
    mock_db_file_resp.json.return_value = 1  # audio_file_id
    
    mock_db_raw_resp = MagicMock()
    mock_db_raw_resp.status_code = 200
    mock_db_raw_resp.json.return_value = 10 # raw_transcript_id
    
    mock_db_edited_resp = MagicMock()
    mock_db_edited_resp.status_code = 200
    mock_db_edited_resp.json.return_value = 100 # edited_transcript_id

    # 2. Patch requests.post to return different mocks sequentially
    with patch("transcription_orchestrator.requests.post") as mock_post:
        mock_post.side_effect = [
            mock_submission_resp,
            mock_transcription_resp,
            mock_db_file_resp,
            mock_db_raw_resp,
            mock_db_edited_resp
        ]
        
        # 3. Call the orchestrator
        file_content = b"fake audio content"
        files = {"file": ("test.wav", io.BytesIO(file_content), "audio/wav")}
        response = client.post("/transcribe/", files=files)
        
        # 4. Assert results
        assert response.status_code == 200
        data = response.json()
        assert data["audio_file_id"] == 1
        assert data["raw_transcript_id"] == 10
        assert data["edited_transcript_id"] == 100
        assert data["transcription"]["text"] == "Hello world"
        
        # Check if all calls were made correctly
        assert mock_post.call_count == 5

import requests

def test_transcribe_submission_failure(client):
    """Test workflow interruption when the first step (audio submission) fails."""
    
    mock_submission_resp = MagicMock()
    mock_submission_resp.status_code = 502
    mock_submission_resp.raise_for_status.side_effect = requests.exceptions.HTTPError("Service Down")
    
    with patch("transcription_orchestrator.requests.post") as mock_post:
        mock_post.return_value = mock_submission_resp
        
        files = {"file": ("test.wav", io.BytesIO(b"data"), "audio/wav")}
        response = client.post("/transcribe/", files=files)
        
        assert response.status_code == 502
        assert "Audio submission failed" in response.json()["detail"]
        assert mock_post.call_count == 1 # Stopped after first failure

def test_transcribe_database_registration_failure(client):
    """Test workflow failure during the final database registration step."""
    
    # Audio Submission Success
    m1 = MagicMock(status_code=200)
    m1.json.return_value = {"message": "ok"}
    
    # Transcription Success
    m2 = MagicMock(status_code=200)
    m2.json.return_value = {"text": "ok", "segments": []}
    
    # Database File Registration FAILURE
    m3 = MagicMock(status_code=500)
    m3.raise_for_status.side_effect = requests.exceptions.HTTPError("DB Error")
    
    with patch("transcription_orchestrator.requests.post") as mock_post:
        mock_post.side_effect = [m1, m2, m3]
        
        files = {"file": ("test.wav", io.BytesIO(b"data"), "audio/wav")}
        response = client.post("/transcribe/", files=files)
        
        assert response.status_code == 502
        assert "Database registration failed" in response.json()["detail"]
        assert mock_post.call_count == 3
