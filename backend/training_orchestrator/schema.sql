-- training-orchestrator job-record store. SQLite for now; migrates to
-- Postgres alongside platform.db / users.db under Wave 4 / F16.
--
-- The state machine and shape are scoped down from the full design in
-- docs/07 Integration CAA 27APR2026/training-job-pipeline.md §4.2 — this
-- slice carries what the orchestrator needs to record and report on a
-- job, plus the four `script_*` columns used by `POST /jobs/{id}/script`
-- (training-job-pipeline.md §4.1). The base_model + training_artifact
-- tables land in a follow-up slice.
CREATE TABLE IF NOT EXISTS training_job (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    submitted_by        TEXT NOT NULL,
    submitted_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    status              TEXT NOT NULL DEFAULT 'queued',
    target              TEXT NOT NULL,            -- 'cloud' | 'local' | 'federated'
    base_model          TEXT NOT NULL,            -- e.g. 'openai/whisper-large-v3-turbo'
    dataset_ref         TEXT NOT NULL,            -- 'engineer@example.com/20260401T120000'
    data_zone           TEXT NOT NULL DEFAULT 'green',  -- 'green' | 'red'
    env_json            TEXT NOT NULL DEFAULT '{}',
    fl_enabled          INTEGER NOT NULL DEFAULT 0,
    dp_enabled          INTEGER NOT NULL DEFAULT 0,
    progress_pct        REAL,
    started_at          TEXT,
    finished_at         TEXT,
    failure_reason      TEXT,
    script_filename     TEXT,
    script_sha256       TEXT,
    script_size_bytes   INTEGER,
    script_uploaded_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_training_job_submitter
    ON training_job(submitted_by, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_job_status
    ON training_job(status, submitted_at DESC);

-- Idempotent retro-fit: SQLite's `CREATE TABLE IF NOT EXISTS` skips the
-- new columns above on a pre-existing DB. The application layer runs the
-- ALTERs separately (see storage.py::_init_schema) — kept here as a
-- doc-only reminder of the additions.

-- Base-model registry. Pre-seeded with vendor entries (whisper / meralion
-- / qwen3-asr) on first boot. Engineer-derived entries land here when an
-- artifact's architecture fingerprint diverges from its parent — see
-- training-job-pipeline.md §4.3 ("Promotion rule" matrix). `owner_user_id`
-- NULL signals a vendor entry; populated entries are user-derived bases.
CREATE TABLE IF NOT EXISTS base_model (
    id                       TEXT PRIMARY KEY,
    family                   TEXT NOT NULL,            -- 'whisper' | 'meralion' | 'qwen3-asr' | …
    display_name             TEXT NOT NULL,
    hf_id                    TEXT,                     -- vendor HF id, NULL for derived
    owner_user_id            TEXT,                     -- NULL for vendor base
    parent_base_model_id     TEXT REFERENCES base_model(id),
    architecture_fingerprint TEXT,                     -- arch_fp from §4.3; NULL until first artifact
    weights_uri              TEXT,                     -- artifact-store path; NULL for vendor stub
    data_zone                TEXT NOT NULL DEFAULT 'green',
    created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_base_model_family
    ON base_model(family);
CREATE INDEX IF NOT EXISTS idx_base_model_owner
    ON base_model(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_base_model_hf_id
    ON base_model(hf_id);

-- Training artifacts produced by a finished job. One job typically
-- writes one row of kind='adapter' (LoRA adapters), and a job that
-- diverges from its parent base also writes a kind='base_model' row
-- with `base_model_id` pointing at the new entry it promoted.
-- The orchestrator's fingerprint check stamps `arch_fp/weight_fp/
-- adapter_fp` so the leaderboard can join evaluations back to the
-- producing artifact (training-job-pipeline.md §4.7).
CREATE TABLE IF NOT EXISTS training_artifact (
    id              TEXT PRIMARY KEY,
    job_id          TEXT NOT NULL REFERENCES training_job(id),
    kind            TEXT NOT NULL CHECK (kind IN ('adapter','base_model','checkpoint','candidate_base')),
    base_model_id   TEXT REFERENCES base_model(id),
    uri             TEXT NOT NULL,
    sha256          TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    arch_fp         TEXT,
    weight_fp       TEXT,
    adapter_fp      TEXT,
    promotion_note  TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_training_artifact_job
    ON training_artifact(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_artifact_kind
    ON training_artifact(kind);
