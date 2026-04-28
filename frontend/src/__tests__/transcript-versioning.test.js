// Slice-1 invariants for transcript versioning. Spec:
// docs/07 Integration CAA 27APR2026/transcript-versioning-plan.md
//
// What this guards against:
//   1. Frozen versions' edit rows must never be touched. The destructive
//      DELETE-then-INSERT in pre-versioning writeEditsForFile was the bug
//      this whole feature exists to fix.
//   2. There must be at most one is_current=1 row per transcript at a time
//      — the partial unique index enforces it; this test confirms the app
//      code respects it.
//   3. Freezing a draft must transition is_current=1 → 0 and stamp
//      frozen_at + the right label.
//
// We use vi.mock to swap `server/db.js` for an in-memory SQLite DB so the
// tests don't touch the real platform.db artefact.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

// Wire an in-memory DB *before* importing the SUT — vi.mock is hoisted, so
// this declaration order works.
let mem;
vi.mock('@/server/db', () => ({
    platformDb: () => mem,
    usersDb: () => mem,
}));

// audit + co-write are out of scope for these tests; stub them.
vi.mock('@/server/audit', () => ({
    recordAuditEvent: vi.fn(),
}));

// Stub the global fetch used by coWriteEditedTranscriptToBackend so freeze
// flows complete without trying to reach the backend service.
beforeEach(() => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: async () => '' }));
});

afterEach(() => {
    if (mem) mem.close();
    mem = null;
    vi.restoreAllMocks();
});

