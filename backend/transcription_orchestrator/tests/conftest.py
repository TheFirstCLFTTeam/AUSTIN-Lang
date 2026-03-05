import pytest
from fastapi.testclient import TestClient
import transcription_orchestrator


@pytest.fixture(scope="module")
def client():
    with TestClient(transcription_orchestrator.app) as c:
        yield c
