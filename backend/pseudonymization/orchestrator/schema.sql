-- Pseudonymisation tables. Matches §7 of the implementation plan, adapted
-- to SQLite to fit the existing backend/database/schema.sql conventions
-- (TEXT for uuids, BLOB for ciphertext, ISO-8601 strings for timestamps).
--
-- original_text is BLOB so callers can store ciphertext at rest. Decryption
-- key access is gated at the API layer (reviewer + admin only).

CREATE TABLE IF NOT EXISTS pseudonymisation_runs (
    id                  TEXT PRIMARY KEY,
    transcript_id       TEXT NOT NULL,
    model_version       TEXT NOT NULL,
    label_set_version   TEXT NOT NULL,
    started_at          TEXT NOT NULL,
    completed_at        TEXT,
    status              TEXT NOT NULL,             -- queued | running | done | failed
    actor_id            TEXT NOT NULL,             -- 'system' for model-driven
    attempts            INTEGER NOT NULL DEFAULT 1,
    error_code          TEXT,
    error_message       TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_transcript
    ON pseudonymisation_runs(transcript_id, started_at DESC);

CREATE TABLE IF NOT EXISTS pseudonymisation_spans (
    id                    TEXT PRIMARY KEY,
    run_id                TEXT NOT NULL,
    segment_id            TEXT NOT NULL,
    start_char            INTEGER NOT NULL,
    end_char              INTEGER NOT NULL,
    original_text         BLOB NOT NULL,            -- encrypted at rest
    entity_type           TEXT NOT NULL,
    placeholder           TEXT NOT NULL,
    confidence            REAL NOT NULL,
    source                TEXT NOT NULL,            -- 'model' | 'manual'
    decision              TEXT,                     -- NULL | accepted | rejected
    reviewer_id           TEXT,
    reviewer_decided_at   TEXT,
    reviewer_note         TEXT,
    FOREIGN KEY (run_id) REFERENCES pseudonymisation_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_spans_run ON pseudonymisation_spans(run_id);