function buildSchema(db) {
    db.exec(`
        CREATE TABLE "user" (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT,
            role TEXT
        );
        CREATE TABLE audio_file (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            external_id TEXT UNIQUE,
            display_name TEXT,
            owner_id TEXT,
            duration_sec REAL,
            duration_label TEXT,
            detected_language TEXT,
            dataset_id TEXT,
            status TEXT,
            stage TEXT,
            audio_rel_path TEXT,
            uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
            backend_audio_file_id INTEGER,
            backend_raw_transcript_id INTEGER,
            backend_edited_transcript_id INTEGER,
            source_provider TEXT,
            source_recording_id TEXT,
            source_meeting_id TEXT,
            source_organiser TEXT
        );
        CREATE TABLE raw_transcript (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            audio_file_id INTEGER NOT NULL REFERENCES audio_file(id) ON DELETE CASCADE,
            rating INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE raw_transcript_segment (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_transcript_id INTEGER NOT NULL REFERENCES raw_transcript(id) ON DELETE CASCADE,
            start REAL NOT NULL,
            end REAL NOT NULL,
            text TEXT NOT NULL
        );
        CREATE TABLE transcript_version (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_transcript_id INTEGER NOT NULL REFERENCES raw_transcript(id) ON DELETE CASCADE,
            version_no INTEGER NOT NULL,
            parent_version_id INTEGER REFERENCES transcript_version(id),
            label TEXT NOT NULL CHECK (label IN ('draft','submitted','approved','changes_requested','restored')),
            is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            frozen_at TEXT,
            note TEXT,
            UNIQUE (raw_transcript_id, version_no)
        );
        CREATE UNIQUE INDEX ux_transcript_version_current
            ON transcript_version (raw_transcript_id) WHERE is_current = 1;
        CREATE TABLE transcript_edit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_transcript_id INTEGER NOT NULL REFERENCES raw_transcript(id) ON DELETE CASCADE,
            version_id INTEGER REFERENCES transcript_version(id) ON DELETE CASCADE,
            start_char INTEGER NOT NULL,
            content TEXT NOT NULL,
            operation TEXT NOT NULL CHECK (operation IN ('add','delete')),
            editor_id TEXT,
            edited_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);

    // Fixture: one audio_file with a raw_transcript and two segments.
    db.prepare(
        `INSERT INTO "user" (id, name, email, role) VALUES ('u-larry', 'Larry', 'larry@example.com', 'engineer')`
    ).run();
    db.prepare(
        `INSERT INTO audio_file (id, file_name, external_id, owner_id, status)
         VALUES (1, 'a.wav', 'ext-1', 'u-larry', 'needs action')`
    ).run();
    db.prepare(
        `INSERT INTO raw_transcript (id, audio_file_id) VALUES (1, 1)`
    ).run();
    db.prepare(
        `INSERT INTO raw_transcript_segment (raw_transcript_id, start, end, text)
         VALUES (1, 0.0, 1.0, 'hello'), (1, 1.0, 2.0, 'world')`
    ).run();
}

const ACTOR = { id: 'u-larry', role: 'engineer' };

describe('transcript versioning — slice 1 invariants', () => {
    beforeEach(async () => {
        mem = new Database(':memory:');
        mem.pragma('foreign_keys = ON');
        buildSchema(mem);
    });

    it('first save creates a draft version with is_current=1', async () => {
        const { writeEditsForFile } = await import('@/server/audio-files');
        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
        ], ACTOR);

        const versions = mem.prepare(`SELECT * FROM transcript_version`).all();
        expect(versions).toHaveLength(1);
        expect(versions[0]).toMatchObject({
            version_no: 1, label: 'draft', is_current: 1, created_by: 'u-larry',
        });

        const edits = mem.prepare(`SELECT * FROM transcript_edit`).all();
        expect(edits).toHaveLength(1);
        expect(edits[0].version_id).toBe(versions[0].id);
    });

    it('frozen edits survive a subsequent save (the load-bearing invariant)', async () => {
        const { writeEditsForFile, setAudioFileStatus } = await import('@/server/audio-files');

        // 1. Save edits A.
        const editsA = [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
            { op: 'delete',  wordIndex: 1, segmentId: 1, before: 'world',                editedAt: '2026-04-01T10:00:01Z' },
        ];
        writeEditsForFile('ext-1', editsA, ACTOR);
        const v1Id = mem.prepare(`SELECT id FROM transcript_version WHERE is_current = 1`).get().id;
        const v1EditsBefore = mem.prepare(`SELECT * FROM transcript_edit WHERE version_id = ? ORDER BY id`).all(v1Id);
        expect(v1EditsBefore).toHaveLength(2);

        // 2. Submit for review — freezes v1.
        await setAudioFileStatus('ext-1', 'in review', ACTOR, {
            actionKey: 'submitted_for_review', details: {},
        });
        const v1Frozen = mem.prepare(`SELECT * FROM transcript_version WHERE id = ?`).get(v1Id);
        expect(v1Frozen.label).toBe('submitted');
        expect(v1Frozen.is_current).toBe(0);
        expect(v1Frozen.frozen_at).not.toBeNull();

        // 3. Save edits B — should create v2 (draft) and not touch v1's rows.
        const editsB = [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hi', after: 'goodbye', editedAt: '2026-04-02T10:00:00Z' },
        ];
        writeEditsForFile('ext-1', editsB, ACTOR);

        // INVARIANT: v1's edit rows are byte-identical to before.
        const v1EditsAfter = mem.prepare(`SELECT * FROM transcript_edit WHERE version_id = ? ORDER BY id`).all(v1Id);
        expect(v1EditsAfter).toEqual(v1EditsBefore);

        // And v2 exists with its own edits.
        const v2 = mem.prepare(`SELECT * FROM transcript_version WHERE is_current = 1`).get();
        expect(v2.version_no).toBe(2);
        expect(v2.label).toBe('draft');
        expect(v2.parent_version_id).toBe(v1Id);
        const v2Edits = mem.prepare(`SELECT * FROM transcript_edit WHERE version_id = ?`).all(v2.id);
        expect(v2Edits).toHaveLength(1);
        expect(JSON.parse(v2Edits[0].content).after).toBe('goodbye');
    });

    it('only one is_current=1 row exists across many saves', async () => {
        const { writeEditsForFile } = await import('@/server/audio-files');
        for (let i = 0; i < 10; i++) {
            writeEditsForFile('ext-1', [
                { op: 'replace', wordIndex: 0, segmentId: 1, before: 'a', after: `b${i}`, editedAt: new Date().toISOString() },
            ], ACTOR);
        }
        const currentCount = mem.prepare(
            `SELECT COUNT(*) AS n FROM transcript_version WHERE is_current = 1`
        ).get().n;
        expect(currentCount).toBe(1);

        // And only one version was created (no draft explosion from autosaves).
        const total = mem.prepare(`SELECT COUNT(*) AS n FROM transcript_version`).get().n;
        expect(total).toBe(1);
    });

    it('approve freezes with label=approved; request-changes with label=changes_requested', async () => {
        const { writeEditsForFile, setAudioFileStatus } = await import('@/server/audio-files');

        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'completed', ACTOR, { actionKey: 'approved', details: null });
        let frozen = mem.prepare(`SELECT * FROM transcript_version WHERE version_no = 1`).get();
        expect(frozen.label).toBe('approved');
        expect(frozen.is_current).toBe(0);

        // Next save creates v2; request-changes freezes it as 'changes_requested'.
        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hi', after: 'hi!', editedAt: '2026-04-02T10:00:00Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'needs action', ACTOR, { actionKey: 'requested_changes', details: { comment: 'fix tone' } });
        frozen = mem.prepare(`SELECT * FROM transcript_version WHERE version_no = 2`).get();
        expect(frozen.label).toBe('changes_requested');
        expect(frozen.is_current).toBe(0);
    });

    it('freeze on a transcript with no draft is a silent no-op', async () => {
        const { setAudioFileStatus } = await import('@/server/audio-files');
        // No writeEditsForFile call has happened — there is no draft.
        const result = await setAudioFileStatus('ext-1', 'in review', ACTOR, {
            actionKey: 'submitted_for_review', details: {},
        });
        expect(result.versionNo).toBeNull();
        const versions = mem.prepare(`SELECT COUNT(*) AS n FROM transcript_version`).get().n;
        expect(versions).toBe(0);
    });

    it('read path (getAudioFileDetail) returns draft edits when a draft exists', async () => {
        const { writeEditsForFile, getAudioFileDetail } = await import('@/server/audio-files');
        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
        ], ACTOR);

        const detail = getAudioFileDetail('ext-1');
        expect(detail.edits).toHaveLength(1);
        expect(detail.edits[0].after).toBe('hi');
    });

    it('read path falls back to the latest frozen version when no draft exists', async () => {
        const { writeEditsForFile, setAudioFileStatus, getAudioFileDetail } = await import('@/server/audio-files');
        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'in review', ACTOR, { actionKey: 'submitted_for_review', details: {} });

        // No draft now — but the read should still surface the frozen v1.
        const detail = getAudioFileDetail('ext-1');
        expect(detail.edits).toHaveLength(1);
        expect(detail.edits[0].after).toBe('hi');
    });
});
