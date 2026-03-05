import io
import pytest
from unittest.mock import patch, MagicMock
import requests


def test_transcribe_full_success(client, monkeypatch):
    """Test the complete successful orchestration workflow."""
    monkeypatch.setenv("SKIP_TRANSCRIPTION_SERVER", "false")

    # 1. Setup mock responses
    mock_submission_resp = MagicMock()
    mock_submission_resp.status_code = 200
    mock_submission_resp.json.return_value = {
        "filename": "test.wav",
        "message": "Success",
    }

    mock_transcription_resp = MagicMock()
    mock_transcription_resp.status_code = 200
    mock_transcription_resp.json.return_value = {
        "text": "Hello world",
        "language": "en",
        "segments": [{"start": 0.0, "end": 1.0, "text": "Hello world"}],
    }

    mock_db_file_resp = MagicMock()
    mock_db_file_resp.status_code = 200
    mock_db_file_resp.json.return_value = 1

    mock_db_raw_resp = MagicMock()
    mock_db_raw_resp.status_code = 200
    mock_db_raw_resp.json.return_value = 10

    mock_db_edited_resp = MagicMock()
    mock_db_edited_resp.status_code = 200
    mock_db_edited_resp.json.return_value = 100

    with patch("transcription_orchestrator.requests.post") as mock_post:
        mock_post.side_effect = [
            mock_submission_resp,
            mock_transcription_resp,
            mock_db_file_resp,
            mock_db_raw_resp,
            mock_db_edited_resp,
        ]

        response = client.post(
            "/transcribe/",
            files={"file": ("test.wav", io.BytesIO(b"content"), "audio/wav")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["audio_file_id"] == 1
        assert data["raw_transcript_id"] == 10
        assert data["edited_transcript_id"] == 100


def test_transcribe_submission_client_error(client):
    """Test that 4xx errors from downstream services are propagated as 400."""
    mock_submission_resp = MagicMock()
    mock_submission_resp.status_code = 400
    mock_submission_resp.json.return_value = {"detail": "Unsupported format"}

    with patch("transcription_orchestrator.requests.post") as mock_post:
        mock_post.return_value = mock_submission_resp
        response = client.post(
            "/transcribe/",
            files={"file": ("test.txt", io.BytesIO(b"data"), "text/plain")},
        )
        assert response.status_code == 400
        assert "Audio submission error" in response.json()["detail"]


def test_transcribe_non_json_error(client):
    """Test that HTML error pages from downstream services don't crash the orchestrator."""
    mock_submission_resp = MagicMock()
    mock_submission_resp.status_code = 502
    mock_submission_resp.text = "<html><body>Bad Gateway</body></html>"
    # mock .json() to raise error as it would if it received HTML
    mock_submission_resp.json.side_effect = Exception("Not JSON")
    mock_submission_resp.raise_for_status.side_effect = requests.exceptions.HTTPError(
        "502 Server Error"
    )

    with patch("transcription_orchestrator.requests.post") as mock_post:
        mock_post.return_value = mock_submission_resp
        response = client.post(
            "/transcribe/",
            files={"file": ("test.wav", io.BytesIO(b"data"), "audio/wav")},
        )
        assert response.status_code == 502
        assert "Audio submission service failed" in response.json()["detail"]


def test_transcribe_missing_segments(client, monkeypatch):
    """Test robustness when the transcription server returns text but missing 'segments' key."""
    monkeypatch.setenv("SKIP_TRANSCRIPTION_SERVER", "false")

    m1 = MagicMock(status_code=200)
    m1.json.return_value = {"message": "ok"}

    # Transcription response WITHOUT 'segments' key
    m2 = MagicMock(status_code=200)
    m2.json.return_value = {"text": "Just text, no segments"}

    m3 = MagicMock(status_code=200)
    m3.json.return_value = 1
    m4 = MagicMock(status_code=200)
    m4.json.return_value = 10
    m5 = MagicMock(status_code=200)
    m5.json.return_value = 100

    with patch("transcription_orchestrator.requests.post") as mock_post:
        mock_post.side_effect = [m1, m2, m3, m4, m5]
        response = client.post(
            "/transcribe/",
            files={"file": ("test.wav", io.BytesIO(b"data"), "audio/wav")},
        )
        assert response.status_code == 200
        # Should have proceeded with segments = []
        assert response.json()["raw_transcript_id"] == 10


def test_transcribe_raw_transcript_registration_failure(client, monkeypatch):
    """Test failure specifically at the raw transcript registration step (step 3b)."""
    monkeypatch.setenv("SKIP_TRANSCRIPTION_SERVER", "false")

    m1 = MagicMock(status_code=200)
    m1.json.return_value = {"message": "ok"}
    m2 = MagicMock(status_code=200)
    m2.json.return_value = {"text": "ok", "segments": []}
    m3 = MagicMock(status_code=200)
    m3.json.return_value = 1  # audio_file_id success

    # 3b. Raw Transcript FAILURE
    m4 = MagicMock(status_code=500)
    m4.raise_for_status.side_effect = requests.exceptions.HTTPError("DB Error")

    with patch("transcription_orchestrator.requests.post") as mock_post:
        mock_post.side_effect = [m1, m2, m3, m4]
        response = client.post(
            "/transcribe/",
            files={"file": ("test.wav", io.BytesIO(b"data"), "audio/wav")},
        )
        assert response.status_code == 502
        assert "Database (raw_transcript) service failed" in response.json()["detail"]
