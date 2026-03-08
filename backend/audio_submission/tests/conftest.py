import pytest
import os
import shutil
import tempfile
from fastapi.testclient import TestClient
import audio_submission

@pytest.fixture(scope="function")
def temp_upload_dir():
    # Create a temporary directory for uploads
    temp_dir = tempfile.mkdtemp()
    
    # Store the original UPLOAD_DIR to restore it later
    original_upload_dir = audio_submission.UPLOAD_DIR
    
    # Patch the UPLOAD_DIR in the module
    audio_submission.UPLOAD_DIR = temp_dir
    os.makedirs(temp_dir, exist_ok=True)
    
    yield temp_dir
    
    # Restore original UPLOAD_DIR and cleanup
    audio_submission.UPLOAD_DIR = original_upload_dir
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)

@pytest.fixture(scope="function")
def client(temp_upload_dir):
    with TestClient(audio_submission.app) as c:
        yield c
