-- ============================================================================
-- platform.db — everything except identity for AUSTIN-Lang.
--
-- Identity (user, client, user_profile) lives in users.db. References here
-- are plain TEXT columns — SQLite does not support cross-database FKs, and
-- integrity is enforced at the application layer. Same for dataset
-- createdBy columns.
--
-- Preserves the FastAPI main.py transcript schema (audio_file, raw_transcript,
-- raw_transcript_segment, edited_transcript, edited_transcript_segment) and
-- adds `transcript_edit` — the character-level diff table (one row per edit).
-- ============================================================================

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS audit_event;
DROP TABLE IF EXISTS audit_action;
DROP TABLE IF EXISTS leaderboard_worst_example;
DROP TABLE IF EXISTS leaderboard_submission;
DROP TABLE IF EXISTS holdout_membership;
DROP TABLE IF EXISTS accuracy_log;
DROP TABLE IF EXISTS critical_term_failure;
DROP TABLE IF EXISTS selected_metric;
DROP TABLE IF EXISTS metric_series;
DROP TABLE IF EXISTS metric;
DROP TABLE IF EXISTS training_loss_history;
DROP TABLE IF EXISTS training_job;
DROP TABLE IF EXISTS recording_error_cause;
DROP TABLE IF EXISTS recording;
DROP TABLE IF EXISTS processing_job;
DROP TABLE IF EXISTS transcript_edit;
DROP TABLE IF EXISTS transcript_version;
DROP TABLE IF EXISTS edited_transcript_segment;
DROP TABLE IF EXISTS edited_transcript;
DROP TABLE IF EXISTS raw_transcript_segment;
DROP TABLE IF EXISTS raw_transcript;
DROP TABLE IF EXISTS audio_file;
DROP TABLE IF EXISTS dataset_tag;
DROP TABLE IF EXISTS dataset_language;
DROP TABLE IF EXISTS dataset;
DROP TABLE IF EXISTS group_resource;
DROP TABLE IF EXISTS group_permission;
DROP TABLE IF EXISTS user_group_membership;
DROP TABLE IF EXISTS user_group;
DROP TABLE IF EXISTS resource_catalogue;
DROP TABLE IF EXISTS permission_catalogue;

-- ---------------------------------------------------------------------------
-- Groups, permissions, resources
-- ---------------------------------------------------------------------------

CREATE TABLE permission_catalogue (
    key         TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    description TEXT
);

CREATE TABLE resource_catalogue (
    key   TEXT PRIMARY KEY,
    label TEXT NOT NULL
);

CREATE TABLE user_group (
    id              TEXT PRIMARY KEY,                   -- 'hk-admin-access-perms' etc.
    name            TEXT NOT NULL,
    description     TEXT,
    category        TEXT NOT NULL CHECK (category IN ('File Organisation','Access Permissions')),
    repository_size TEXT
);

CREATE TABLE user_group_membership (
    user_id     TEXT NOT NULL,                          -- string ref to users.db
    group_id    TEXT NOT NULL REFERENCES user_group(id) ON DELETE CASCADE,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, group_id)
);

