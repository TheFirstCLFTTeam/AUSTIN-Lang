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

def test_upload_mp3_success(client, temp_upload_dir):
    """Verify that an .mp3 file can be uploaded successfully."""
    file_content = b"fake mp3 content"
    file_name = "test_audio.mp3"
    
    files = {"file": (file_name, io.BytesIO(file_content), "audio/mpeg")}
    response = client.post("/upload-audio/", files=files)
    
    assert response.status_code == 200
    assert response.json()["filename"] == file_name
    assert os.path.exists(os.path.join(temp_upload_dir, file_name))

def test_upload_invalid_extension(client):
    """Verify that uploading unsupported formats results in a detailed 400 error."""
    file_content = b"some text"
    file_name = "test.txt"
    
    files = {"file": (file_name, io.BytesIO(file_content), "text/plain")}
    response = client.post("/upload-audio/", files=files)
    
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "Unsupported audio format" in detail
    assert ".wav" in detail
    assert ".mp3" in detail

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

def test_upload_directory_traversal(client, temp_upload_dir):
    """Verify that malicious filenames cannot escape the upload directory."""
    malicious_filename = "../traversal.wav"
    file_content = b"malicious"
    
    files = {"file": (malicious_filename, io.BytesIO(file_content), "audio/wav")}
    response = client.post("/upload-audio/", files=files)
    
    assert response.status_code == 200
    # The filename should be sanitized to just 'traversal.wav'
    sanitized_name = "traversal.wav"
    assert response.json()["filename"] == sanitized_name
    
    # Verify it's inside temp_upload_dir and NOT in parent
    assert os.path.exists(os.path.join(temp_upload_dir, sanitized_name))
    assert not os.path.exists(os.path.join(temp_upload_dir, "..", sanitized_name))

def test_upload_unicode_filename(client, temp_upload_dir):
    """Verify that filenames with Unicode characters are handled correctly."""
    unicode_filename = "你好_test.wav"
    file_content = b"unicode content"
    
    files = {"file": (unicode_filename, io.BytesIO(file_content), "audio/wav")}
    response = client.post("/upload-audio/", files=files)
    
    assert response.status_code == 200
    assert response.json()["filename"] == unicode_filename
    assert os.path.exists(os.path.join(temp_upload_dir, unicode_filename))

def test_upload_empty_file(client, temp_upload_dir):
    """Verify that an empty file can be uploaded (or handled as per policy)."""
    file_name = "empty.wav"
    files = {"file": (file_name, io.BytesIO(b""), "audio/wav")}
    response = client.post("/upload-audio/", files=files)
    
    assert response.status_code == 200
    file_path = os.path.join(temp_upload_dir, file_name)
    assert os.path.getsize(file_path) == 0

def test_upload_filename_with_spaces(client, temp_upload_dir):
    """Verify that filenames with spaces are handled correctly."""
    file_name = "my recording 2024.wav"
    files = {"file": (file_name, io.BytesIO(b"data"), "audio/wav")}
    response = client.post("/upload-audio/", files=files)
    
    assert response.status_code == 200
    assert response.json()["filename"] == file_name
    assert os.path.exists(os.path.join(temp_upload_dir, file_name))
