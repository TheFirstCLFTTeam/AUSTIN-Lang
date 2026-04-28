import 'server-only';

import { platformDb, usersDb } from './db';
import { recordAuditEvent } from './audit';
import { invalidateDetail } from './cache';
import { applyEdits } from '../lib/transcriptEdits';

// Slice 2 of the transcript versioning plan. The data-model + write-path
// changes landed in slice 1; this module exposes the four read/write
// operations the UI needs to surface versions.
//
// Spec: docs/07 Integration CAA 27APR2026/transcript-versioning-plan.md §5.4.

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadFileRow(fileId) {
    const db = platformDb();
    return db.prepare(
        `SELECT af.id, af.external_id,
                rt.id AS raw_transcript_id,
                af.backend_raw_transcript_id AS backend_rt_id,
                af.backend_edited_transcript_id AS backend_et_id
           FROM audio_file af
           LEFT JOIN raw_transcript rt ON rt.audio_file_id = af.id
          WHERE af.external_id = ? OR af.id = ?`
    ).get(String(fileId), Number(fileId) || -1);
}

function loadCreatorNameMap(creatorIds) {
    if (!creatorIds.size) return new Map();
    const placeholders = Array.from(creatorIds).map(() => '?').join(',');
    const rows = usersDb()
        .prepare(`SELECT id, name FROM "user" WHERE id IN (${placeholders})`)
        .all(...creatorIds);
    const out = new Map();
    for (const r of rows) out.set(r.id, r.name);
    return out;
}

function rowToSummary(row, creatorNames) {
    return {
        id: row.id,
        versionNo: row.version_no,
        label: row.label,
        isCurrent: row.is_current === 1,
        isDraft: row.is_current === 1 && row.label === 'draft',
        createdAt: row.created_at,
        createdBy: row.created_by,
        createdByName: creatorNames.get(row.created_by) || row.created_by,
        frozenAt: row.frozen_at,
        parentVersionId: row.parent_version_id,
        note: row.note,
    };
}

function loadEditsForVersion(db, versionId) {
    const rows = db.prepare(
        `SELECT content FROM transcript_edit
          WHERE version_id = ? ORDER BY edited_at, id`
    ).all(versionId);
    const edits = [];
    for (const r of rows) {
        try {
            const parsed = JSON.parse(r.content);
            if (parsed && typeof parsed === 'object') edits.push(parsed);
        } catch { /* skip malformed */ }
    }
    return edits;
}