CREATE TABLE group_permission (
    group_id       TEXT NOT NULL REFERENCES user_group(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL REFERENCES permission_catalogue(key) ON DELETE CASCADE,
    PRIMARY KEY (group_id, permission_key)
);

CREATE TABLE group_resource (
    group_id     TEXT NOT NULL REFERENCES user_group(id) ON DELETE CASCADE,
    resource_key TEXT NOT NULL REFERENCES resource_catalogue(key) ON DELETE CASCADE,
    PRIMARY KEY (group_id, resource_key)
);

CREATE INDEX ix_group_membership_user ON user_group_membership(user_id);

-- ---------------------------------------------------------------------------
-- Datasets (source + engineer-custom)
-- ---------------------------------------------------------------------------

CREATE TABLE dataset (
    id            TEXT PRIMARY KEY,                    -- 'mixed' / 'custom-earnings-q1' / user-created ids
    kind          TEXT NOT NULL CHECK (kind IN ('source','custom')),
    name          TEXT NOT NULL,
    source        TEXT,                                -- HF source string for sampled datasets
    description   TEXT,
    category      TEXT,
    status        TEXT,
    purpose       TEXT,
    origin        TEXT,
    created_by    TEXT,                                -- string ref to users.db
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    file_count    INTEGER DEFAULT 0
);

CREATE TABLE dataset_language (
    dataset_id TEXT NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
    language   TEXT NOT NULL,
    PRIMARY KEY (dataset_id, language)
);

CREATE TABLE dataset_tag (
    dataset_id TEXT NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
    tag        TEXT NOT NULL,
    PRIMARY KEY (dataset_id, tag)
);

-- ---------------------------------------------------------------------------
-- Audio files + transcripts (FastAPI-owned schema preserved + extended)
-- ---------------------------------------------------------------------------

CREATE TABLE audio_file (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    -- ── columns written by database(FE)/main.py ──
    file_name         TEXT NOT NULL,
    uploaded_at       TEXT NOT NULL DEFAULT (datetime('now')),
    -- ── UI metadata columns (nullable so existing FastAPI inserts still work) ──
    external_id       TEXT UNIQUE,                     -- our mock string id e.g. 'sf-mixed-1'
    dataset_id        TEXT REFERENCES dataset(id),
    display_name      TEXT,
    owner_id          TEXT,                            -- string ref to users.db
    detected_language TEXT,
    duration_sec      REAL,
    duration_label    TEXT,
    audio_rel_path    TEXT,
    status            TEXT,
    stage             TEXT,
    -- IDs of the matching rows in the backend database service (poc.db at :8002).
    -- Populated on upload so saveEdits can co-write corrections to the canonical
    -- store that the retraining pipeline reads from.
    backend_audio_file_id        INTEGER,
    backend_raw_transcript_id    INTEGER,
    backend_edited_transcript_id INTEGER,
    -- Provider attribution for webhook-ingested recordings.
    -- 'manual' (or NULL) for human uploads, 'zoom' / 'teams' / 'google_meet'
    -- / 'generic' / … for things ingested via meeting-webhooks. The unique
    -- index below gates webhook dedupe.
    source_provider     TEXT,
    source_recording_id TEXT,
    source_meeting_id   TEXT,
    source_organiser    TEXT
);

CREATE INDEX ix_audio_file_dataset ON audio_file(dataset_id);
CREATE INDEX ix_audio_file_external ON audio_file(external_id);
CREATE UNIQUE INDEX ux_audio_file_provider_rec
    ON audio_file(source_provider, source_recording_id)
    WHERE source_provider IS NOT NULL AND source_recording_id IS NOT NULL;

CREATE TABLE raw_transcript (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    audio_file_id INTEGER NOT NULL REFERENCES audio_file(id) ON DELETE CASCADE,
    rating        INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE raw_transcript_segment (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_transcript_id INTEGER NOT NULL REFERENCES raw_transcript(id) ON DELETE CASCADE,
    start             REAL NOT NULL,
    end               REAL NOT NULL,
    text              TEXT NOT NULL
);

CREATE TABLE edited_transcript (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_transcript_id INTEGER NOT NULL REFERENCES raw_transcript(id) ON DELETE CASCADE,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE edited_transcript_segment (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    edited_transcript_id INTEGER NOT NULL REFERENCES edited_transcript(id) ON DELETE CASCADE,
    start                REAL NOT NULL,
    end                  REAL NOT NULL,
    text                 TEXT NOT NULL
);

-- Append-only version pointer. Each "submit for review" / "approve" /
-- "request changes" freezes the current draft into a permanent, addressable
-- revision; only the draft (is_current=1) is mutable. See
-- docs/07 Integration CAA 27APR2026/transcript-versioning-plan.md.
CREATE TABLE transcript_version (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_transcript_id INTEGER NOT NULL REFERENCES raw_transcript(id) ON DELETE CASCADE,
    version_no        INTEGER NOT NULL,
    parent_version_id INTEGER REFERENCES transcript_version(id),
    label             TEXT NOT NULL CHECK (label IN
                          ('draft','submitted','approved','changes_requested','restored')),
    is_current        INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
    created_by        TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    frozen_at         TEXT,
    note              TEXT,
    UNIQUE (raw_transcript_id, version_no)
);

-- Exactly one current version per transcript.
CREATE UNIQUE INDEX ux_transcript_version_current
    ON transcript_version (raw_transcript_id) WHERE is_current = 1;

CREATE INDEX ix_transcript_version_rt
    ON transcript_version (raw_transcript_id, version_no);

-- Edit rows belong to a single transcript_version. Frozen versions' rows
-- are immutable (enforced at the application layer in writeEditsForFile).
-- The JSON-in-content encoding stays — see writeEditsForFile in
-- frontend/src/server/audio-files.js for why.
CREATE TABLE transcript_edit (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_transcript_id INTEGER NOT NULL REFERENCES raw_transcript(id) ON DELETE CASCADE,
    version_id        INTEGER REFERENCES transcript_version(id) ON DELETE CASCADE,
    start_char        INTEGER NOT NULL,
    content           TEXT NOT NULL,
    operation         TEXT NOT NULL CHECK (operation IN ('add','delete')),
    editor_id         TEXT,                            -- string ref to users.db
    edited_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_transcript_edit_raw ON transcript_edit(raw_transcript_id, start_char);
CREATE INDEX ix_transcript_edit_version ON transcript_edit(version_id);

-- ---------------------------------------------------------------------------
-- Processing queue
-- ---------------------------------------------------------------------------

CREATE TABLE processing_job (
    id                    TEXT PRIMARY KEY,             -- 'pj1' etc.
    name                  TEXT NOT NULL,
    submitted_by          TEXT,                         -- free-text name (mock), not FK
    source                TEXT,
    source_path           TEXT,
    language              TEXT,
    status                TEXT NOT NULL CHECK (status IN ('processing','queued','completed','failed')),
    progress              INTEGER DEFAULT 0,
    stage                 TEXT,
    submitted_at          TEXT,
    estimated_completion  TEXT
);

CREATE TABLE recording (
    id              TEXT PRIMARY KEY,                   -- 'r101' etc.
    job_id          TEXT NOT NULL REFERENCES processing_job(id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,
    duration        TEXT,
    size_mb         REAL,
    progress        INTEGER DEFAULT 0,
    -- Recording-level status is a SUBSET of My Transcripts statuses.
    status          TEXT NOT NULL CHECK (status IN ('transcribing','transcribed','queued','failed')),
    stage           TEXT,
    error_code      TEXT,
    error_message   TEXT,
    error_timestamp TEXT
);

CREATE TABLE recording_error_cause (
    recording_id TEXT NOT NULL REFERENCES recording(id) ON DELETE CASCADE,
    cause        TEXT NOT NULL,
    PRIMARY KEY (recording_id, cause)
);

CREATE INDEX ix_recording_job ON recording(job_id);

-- ---------------------------------------------------------------------------
-- Training jobs
-- ---------------------------------------------------------------------------

CREATE TABLE training_job (
    id                TEXT PRIMARY KEY,
    status            TEXT NOT NULL,
    progress          INTEGER,
    gpu_pct           INTEGER,
    start_time        TEXT,
    started_at        TEXT,
    submitted_by      TEXT,                             -- string ref to users.db
    submitted_at      TEXT,
    description       TEXT,
    base_model        TEXT,
    use_lora          INTEGER NOT NULL DEFAULT 1,
    lora_rank         INTEGER,
    lora_alpha        INTEGER,
    learning_rate     TEXT,                             -- kept as string to preserve '3e-4' notation
    epochs            INTEGER,
    current_epoch     INTEGER,
    batch_size        INTEGER,
    dataset_ref       TEXT,
    dataset_name      TEXT,
    current_step      INTEGER,
    total_steps       INTEGER,
    train_loss        REAL,
    val_loss          REAL,
    tokens_per_sec    REAL,
    grad_norm         REAL,
    elapsed_min       INTEGER,
    eta_min           INTEGER,
    cluster           TEXT,
    gpu_type          TEXT,
    region            TEXT
);

CREATE TABLE training_loss_history (
    training_job_id TEXT NOT NULL REFERENCES training_job(id) ON DELETE CASCADE,
    step            INTEGER NOT NULL,
    loss            REAL NOT NULL,
    PRIMARY KEY (training_job_id, step)
);

-- ---------------------------------------------------------------------------
-- Metrics
-- ---------------------------------------------------------------------------

CREATE TABLE metric (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    short_description  TEXT,
    description        TEXT,
    python_script      TEXT,
    target             REAL,
    date_revised       TEXT,
    is_custom          INTEGER NOT NULL DEFAULT 0,
    filename           TEXT
);

CREATE TABLE metric_series (
    metric_id        TEXT PRIMARY KEY REFERENCES metric(id) ON DELETE CASCADE,
    base_model_json  TEXT NOT NULL,                    -- JSON array
    fine_tuned_json  TEXT NOT NULL,                    -- JSON array
    y_min            REAL,
    y_max            REAL,
    unit             TEXT,
    current_value    REAL,
    difference       TEXT,
    value_label      TEXT,                             -- '95.8%' etc.
    sublabel         TEXT,
    accent           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE selected_metric (
    metric_id  TEXT PRIMARY KEY REFERENCES metric(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL
);

CREATE TABLE critical_term_failure (
    term  TEXT PRIMARY KEY,
    edits INTEGER NOT NULL
);

CREATE TABLE accuracy_log (
    id       TEXT PRIMARY KEY,
    title    TEXT NOT NULL,
    duration TEXT,
    editor   TEXT,
    accuracy REAL,
    change   REAL
);

-- ---------------------------------------------------------------------------
-- Leaderboard
-- ---------------------------------------------------------------------------

CREATE TABLE leaderboard_submission (
    id                         TEXT PRIMARY KEY,
    dataset_id                 TEXT NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
    engineer_id                TEXT,                            -- string ref to users.db
    engineer_name              TEXT,
    model_name                 TEXT NOT NULL,
    base_family                TEXT,
    wer                        REAL,
    cer                        REAL,
    rtf                        REAL,
    submission_count           INTEGER DEFAULT 1,
    submitted_at               TEXT,
    config_stored              INTEGER NOT NULL DEFAULT 0,
    checkpoint_stored          INTEGER NOT NULL DEFAULT 0,
    notebook_stored            INTEGER NOT NULL DEFAULT 0,
    -- Cardinality of the dataset's holdout_membership at submission time.
    -- Snapshot-of-set is deferred; this is the lightweight transparency surface
    -- so the leaderboard UI can show "scored on N recordings" without a join.
    evaluated_recording_count  INTEGER
);

CREATE TABLE leaderboard_worst_example (
    id             TEXT PRIMARY KEY,
    submission_id  TEXT NOT NULL REFERENCES leaderboard_submission(id) ON DELETE CASCADE,
    ref_text       TEXT,
    pred_text      TEXT,
    utterance_wer  REAL
);

CREATE INDEX ix_leaderboard_dataset ON leaderboard_submission(dataset_id);

-- Per-dataset holdout selection. A row marks one recording as part of the
-- benching evaluation set for that dataset. The benching/leaderboard pipeline
-- reads this table to decide which recordings to score new model submissions
-- on. The same recording can appear in multiple datasets (engineer custom
-- sets reuse files from the source pool by reference) so membership lives in
-- a junction rather than a boolean on audio_file.
--
-- audio_file_external_id matches audio_file.external_id; cross-database FKs
-- aren't supported by SQLite so the join is enforced at the application layer
-- (same convention as recording.* and audit_event.file_id).
CREATE TABLE holdout_membership (
    dataset_id              TEXT NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
    audio_file_external_id  TEXT NOT NULL,
    marked_by               TEXT NOT NULL,                 -- string ref to users.db user.id
    marked_at               TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (dataset_id, audio_file_external_id)
);

CREATE INDEX ix_holdout_membership_file ON holdout_membership(audio_file_external_id);

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE audit_action (
    key      TEXT PRIMARY KEY,
    label    TEXT NOT NULL,
    verb     TEXT,
    category TEXT,
    color    TEXT
);

CREATE TABLE audit_event (
    id           TEXT PRIMARY KEY,                     -- 'audit-<fileId>-<n>'
    file_id      TEXT,                                 -- references audio_file.external_id (app-level)
    actor_id     TEXT,                                 -- 'system' or users.db user.id
    actor_name   TEXT,
    action_key   TEXT NOT NULL REFERENCES audit_action(key),
    timestamp    TEXT NOT NULL,
    details_json TEXT
);

CREATE INDEX ix_audit_event_file ON audit_event(file_id);
CREATE INDEX ix_audit_event_actor ON audit_event(actor_id);
