CREATE TABLE IF NOT EXISTS audio_file (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS raw_transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rating INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    transcription_started_at DATETIME,
    transcription_ended_at DATETIME,
    audio_file_id INTEGER,
    FOREIGN KEY (audio_file_id) REFERENCES audio_file(id)
);

CREATE TABLE IF NOT EXISTS raw_transcript_segment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_transcript_id INTEGER,
    start REAL,
    end REAL,
    text TEXT,
    FOREIGN KEY (raw_transcript_id) REFERENCES raw_transcript(id)
);

CREATE TABLE IF NOT EXISTS edited_transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_transcript_id INTEGER,
    is_user_edited INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (raw_transcript_id) REFERENCES raw_transcript(id)
);

CREATE TABLE IF NOT EXISTS edited_transcript_segment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    edited_transcript_id INTEGER,
    start REAL,
    end REAL,
    text TEXT,
    FOREIGN KEY (edited_transcript_id) REFERENCES edited_transcript(id)
);