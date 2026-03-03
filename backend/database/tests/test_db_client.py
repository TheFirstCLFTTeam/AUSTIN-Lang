import pytest
import os

def test_database_initialization(db_client, test_db_path):
    """Verify that the database file is created and the schema is applied."""
    assert os.path.exists(test_db_path)
    # Check if a table exists
    tables = db_client.fetch_all("SELECT name FROM sqlite_master WHERE type='table';")
    table_names = [table['name'] for table in tables]
    assert 'audio_file' in table_names
    assert 'raw_transcript' in table_names

def test_execute_query_and_fetch_one(db_client):
    """Verify that we can insert and retrieve a row."""
    file_id = db_client.execute_query(
        "INSERT INTO audio_file (file_name) VALUES (?)", 
        ("test_audio.wav",)
    )
    assert file_id is not None
    assert file_id > 0

    row = db_client.fetch_one("SELECT * FROM audio_file WHERE id = ?", (file_id,))
    assert row is not None
    assert row['file_name'] == "test_audio.wav"

def test_fetch_all(db_client):
    """Verify that we can retrieve multiple rows."""
    db_client.execute_query("INSERT INTO audio_file (file_name) VALUES (?)", ("audio1.wav",))
    db_client.execute_query("INSERT INTO audio_file (file_name) VALUES (?)", ("audio2.wav",))
    
    rows = db_client.fetch_all("SELECT * FROM audio_file")
    assert len(rows) >= 2
    filenames = [row['file_name'] for row in rows]
    assert "audio1.wav" in filenames
    assert "audio2.wav" in filenames

def test_update_query(db_client):
    """Verify that we can update an existing row."""
    file_id = db_client.execute_query("INSERT INTO audio_file (file_name) VALUES (?)", ("old_name.wav",))
    db_client.execute_query("UPDATE audio_file SET file_name = ? WHERE id = ?", ("new_name.wav", file_id))
    
    row = db_client.fetch_one("SELECT * FROM audio_file WHERE id = ?", (file_id,))
    assert row['file_name'] == "new_name.wav"

def test_fetch_one_not_found(db_client):
    """Verify that fetch_one returns None for non-existent IDs."""
    row = db_client.fetch_one("SELECT * FROM audio_file WHERE id = ?", (9999,))
    assert row is None
