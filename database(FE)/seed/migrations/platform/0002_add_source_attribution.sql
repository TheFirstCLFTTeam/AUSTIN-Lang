-- Adds provider source attribution to audio_file so the dashboard can show
-- where each recording came from (manual upload vs Zoom vs Teams vs …) and
-- the meeting-webhooks service has a unique gate for dedupe.
--
-- Spec: docs/07 Integration CAA 27APR2026/meeting_recording_webhooks.md §4.

BEGIN TRANSACTION;

ALTER TABLE audio_file ADD COLUMN source_provider     TEXT;
ALTER TABLE audio_file ADD COLUMN source_recording_id TEXT;
ALTER TABLE audio_file ADD COLUMN source_meeting_id   TEXT;
ALTER TABLE audio_file ADD COLUMN source_organiser    TEXT;

-- Dedupe gate. Manual uploads have NULL recording_id so they don't collide;
-- partial unique index on the non-null tuple gives us idempotent webhook
-- ingest without breaking existing rows.
CREATE UNIQUE INDEX IF NOT EXISTS ux_audio_file_provider_rec
    ON audio_file(source_provider, source_recording_id)
    WHERE source_provider IS NOT NULL AND source_recording_id IS NOT NULL;

COMMIT;
