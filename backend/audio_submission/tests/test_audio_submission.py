import io
import os
import pytest

def test_get_all_audio_empty(client):
    """Verify listing works when no files are uploaded."""
    response = client.get("/get-all-audio/")
    assert response.status_code == 200
    assert response.json() == {"audio_files": []}

def test_upload_wav_success(client, temp_upload_dir):
    """Verify that a .wav file can be uploaded successfully."""
    file_content = b"fake wav content"
    file_name = "test_audio.wav"
    
    files = {"file": (file_name, io.BytesIO(file_content), "audio/wav")}
    response = client.post("/upload-audio/", files=files)
    
    assert response.status_code == 200
    assert response.json()["filename"] == file_name
    
    # Check if the file actually exists on disk in the temp directory
    file_path = os.path.join(temp_upload_dir, file_name)
    assert os.path.exists(file_path)
    with open(file_path, "rb") as f:
        assert f.read() == file_content

def test_upload_invalid_extension(client):
    """Verify that uploading non-.wav files results in a 400 error."""
    file_content = b"some text"
    file_name = "test.txt"
    
    files = {"file": (file_name, io.BytesIO(file_content), "text/plain")}
    response = client.post("/upload-audio/", files=files)
    
    assert response.status_code == 400
    assert response.json()["detail"] == "Only .wav files are allowed"

def test_get_all_audio_after_upload(client):
    """Verify that uploaded files appear in the list."""
    # Note: temp_upload_dir is module scoped, so previous test's file should be here
    response = client.get("/get-all-audio/")
    assert response.status_code == 200
    audio_files = response.json()["audio_files"]
    assert "test_audio.wav" in audio_files

def test_upload_overwrite(client, temp_upload_dir):
    """Verify that uploading a file with the same name overwrites it."""
    file_name = "overwrite_test.wav"
    
    # First upload
    client.post("/upload-audio/", files={"file": (file_name, io.BytesIO(b"old"), "audio/wav")})
    
    # Second upload
    client.post("/upload-audio/", files={"file": (file_name, io.BytesIO(b"new"), "audio/wav")})
    
    file_path = os.path.join(temp_upload_dir, file_name)
    with open(file_path, "rb") as f:
        assert f.read() == b"new"