// Canonical identity for a single edit. Used by the diff algorithm to bucket
// edits as "same in both versions" vs "only in A" vs "only in B."
//
// We deliberately key on the edit's effect (segmentId + wordIndex + op +
// before→after), not on the row id — different version rows representing the
// same effect should match.
function canonicalKey(edit) {
    const seg = edit?.segmentId ?? '';
    const idx = edit?.wordIndex ?? '';
    const op  = edit?.op ?? '';
    const before = edit?.before ?? '';
    const after  = edit?.after ?? '';
    return `${seg}:${idx}:${op}:${before}->${after}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// List all versions for a file, newest first. Lightweight — no edit payloads.
export function listVersions(fileId) {
    const file = loadFileRow(fileId);
    if (!file) throw new Error('File not found');
    if (!file.raw_transcript_id) return [];

    const db = platformDb();
    const rows = db.prepare(
        `SELECT id, raw_transcript_id, version_no, parent_version_id,
                label, is_current, created_by, created_at, frozen_at, note
           FROM transcript_version
          WHERE raw_transcript_id = ?
          ORDER BY version_no DESC`
    ).all(file.raw_transcript_id);

    const creatorNames = loadCreatorNameMap(new Set(rows.map((r) => r.created_by)));
    return rows.map((r) => rowToSummary(r, creatorNames));
}

// Fetch a single version's full payload — summary, edits, and the applied
// transcript segments (raw + edits applied).
export function getVersion(fileId, versionNo) {
    const file = loadFileRow(fileId);
    if (!file) throw new Error('File not found');
    if (!file.raw_transcript_id) throw new Error('File has no transcript');

    const db = platformDb();
    const row = db.prepare(
        `SELECT id, raw_transcript_id, version_no, parent_version_id,
                label, is_current, created_by, created_at, frozen_at, note
           FROM transcript_version
          WHERE raw_transcript_id = ? AND version_no = ?`
    ).get(file.raw_transcript_id, Number(versionNo));
    if (!row) throw new Error('Version not found');

    const edits = loadEditsForVersion(db, row.id);
    const rawSegments = db.prepare(
        `SELECT id, start, end, text FROM raw_transcript_segment
          WHERE raw_transcript_id = ? ORDER BY start`
    ).all(file.raw_transcript_id);
    const appliedSegments = applyEdits(rawSegments, edits);

    const creatorNames = loadCreatorNameMap(new Set([row.created_by]));
    return {
        ...rowToSummary(row, creatorNames),
        edits,
        appliedSegments,
        rawSegments,
    };
}

// Symmetric diff between two versions. Returns the edits that appear ONLY in
// A (i.e. were reverted in B), only in B (introduced in B), and the ones
// shared between both.
export function diffVersions(fileId, versionNoA, versionNoB) {
    const file = loadFileRow(fileId);
    if (!file) throw new Error('File not found');
    if (!file.raw_transcript_id) throw new Error('File has no transcript');

    const db = platformDb();
    const versions = db.prepare(
        `SELECT id, version_no FROM transcript_version
          WHERE raw_transcript_id = ? AND version_no IN (?, ?)`
    ).all(file.raw_transcript_id, Number(versionNoA), Number(versionNoB));

    const byNo = new Map(versions.map((v) => [v.version_no, v]));
    const va = byNo.get(Number(versionNoA));
    const vb = byNo.get(Number(versionNoB));
    if (!va || !vb) throw new Error('Version not found');

    const editsA = loadEditsForVersion(db, va.id);
    const editsB = loadEditsForVersion(db, vb.id);

    const keysA = new Map(editsA.map((e) => [canonicalKey(e), e]));
    const keysB = new Map(editsB.map((e) => [canonicalKey(e), e]));

    const onlyInA = [];
    const onlyInB = [];
    const shared = [];
    for (const [key, edit] of keysA) {
        if (keysB.has(key)) shared.push(edit);
        else onlyInA.push(edit);
    }
    for (const [key, edit] of keysB) {
        if (!keysA.has(key)) onlyInB.push(edit);
    }

    return {
        from: { versionNo: Number(versionNoA), editCount: editsA.length },
        to:   { versionNo: Number(versionNoB), editCount: editsB.length },
        onlyInA,
        onlyInB,
        shared,
    };
}

// Restore a previous version by spawning a new draft seeded from its edit
// set. Per Q3 of slice 1: refuses with a "DIRTY_DRAFT" error when an existing
// draft has unsaved edits, unless the caller passes explicit handling
// (`existingDraft: 'save' | 'discard'`).
//
// Returns:
//   { newVersionNo, newVersionId, restoredFromVersionNo, existingDraftDisposition }
// Throws an error tagged with `code: 'DIRTY_DRAFT'` when the caller has a
// non-empty draft and didn't tell us what to do with it. The route layer
// translates that into HTTP 409.
export async function restoreVersion(fileId, versionNo, actor, { existingDraft = null } = {}) {
    const file = loadFileRow(fileId);
    if (!file) throw new Error('File not found');
    if (!file.raw_transcript_id) throw new Error('File has no transcript');

    const db = platformDb();
    const source = db.prepare(
        `SELECT id, version_no FROM transcript_version
          WHERE raw_transcript_id = ? AND version_no = ?`
    ).get(file.raw_transcript_id, Number(versionNo));
    if (!source) throw new Error('Version not found');

    const dirtyDraft = db.prepare(
        `SELECT tv.id, tv.version_no,
                (SELECT COUNT(*) FROM transcript_edit te WHERE te.version_id = tv.id) AS edit_count
           FROM transcript_version tv
          WHERE tv.raw_transcript_id = ? AND tv.is_current = 1`
    ).get(file.raw_transcript_id);

    if (dirtyDraft && dirtyDraft.edit_count > 0 && !existingDraft) {
        const err = new Error(
            'A draft with unsaved edits exists. Decide how to handle it before restoring.'
        );
        err.code = 'DIRTY_DRAFT';
        err.draftVersionNo = dirtyDraft.version_no;
        err.draftEditCount = dirtyDraft.edit_count;
        throw err;
    }
    if (dirtyDraft && existingDraft && !['save', 'discard'].includes(existingDraft)) {
        throw new Error(
            `Invalid existingDraft directive ${JSON.stringify(existingDraft)}; expected 'save' or 'discard'.`
        );
    }

    const tx = db.transaction(() => {
        let disposition = null;

        // Compute nextNo BEFORE any draft mutation so that hard-deleting a
        // discarded draft can't free up its version_no for reuse. Version
        // numbers must monotonically increase even across discards.
        const nextNo = db.prepare(
            `SELECT COALESCE(MAX(version_no), 0) + 1 AS n
               FROM transcript_version WHERE raw_transcript_id = ?`
        ).get(file.raw_transcript_id).n;

        if (dirtyDraft) {
            if (existingDraft === 'save') {
                // Freeze the dirty draft as label='draft', is_current=0,
                // frozen_at stamped. The label stays 'draft' to mark this
                // as a preserved-but-not-submitted version (vs. a
                // 'submitted' / 'approved' / etc. via the review pipeline).
                db.prepare(
                    `UPDATE transcript_version
                        SET is_current = 0,
                            frozen_at = COALESCE(frozen_at, datetime('now'))
                      WHERE id = ?`
                ).run(dirtyDraft.id);
                disposition = 'saved';
            } else if (dirtyDraft.edit_count > 0) {
                // Discard a non-empty draft: delete the draft's edit rows
                // AND the draft version row itself. Edits in a draft are
                // uncommitted — discarding them is permitted by the
                // data-model invariant ("never delete a COMMITTED edit row").
                db.prepare(`DELETE FROM transcript_edit WHERE version_id = ?`).run(dirtyDraft.id);
                db.prepare(`DELETE FROM transcript_version WHERE id = ?`).run(dirtyDraft.id);
                disposition = 'discarded';
            } else {
                // Empty draft — silently delete; nothing meaningful to preserve.
                db.prepare(`DELETE FROM transcript_version WHERE id = ?`).run(dirtyDraft.id);
                disposition = 'discarded-empty';
            }
        }

        const ins = db.prepare(
            `INSERT INTO transcript_version
                 (raw_transcript_id, version_no, parent_version_id,
                  label, is_current, created_by)
             VALUES (?, ?, ?, 'restored', 1, ?)`
        ).run(file.raw_transcript_id, nextNo, source.id, actor?.id ?? 'system');
        const newVersionId = ins.lastInsertRowid;

        // Physical copy of the source's edits into the new draft. Pointer-
        // sharing rows would be wrong: edits belong to exactly one version.
        const sourceEdits = db.prepare(
            `SELECT start_char, content, operation, editor_id, edited_at
               FROM transcript_edit WHERE version_id = ? ORDER BY edited_at, id`
        ).all(source.id);

        const insEdit = db.prepare(
            `INSERT INTO transcript_edit
                (raw_transcript_id, version_id, start_char, content,
                 operation, editor_id, edited_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const e of sourceEdits) {
            insEdit.run(
                file.raw_transcript_id, newVersionId,
                e.start_char, e.content, e.operation,
                e.editor_id, e.edited_at,
            );
        }

        return { newVersionNo: nextNo, newVersionId, disposition };
    });
    const result = tx();

    recordAuditEvent({
        fileId: file.external_id || String(file.id),
        actor,
        actionKey: 'version_restored',
        details: {
            from: Number(versionNo),
            to: result.newVersionNo,
            existingDraftDisposition: result.disposition,
        },
    });

    await invalidateDetail(file.external_id || String(file.id));

    return {
        newVersionNo: result.newVersionNo,
        restoredFromVersionNo: Number(versionNo),
        existingDraftDisposition: result.disposition,
    };
}
