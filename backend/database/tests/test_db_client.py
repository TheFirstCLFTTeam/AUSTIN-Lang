import pytest
import os
import sqlite3

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
    assert len(rows) == 2 # Scope="function" ensures clean db
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

# --- ROBUSTNESS TESTS ---

def test_sql_injection_protection(db_client):
    """Verify that parameterized queries protect against basic SQL injection."""
    malicious_name = "test'); DROP TABLE audio_file; --"
    file_id = db_client.execute_query(
        "INSERT INTO audio_file (file_name) VALUES (?)", 
        (malicious_name,)
    )
    
    # The table should still exist and the name should be stored as-is
    row = db_client.fetch_one("SELECT * FROM audio_file WHERE id = ?", (file_id,))
    assert row['file_name'] == malicious_name
    
    # Verify table wasn't dropped
    tables = db_client.fetch_all("SELECT name FROM sqlite_master WHERE type='table';")
    assert any(t['name'] == 'audio_file' for t in tables)

def test_integrity_constraint_violation(db_client):
    """Verify that inserting NULL into a NOT NULL column raises an error."""
    with pytest.raises(sqlite3.IntegrityError):
        # file_name is NOT NULL in schema.sql
        db_client.execute_query("INSERT INTO audio_file (file_name) VALUES (NULL)")

def test_very_long_input(db_client):
    """Verify that the database handles very long text inputs."""
    long_text = "A" * 100000 # 100KB string
    file_id = db_client.execute_query(
        "INSERT INTO audio_file (file_name) VALUES (?)", 
        (long_text,)
    )
    row = db_client.fetch_one("SELECT * FROM audio_file WHERE id = ?", (file_id,))
    assert row['file_name'] == long_text
