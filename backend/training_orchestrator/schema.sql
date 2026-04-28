-- training-orchestrator job-record store. SQLite for now; migrates to
-- Postgres alongside platform.db / users.db under Wave 4 / F16.
--
-- The state machine and shape are scoped down from the full design in
-- docs/07 Integration CAA 27APR2026/training-job-pipeline.md §4.2 — this
-- slice only carries what the orchestrator needs to record and report on
-- a job. Worker-side fields (script_sha256, metrics_snapshot_json) and
-- the base_model + training_artifact tables land in follow-up slices.
CREATE TABLE IF NOT EXISTS training_job (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    submitted_by    TEXT NOT NULL,
    submitted_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    status          TEXT NOT NULL DEFAULT 'queued',
    target          TEXT NOT NULL,            -- 'cloud' | 'local' | 'federated'
    base_model      TEXT NOT NULL,            -- e.g. 'openai/whisper-large-v3-turbo'
    dataset_ref     TEXT NOT NULL,            -- 'engineer@example.com/20260401T120000'
    data_zone       TEXT NOT NULL DEFAULT 'green',  -- 'green' | 'red'
    env_json        TEXT NOT NULL DEFAULT '{}',
    fl_enabled      INTEGER NOT NULL DEFAULT 0,
    dp_enabled      INTEGER NOT NULL DEFAULT 0,
    progress_pct    REAL,
    started_at      TEXT,
    finished_at     TEXT,
    failure_reason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_training_job_submitter
    ON training_job(submitted_by, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_job_status
    ON training_job(status, submitted_at DESC);
