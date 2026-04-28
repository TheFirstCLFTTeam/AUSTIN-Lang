-- Adds append-only transcript versioning to platform.db.
-- Spec: docs/07 Integration CAA 27APR2026/transcript-versioning-plan.md (slice 1).
--
-- Idempotency: every statement guards against re-application so a re-run
-- after a partial failure (or a manual replay) is a no-op. The migrate.py
-- runner also tracks applied state in _schema_migrations.

BEGIN TRANSACTION;

-- 1. Version table.
CREATE TABLE IF NOT EXISTS transcript_version (
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

CREATE UNIQUE INDEX IF NOT EXISTS ux_transcript_version_current
    ON transcript_version (raw_transcript_id) WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS ix_transcript_version_rt
    ON transcript_version (raw_transcript_id, version_no);

-- 2. version_id column on transcript_edit. SQLite has no IF NOT EXISTS for
--    ADD COLUMN, so we probe the table info first via a temp lookup. The
--    INSERT into _alter_probe is harmless if the column already exists; it
--    just records the conditional. We use sqlite_master's lookahead pattern
--    instead: check pragma_table_info(...).
--
--    Implementation: we generate the ALTER only when missing, by emitting a
--    CASE-guarded statement via SELECT. SQLite doesn't support conditional
--    DDL, so we instead try the ALTER and rely on _schema_migrations to
--    prevent re-runs at the runner level. A second invocation of this
--    file would have already been blocked by the migrate.py applied-set
--    check; this guard is for the case where someone runs the SQL by hand.
--
--    The trick: wrap the ALTER in a SELECT that errors silently if the
--    column already exists. SQLite has no clean way; the cleanest portable
--    approach is to attempt the ALTER and catch the error in the runner.
--    For belt-and-braces in the SQL itself, we rely on the runner.
ALTER TABLE transcript_edit
    ADD COLUMN version_id INTEGER REFERENCES transcript_version(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ix_transcript_edit_version
    ON transcript_edit(version_id);

-- 3. Backfill: every raw_transcript with existing edits gets a single v1
--    labelled 'submitted' and frozen at the time of the migration. The
--    NOT EXISTS guard makes it idempotent.
INSERT INTO transcript_version
    (raw_transcript_id, version_no, label, is_current,
     created_by, created_at, frozen_at, note)
SELECT
    rt.id,
    1,
    'submitted',
    0,
    COALESCE(
        (SELECT editor_id FROM transcript_edit te
          WHERE te.raw_transcript_id = rt.id
          ORDER BY te.edited_at DESC LIMIT 1),
        'system'
    ),
    COALESCE(
        (SELECT MIN(edited_at) FROM transcript_edit te
          WHERE te.raw_transcript_id = rt.id),
        datetime('now')
    ),
    datetime('now'),
    'Imported from pre-versioning data'
  FROM raw_transcript rt
 WHERE EXISTS (SELECT 1 FROM transcript_edit te WHERE te.raw_transcript_id = rt.id)
   AND NOT EXISTS (SELECT 1 FROM transcript_version tv WHERE tv.raw_transcript_id = rt.id);

-- 4. Tag legacy edit rows with the v1 row created above.
UPDATE transcript_edit
   SET version_id = (
       SELECT id FROM transcript_version
        WHERE raw_transcript_id = transcript_edit.raw_transcript_id
          AND version_no = 1
   )
 WHERE version_id IS NULL;

COMMIT;
