import pytest
import os
import tempfile
from fastapi.testclient import TestClient
from db_client import DatabaseClient
import main

@pytest.fixture(scope="function")
def test_db_path():
    # Create a temporary file path for the test database
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    # Delete it immediately so DatabaseClient sees it as "not existing" and triggers initialization
    os.remove(path)
    yield path
    # Cleanup after tests
    if os.path.exists(path):
        os.remove(path)

@pytest.fixture(scope="function")
def db_client(test_db_path):
    # Ensure schema.sql is reachable from the database directory
    schema_path = os.path.join(os.path.dirname(__file__), '..', 'schema.sql')
    client = DatabaseClient(db_path=test_db_path, schema_path=schema_path)
    return client

@pytest.fixture(scope="function")
def client(test_db_path):
    # Patch main.db to use the test database
    schema_path = os.path.join(os.path.dirname(__file__), '..', 'schema.sql')
    main.db = DatabaseClient(test_db_path, schema_path)
    with TestClient(main.app) as c:
        yield c
