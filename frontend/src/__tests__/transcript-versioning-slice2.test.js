// Slice-2 invariants for transcript versioning. Spec §5.4–5.6 of
// docs/07 Integration CAA 27APR2026/transcript-versioning-plan.md.
//
// Covers: listVersions ordering, getVersion edits + applied segments,
// diffVersions symmetric difference (with shared bucket), restoreVersion
// dirty-draft 409 path + save/discard dispositions, audit trail.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

let mem;
vi.mock('@/server/db', () => ({
    platformDb: () => mem,
    usersDb: () => mem,
}));

const recordAuditEvent = vi.fn();
vi.mock('@/server/audit', () => ({
    recordAuditEvent: (...args) => recordAuditEvent(...args),
}));

beforeEach(() => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: async () => '' }));
});

afterEach(() => {
    if (mem) mem.close();
    mem = null;
    recordAuditEvent.mockClear();
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
            backend_edited_transcript_id INTEGER
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
    db.prepare(`INSERT INTO "user" (id, name, role) VALUES ('u-larry', 'Larry', 'engineer')`).run();
    db.prepare(`INSERT INTO "user" (id, name, role) VALUES ('u-priya', 'Priya', 'reviewer')`).run();
    db.prepare(`INSERT INTO audio_file (id, file_name, external_id, owner_id, status) VALUES (1, 'a.wav', 'ext-1', 'u-larry', 'needs action')`).run();
    db.prepare(`INSERT INTO raw_transcript (id, audio_file_id) VALUES (1, 1)`).run();
    db.prepare(`INSERT INTO raw_transcript_segment (raw_transcript_id, start, end, text) VALUES (1, 0.0, 1.0, 'hello'), (1, 1.0, 2.0, 'world')`).run();
}

const ACTOR = { id: 'u-larry', role: 'engineer' };
const REVIEWER = { id: 'u-priya', role: 'reviewer' };

describe('transcript versioning — slice 2 (read + diff + restore)', () => {
    beforeEach(async () => {
        mem = new Database(':memory:');
        mem.pragma('foreign_keys = ON');
        buildSchema(mem);
    });

    it('listVersions returns versions newest first with creator names resolved', async () => {
        const { writeEditsForFile, setAudioFileStatus } = await import('@/server/audio-files');
        const { listVersions } = await import('@/server/transcript-versions');

        // Build v1 (submitted), v2 (changes_requested), v3 (current draft).
        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'in review', ACTOR, { actionKey: 'submitted_for_review', details: {} });

        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hi', after: 'hi!', editedAt: '2026-04-02T10:00:00Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'needs action', REVIEWER, { actionKey: 'requested_changes', details: { comment: 'fix' } });

        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hi!', after: 'hello again', editedAt: '2026-04-03T10:00:00Z' },
        ], ACTOR);

        const versions = listVersions('ext-1');
        expect(versions).toHaveLength(3);
        expect(versions.map((v) => v.versionNo)).toEqual([3, 2, 1]);
        expect(versions[0]).toMatchObject({ label: 'draft', isCurrent: true, isDraft: true, createdByName: 'Larry' });
        expect(versions[1]).toMatchObject({ label: 'changes_requested', isCurrent: false, createdByName: 'Larry' });
        expect(versions[2]).toMatchObject({ label: 'submitted', isCurrent: false });
    });

    it('getVersion returns full edits + applied segments for the requested version', async () => {
        const { writeEditsForFile, setAudioFileStatus } = await import('@/server/audio-files');
        const { getVersion } = await import('@/server/transcript-versions');

        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'in review', ACTOR, { actionKey: 'submitted_for_review', details: {} });

        const v1 = getVersion('ext-1', 1);
        expect(v1.versionNo).toBe(1);
        expect(v1.label).toBe('submitted');
        expect(v1.edits).toHaveLength(1);
        expect(v1.appliedSegments).toBeDefined();
        expect(v1.rawSegments).toHaveLength(2);
    });

    it('getVersion 404s on a version_no that does not exist', async () => {
        const { getVersion } = await import('@/server/transcript-versions');
        expect(() => getVersion('ext-1', 99)).toThrow('Version not found');
    });

    it('diffVersions returns symmetric difference + shared edits', async () => {
        const { writeEditsForFile, setAudioFileStatus } = await import('@/server/audio-files');
        const { diffVersions } = await import('@/server/transcript-versions');

        // v1: edits A + B
        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
            { op: 'delete',  wordIndex: 1, segmentId: 1, before: 'world',                editedAt: '2026-04-01T10:00:01Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'in review', ACTOR, { actionKey: 'submitted_for_review', details: {} });
        // v2: edits A + C (B reverted, C introduced)
        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi',     editedAt: '2026-04-01T10:00:00Z' },
            { op: 'replace', wordIndex: 1, segmentId: 1, before: 'world', after: 'planet', editedAt: '2026-04-02T10:00:00Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'in review', ACTOR, { actionKey: 'submitted_for_review', details: {} });

        const diff = diffVersions('ext-1', 1, 2);
        expect(diff.from).toEqual({ versionNo: 1, editCount: 2 });
        expect(diff.to).toEqual({ versionNo: 2, editCount: 2 });
        expect(diff.shared).toHaveLength(1);
        expect(diff.shared[0].after).toBe('hi');
        expect(diff.onlyInA).toHaveLength(1);
        expect(diff.onlyInA[0].op).toBe('delete');
        expect(diff.onlyInB).toHaveLength(1);
        expect(diff.onlyInB[0].after).toBe('planet');

        // Reverse direction is symmetric — shared stays the same; onlyInA / onlyInB swap.
        const reverse = diffVersions('ext-1', 2, 1);
        expect(reverse.shared).toHaveLength(1);
        expect(reverse.onlyInA).toHaveLength(1);
        expect(reverse.onlyInA[0].after).toBe('planet');
        expect(reverse.onlyInB).toHaveLength(1);
        expect(reverse.onlyInB[0].op).toBe('delete');
    });

    it('restoreVersion against an empty draft creates a restored draft and copies edits', async () => {
        const { writeEditsForFile, setAudioFileStatus } = await import('@/server/audio-files');
        const { restoreVersion } = await import('@/server/transcript-versions');

        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'in review', ACTOR, { actionKey: 'submitted_for_review', details: {} });
        // No draft exists.

        const result = await restoreVersion('ext-1', 1, ACTOR);
        expect(result.newVersionNo).toBe(2);
        expect(result.restoredFromVersionNo).toBe(1);
        expect(result.existingDraftDisposition).toBeNull();

        const newDraft = mem.prepare(`SELECT * FROM transcript_version WHERE is_current = 1`).get();
        expect(newDraft.label).toBe('restored');
        expect(newDraft.parent_version_id).toBe(1);
        const newDraftEdits = mem.prepare(`SELECT * FROM transcript_edit WHERE version_id = ?`).all(newDraft.id);
        expect(newDraftEdits).toHaveLength(1);

        // INVARIANT: source v1's rows are unchanged.
        const v1Edits = mem.prepare(`SELECT * FROM transcript_edit WHERE version_id = 1`).all();
        expect(v1Edits).toHaveLength(1);

        expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
            actionKey: 'version_restored',
            details: expect.objectContaining({ from: 1, to: 2 }),
        }));
    });

    it('restoreVersion throws DIRTY_DRAFT when an existing draft has unsaved edits', async () => {
        const { writeEditsForFile, setAudioFileStatus } = await import('@/server/audio-files');
        const { restoreVersion } = await import('@/server/transcript-versions');

        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'in review', ACTOR, { actionKey: 'submitted_for_review', details: {} });
        // Now create a dirty draft.
        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hi', after: 'goodbye', editedAt: '2026-04-02T10:00:00Z' },
        ], ACTOR);

        try {
            await restoreVersion('ext-1', 1, ACTOR);
            expect.unreachable('expected DIRTY_DRAFT throw');
        } catch (err) {
            expect(err.code).toBe('DIRTY_DRAFT');
            expect(err.draftVersionNo).toBe(2);
            expect(err.draftEditCount).toBe(1);
        }
    });

    it('restoreVersion with existingDraft=save freezes the draft and proceeds', async () => {
        const { writeEditsForFile, setAudioFileStatus } = await import('@/server/audio-files');
        const { restoreVersion } = await import('@/server/transcript-versions');

        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'in review', ACTOR, { actionKey: 'submitted_for_review', details: {} });
        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hi', after: 'goodbye', editedAt: '2026-04-02T10:00:00Z' },
        ], ACTOR);

        const result = await restoreVersion('ext-1', 1, ACTOR, { existingDraft: 'save' });
        expect(result.existingDraftDisposition).toBe('saved');
        expect(result.newVersionNo).toBe(3);

        // The previously-dirty v2 is now frozen with label='draft', is_current=0.
        const v2 = mem.prepare(`SELECT * FROM transcript_version WHERE version_no = 2`).get();
        expect(v2.is_current).toBe(0);
        expect(v2.label).toBe('draft');
        expect(v2.frozen_at).not.toBeNull();
        // Its edits were preserved.
        const v2Edits = mem.prepare(`SELECT * FROM transcript_edit WHERE version_id = ?`).all(v2.id);
        expect(v2Edits).toHaveLength(1);
        expect(JSON.parse(v2Edits[0].content).after).toBe('goodbye');
    });

    it('restoreVersion with existingDraft=discard deletes the draft entirely', async () => {
        const { writeEditsForFile, setAudioFileStatus } = await import('@/server/audio-files');
        const { restoreVersion } = await import('@/server/transcript-versions');

        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hello', after: 'hi', editedAt: '2026-04-01T10:00:00Z' },
        ], ACTOR);
        await setAudioFileStatus('ext-1', 'in review', ACTOR, { actionKey: 'submitted_for_review', details: {} });
        writeEditsForFile('ext-1', [
            { op: 'replace', wordIndex: 0, segmentId: 1, before: 'hi', after: 'goodbye', editedAt: '2026-04-02T10:00:00Z' },
        ], ACTOR);

        const result = await restoreVersion('ext-1', 1, ACTOR, { existingDraft: 'discard' });
        expect(result.existingDraftDisposition).toBe('discarded');

        // The dirty draft v2 is gone — both its row and its edits.
        const v2 = mem.prepare(`SELECT * FROM transcript_version WHERE version_no = 2`).get();
        expect(v2).toBeUndefined();
        const remainingEdits = mem.prepare(`SELECT * FROM transcript_edit WHERE editor_id = ? AND content LIKE '%goodbye%'`).all('u-larry');
        expect(remainingEdits).toHaveLength(0);

        // INVARIANT: source v1's frozen rows still intact.
        const v1Edits = mem.prepare(`SELECT * FROM transcript_edit WHERE version_id = 1`).all();
        expect(v1Edits).toHaveLength(1);

        // The new restored draft picks up at v3 (v2 was deleted, so MAX+1 = 3
        // because version_no=2 was already used).
        const restored = mem.prepare(`SELECT * FROM transcript_version WHERE is_current = 1`).get();
        expect(restored.version_no).toBe(3);
        expect(restored.label).toBe('restored');
    });

    it('restoreVersion 404s on an unknown version_no', async () => {
        const { restoreVersion } = await import('@/server/transcript-versions');
        await expect(restoreVersion('ext-1', 99, ACTOR)).rejects.toThrow('Version not found');
    });
});
