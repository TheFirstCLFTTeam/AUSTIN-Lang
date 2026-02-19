CREATE TABLE IF NOT EXISTS audio_file (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS raw_transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcript TEXT,
    rating INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    audio_file_id INTEGER,
    FOREIGN KEY (audio_file_id) REFERENCES audio_file(id)
);

CREATE TABLE IF NOT EXISTS edited_transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_transcript_id INTEGER,
    transcript TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (raw_transcript_id) REFERENCES raw_transcript(id)
);
