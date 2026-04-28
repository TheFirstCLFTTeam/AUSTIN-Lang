-- Financial terms dictionary schema. See
-- docs/07 Integration CAA 27APR2026/financial-terms-dictionary.md §5.
--
-- Two tables, deliberately split:
--   financial_term            — editable state; the moderation lifecycle
--                               flips status pending → approved → rejected
--                               or → retired. Soft-delete only; rows are
--                               never DROPped so the audit trail survives.
--   financial_term_occurrence — append-only ledger of where terms appeared
--                               in real transcripts and whether the model
--                               got each one right. Drives the metric AND
--                               the "top wrong terms" admin view.

CREATE TABLE IF NOT EXISTS financial_term (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    term            TEXT NOT NULL,                       -- canonical form, e.g. "EBITDA"
    term_normalized TEXT NOT NULL,                       -- lower(trim(term)); unique
    category        TEXT,                                -- 'ratio' | 'instrument' | 'regulation' | …
    definition      TEXT,                                -- usually a URL, optional
    status          TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','retired')),
    submitted_by    TEXT,                                -- users.db user.id; NULL for seed-imported
    submitted_at    TEXT NOT NULL DEFAULT (datetime('now')),
    approved_by     TEXT,                                -- users.db user.id; NULL until approved
    approved_at     TEXT,
    source_file_id  TEXT,                                -- audio_file.external_id when surfaced from a transcript
    notes           TEXT,                                -- free-form moderator note
    UNIQUE(term_normalized)
);

CREATE INDEX IF NOT EXISTS ix_financial_term_status   ON financial_term(status);
CREATE INDEX IF NOT EXISTS ix_financial_term_category ON financial_term(category);

CREATE TABLE IF NOT EXISTS financial_term_occurrence (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    term_id                INTEGER NOT NULL REFERENCES financial_term(id) ON DELETE CASCADE,
    audio_file_external_id TEXT NOT NULL,
    appeared_at            TEXT NOT NULL DEFAULT (datetime('now')),
    correctly_transcribed  INTEGER NOT NULL CHECK (correctly_transcribed IN (0,1)),
    UNIQUE(term_id, audio_file_external_id)
);

CREATE INDEX IF NOT EXISTS ix_term_occurrence_file ON financial_term_occurrence(audio_file_external_id);
CREATE INDEX IF NOT EXISTS ix_term_occurrence_term ON financial_term_occurrence(term_id);
