import 'server-only';

import { platformDb, usersDb } from './db';
import { recordAuditEvent } from './audit';
import { invalidateDetail } from './cache';
import { applyEdits } from '../lib/transcriptEdits';

// URL of the backend database service (poc.db, FastAPI at :8002). It's the
// canonical transcript store that the retraining pipeline reads from, so
// edits MUST reach it — not just platform.db.
const BACKEND_DB_URL =
    process.env.BACKEND_DB_URL || 'http://database:8002';

// Build the UI-facing file shape from a platform.db `audio_file` row.
// Owner names come from users.db (separate SQLite file — no cross-DB JOIN).
function ownerNameMap(ownerIds) {
    if (ownerIds.size === 0) return new Map();
    const placeholders = Array.from(ownerIds).map(() => '?').join(',');
    const rows = usersDb()
        .prepare(
            `SELECT id, name FROM "user" WHERE id IN (${placeholders})`
        )
        .all(...ownerIds);
    return new Map(rows.map((r) => [r.id, r.name]));
}

function fileIdOf(row) {
    // external_id is the UI-facing string id; fall back to the int id when
    // rows were inserted without one (e.g. newly uploaded files).
    return row.external_id || String(row.id);
}

function transcriptHeaderOf(segments) {
    const full = (segments || []).map((s) => s.text || '').join(' ');
    const words = full.split(/\s+/).filter(Boolean);
    return words.length > 1 ? words.slice(0, 50).join(' ') : full.slice(0, 120);
}

function rowToListItem(row, ownerNames) {
    return {
        id: fileIdOf(row),
        name: row.display_name || row.file_name,
        audioUrl: row.audio_rel_path || null,
        uploaded_at: row.uploaded_at,
        ownerId: row.owner_id,
        ownerName: ownerNames.get(row.owner_id) || null,
        duration: row.duration_label || null,
        detectedLanguage: row.detected_language || null,
        dataset: row.dataset_id || null,
        status: row.status || 'needs action',
        stage: row.stage || null,
        sourceProvider: row.source_provider || null,
        // UI slots that have no DB column yet. Null keeps the component happy
        // without making up fake numbers.
        wer: null,
        absoluteWordErrorRate: null,
        totalNumberOfWords: null,
        speakerDetection: null,
        compliance: null,
        reviewerId: null,
        submittedForReviewAt: null,
        transcriptHeader: null, // populated below for pages that need it
    };
}

export function listAudioFiles() {
    const rows = platformDb()
        .prepare(
            `SELECT id, external_id, file_name, display_name, uploaded_at, owner_id,
                    duration_sec, duration_label, detected_language, dataset_id,
                    status, stage, audio_rel_path, source_provider
               FROM audio_file
              ORDER BY uploaded_at DESC`
        )
        .all();

    const ownerIds = new Set(rows.map((r) => r.owner_id).filter(Boolean));
    const ownerNames = ownerNameMap(ownerIds);

    // Transcript header per file: take the first raw_transcript's first 50 words.
    // Keep this a single query (no N+1) by grouping in JS.
    const headerRows = platformDb()
        .prepare(
            `SELECT rt.audio_file_id, rts.text, rts.start
               FROM raw_transcript rt
               JOIN raw_transcript_segment rts ON rts.raw_transcript_id = rt.id
              ORDER BY rt.audio_file_id, rts.start`
        )
        .all();
    const segsByFile = new Map();
    for (const h of headerRows) {
        let arr = segsByFile.get(h.audio_file_id);
        if (!arr) { arr = []; segsByFile.set(h.audio_file_id, arr); }
        arr.push({ text: h.text });
    }

    return rows.map((r) => {
        const item = rowToListItem(r, ownerNames);
        item.transcriptHeader = transcriptHeaderOf(segsByFile.get(r.id));
        return item;
    });
}

export function getAudioFileDetail(externalOrIntId) {
    const db = platformDb();
    const row = db
        .prepare(
            `SELECT id, external_id, file_name, display_name, uploaded_at, owner_id,
                    duration_sec, duration_label, detected_language, dataset_id,
                    status, stage, audio_rel_path,
                    source_provider, source_recording_id, source_meeting_id,
                    source_organiser
               FROM audio_file
              WHERE external_id = ? OR id = ?`
        )
        .get(String(externalOrIntId), Number(externalOrIntId) || -1);
    if (!row) return null;

    const rawTranscript = db
        .prepare(
            `SELECT id, audio_file_id, rating, created_at
               FROM raw_transcript WHERE audio_file_id = ? ORDER BY id LIMIT 1`
        )
        .get(row.id);

    let segments = [];
    if (rawTranscript) {
        segments = db
            .prepare(
                `SELECT id, start, end, text FROM raw_transcript_segment
                  WHERE raw_transcript_id = ? ORDER BY start`
            )
            .all(rawTranscript.id);
    }

    // Edit rows use a JSON-in-content encoding (see writeEditsForFile below).
    // Read the draft (is_current=1) if one exists; otherwise fall back to
    // the most recent frozen version. This keeps the user looking at their
    // working copy when there is one and the latest committed state when
    // there isn't.
    let edits = [];
    if (rawTranscript) {
        const rows = db
            .prepare(
                `SELECT te.content
                   FROM transcript_edit te
                   JOIN transcript_version tv ON tv.id = te.version_id
                  WHERE tv.raw_transcript_id = ?
                    AND tv.id = COALESCE(
                        (SELECT id FROM transcript_version
                          WHERE raw_transcript_id = ? AND is_current = 1),
                        (SELECT id FROM transcript_version
                          WHERE raw_transcript_id = ?
                          ORDER BY version_no DESC LIMIT 1)
                    )
                  ORDER BY te.edited_at, te.id`
            )
            .all(rawTranscript.id, rawTranscript.id, rawTranscript.id);
        for (const r of rows) {
            try {
                const parsed = JSON.parse(r.content);
                if (parsed && typeof parsed === 'object') edits.push(parsed);
            } catch { /* skip malformed */ }
        }
    }

    const ownerNames = ownerNameMap(new Set([row.owner_id].filter(Boolean)));

    return {
        ...rowToListItem(row, ownerNames),
        transcriptHeader: transcriptHeaderOf(segments),
        rawTranscript: rawTranscript
            ? {
                  id: rawTranscript.id,
                  audio_file_id: rawTranscript.audio_file_id,
                  transcript_segments: segments,
              }
            : null,
        edits,
        source: row.source_provider ? {
            provider: row.source_provider,
            recordingId: row.source_recording_id,
            meetingId: row.source_meeting_id,
            organiser: row.source_organiser,
        } : null,
    };
}

// Mirrors a freshly uploaded file into platform.db. The orchestrator has
// already persisted the raw transcript to poc.db at :8002 and handed us back
// the integer IDs; we stash those on the platform row so subsequent edits
// can be pushed back to the canonical store.
//
// `source` is optional provider attribution for webhook-ingested recordings
// (Zoom / Teams / google_meet / generic / …). When present + a row already
// exists for the same (provider, recording_id), we treat it as a duplicate
// webhook delivery and return the existing detail rather than re-inserting.
export function registerUploadedFile({
    fileName,
    owner,
    backend,
    segments,
    detectedLanguage,
    source = null,
}) {
    const db = platformDb();
    const externalId = `upl-${backend.audioFileId}`;
    const audioRelPath = `http://localhost:8000/audio_files/${fileName}`;

    // Webhook idempotency: if we've already mirrored this exact (provider,
    // recording_id), return the existing detail rather than re-inserting.
    // The unique index ux_audio_file_provider_rec also enforces this at the
    // SQL layer; the early exit lets us return a usable payload to the caller.
    if (source?.provider && source?.recordingId) {
        const existing = db.prepare(
            `SELECT external_id FROM audio_file
              WHERE source_provider = ? AND source_recording_id = ?`
        ).get(source.provider, String(source.recordingId));
        if (existing?.external_id) {
            return getAudioFileDetail(existing.external_id);
        }
    }

    const insert = db.transaction(() => {
        const afInfo = db
            .prepare(
                `INSERT INTO audio_file (
                     file_name, external_id, display_name, owner_id,
                     detected_language, audio_rel_path, status, stage,
                     backend_audio_file_id, backend_raw_transcript_id,
                     backend_edited_transcript_id,
                     source_provider, source_recording_id,
                     source_meeting_id, source_organiser
                 )
                 VALUES (?, ?, ?, ?, ?, ?, 'needs action', 'uploaded', ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                fileName,
                externalId,
                fileName,
                owner?.id || null,
                detectedLanguage,
                audioRelPath,
                backend.audioFileId,
                backend.rawTranscriptId,
                backend.editedTranscriptId,
                source?.provider || null,
                source?.recordingId ? String(source.recordingId) : null,
                source?.meetingId  ? String(source.meetingId)  : null,
                source?.organiser  || null,
            );
        const audioFileId = afInfo.lastInsertRowid;

        const rtInfo = db
            .prepare(
                `INSERT INTO raw_transcript (audio_file_id, rating) VALUES (?, 0)`
            )
            .run(audioFileId);
        const rawTranscriptId = rtInfo.lastInsertRowid;

        const segIns = db.prepare(
            `INSERT INTO raw_transcript_segment (raw_transcript_id, start, end, text)
             VALUES (?, ?, ?, ?)`
        );
        for (const seg of segments) {
            segIns.run(
                rawTranscriptId,
                Number(seg.start ?? 0),
                Number(seg.end ?? 0),
                String(seg.text ?? ''),
            );
        }

        return audioFileId;
    });

    insert();

    recordAuditEvent({
        fileId: externalId,
        actor: owner,
        actionKey: 'uploaded',
        details: { fileName },
    });

    return getAudioFileDetail(externalId);
}

// Pushes the edited segments back to the backend database service so the
// retraining pipeline sees them. Non-fatal on failure: platform.db remains
// the source of truth for the UI; a failed co-write just means retraining
// will miss this round of corrections.
async function coWriteEditedTranscriptToBackend(
    backendRawTranscriptId,
    backendEditedTranscriptId,
    editedSegments,
) {
    if (!backendEditedTranscriptId || !backendRawTranscriptId) return;
    const payload = {
        raw_transcript_id: backendRawTranscriptId,
        is_user_edited: 1,
        transcript_segments: editedSegments.map((s) => ({
            start: Number(s.start ?? 0),
            end: Number(s.end ?? 0),
            text: String(s.text ?? ''),
        })),
    };
    try {
        const res = await fetch(
            `${BACKEND_DB_URL}/edited-transcripts/${backendEditedTranscriptId}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
        );
        if (!res.ok) {
            console.warn(
                `[edits] backend co-write failed: HTTP ${res.status} ${await res.text().catch(() => '')}`,
            );
        }
    } catch (err) {
        console.warn(`[edits] backend co-write unreachable: ${err.message}`);
    }
}

// Find-or-create the current draft version for a raw_transcript. The partial
// unique index ux_transcript_version_current serialises concurrent inserts at
// the SQL level — we still need the lookup-then-insert dance because there's
// no UPSERT on a partial index.
function findOrCreateDraftVersion(db, rawTranscriptId, actor) {
    const existing = db.prepare(
        `SELECT id, version_no FROM transcript_version
          WHERE raw_transcript_id = ? AND is_current = 1`
    ).get(rawTranscriptId);
    if (existing) return existing;

    const nextNo = db.prepare(
        `SELECT COALESCE(MAX(version_no), 0) + 1 AS n
           FROM transcript_version WHERE raw_transcript_id = ?`
    ).get(rawTranscriptId).n;

    // Find the most recent frozen version (if any) so the new draft's
    // parent_version_id records the lineage.
    const parent = db.prepare(
        `SELECT id FROM transcript_version
          WHERE raw_transcript_id = ? AND is_current = 0
          ORDER BY version_no DESC LIMIT 1`
    ).get(rawTranscriptId);

    const info = db.prepare(
        `INSERT INTO transcript_version
             (raw_transcript_id, version_no, parent_version_id,
              label, is_current, created_by)
         VALUES (?, ?, ?, 'draft', 1, ?)`
    ).run(rawTranscriptId, nextNo, parent?.id ?? null, actor?.id ?? 'system');

    return { id: info.lastInsertRowid, version_no: nextNo };
}

// Replaces the edits list for a file's raw transcript by mutating the draft
// version only — frozen versions' rows are protected by the WHERE
// version_id = <draft.id> guard and are never touched.
//
// Each UI edit is stored as a single row in `transcript_edit` with the full
// edit JSON-encoded into the `content` column — a pragmatic overload because
// the char-level schema can't losslessly express the UI's word-level edit
// shape (TODO: align).
//
// Backend co-write to poc.db is NOT done here (see freezeAndCoWrite in
// setAudioFileStatus): the retraining pipeline only sees committed
// corrections, never in-progress drafts.
export async function writeEditsForFile(fileId, edits, actor) {
    const db = platformDb();
    const row = db
        .prepare(
            `SELECT af.id, af.external_id, rt.id AS raw_transcript_id
               FROM audio_file af
               LEFT JOIN raw_transcript rt ON rt.audio_file_id = af.id
              WHERE af.external_id = ? OR af.id = ?`
        )
        .get(String(fileId), Number(fileId) || -1);
    if (!row) throw new Error('File not found');
    if (!row.raw_transcript_id) {
        throw new Error('File has no raw_transcript; cannot store edits');
    }

    const tx = db.transaction((items) => {
        const draft = findOrCreateDraftVersion(db, row.raw_transcript_id, actor);

        // Mutate ONLY the draft. The WHERE version_id = ? clause is the
        // load-bearing guard — frozen versions are never matched.
        db.prepare(`DELETE FROM transcript_edit WHERE version_id = ?`).run(draft.id);

        const ins = db.prepare(
            `INSERT INTO transcript_edit
                (raw_transcript_id, version_id, start_char, content,
                 operation, editor_id, edited_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const e of items) {
            ins.run(
                row.raw_transcript_id,
                draft.id,
                typeof e.wordIndex === 'number' ? e.wordIndex : 0,
                JSON.stringify(e),
                e.op === 'delete' ? 'delete' : 'add',
                actor?.id ?? null,
                e.editedAt || new Date().toISOString(),
            );
        }
        return draft;
    });
    const draft = tx(edits || []);

    recordAuditEvent({
        fileId: row.external_id || String(row.id),
        actor,
        actionKey: 'edited',
        details: { editCount: (edits || []).length, versionNo: draft.version_no },
    });

    // Cache invalidation. Fail-open — if Redis is down, cache miss next read
    // and we eat one cold SQLite hit.
    await invalidateDetail(row.external_id || String(row.id));
}

// Maps an audit_action key to the transcript_version label that should be
// stamped on the draft when this status transition fires. Returning null
// means "this transition does not freeze the draft" — most edits, deletes,
// uploads, etc.
function freezeLabelFor(actionKey) {
    switch (actionKey) {
        case 'submitted_for_review': return 'submitted';
        case 'approved':             return 'approved';
        case 'requested_changes':    return 'changes_requested';
        default:                     return null;
    }
}

// Updates audio_file.status, freezes the current draft if the transition
// calls for it, records an audit event, and (on freeze only) co-writes the
// applied transcript to poc.db so the retraining pipeline sees the
// committed correction. Caller provides the audit_action key (must exist
// in audit_action catalog) and any free-form details that will be
// JSON-encoded into audit_event.details_json.
//
// Async because the co-write to the backend service is best-effort but
// awaited so failures are visible in the route's response.
export async function setAudioFileStatus(fileId, newStatus, actor, { actionKey, details }) {
    const db = platformDb();
    const row = db
        .prepare(
            `SELECT af.id, af.external_id, rt.id AS raw_transcript_id,
                    af.backend_raw_transcript_id AS backend_rt_id,
                    af.backend_edited_transcript_id AS backend_et_id
               FROM audio_file af
               LEFT JOIN raw_transcript rt ON rt.audio_file_id = af.id
              WHERE af.external_id = ? OR af.id = ?`
        )
        .get(String(fileId), Number(fileId) || -1);
    if (!row) throw new Error('File not found');

    const externalId = row.external_id || String(row.id);
    const freezeLabel = freezeLabelFor(actionKey);

    let frozenVersionNo = null;
    let appliedSegmentsForCoWrite = null;

    const tx = db.transaction(() => {
        db.prepare(`UPDATE audio_file SET status = ? WHERE id = ?`).run(newStatus, row.id);

        if (freezeLabel && row.raw_transcript_id) {
            const draft = db.prepare(
                `SELECT id, version_no FROM transcript_version
                  WHERE raw_transcript_id = ? AND is_current = 1`
            ).get(row.raw_transcript_id);

            if (draft) {
                db.prepare(
                    `UPDATE transcript_version
                        SET label = ?, is_current = 0,
                            frozen_at = COALESCE(frozen_at, datetime('now'))
                      WHERE id = ?`
                ).run(freezeLabel, draft.id);
                frozenVersionNo = draft.version_no;

                // Capture the segment state of the just-frozen version so
                // we can co-write it to the backend after the transaction
                // commits. Reading inside the txn keeps it consistent with
                // what we just froze.
                const rawSegments = db.prepare(
                    `SELECT id, start, end, text FROM raw_transcript_segment
                      WHERE raw_transcript_id = ? ORDER BY start`
                ).all(row.raw_transcript_id);

                const editRows = db.prepare(
                    `SELECT content FROM transcript_edit
                      WHERE version_id = ? ORDER BY edited_at, id`
                ).all(draft.id);

                const edits = [];
                for (const r of editRows) {
                    try {
                        const parsed = JSON.parse(r.content);
                        if (parsed && typeof parsed === 'object') edits.push(parsed);
                    } catch { /* skip malformed */ }
                }
                appliedSegmentsForCoWrite = applyEdits(rawSegments, edits);
            }
            // No draft = nothing to freeze (e.g. approve on a file that
            // was already approved-with-no-edits earlier). Silent no-op.
        }

        recordAuditEvent({
            fileId: externalId,
            actor,
            actionKey,
            details: frozenVersionNo == null
                ? details
                : { ...(details || {}), versionNo: frozenVersionNo },
        });
    });
    tx();

    // Co-write OUTSIDE the SQLite transaction — network I/O must not hold
    // the DB write lock. Failure is non-fatal (poc.db just lags by one
    // freeze; retraining will pick up the next one).
    if (appliedSegmentsForCoWrite) {
        await coWriteEditedTranscriptToBackend(
            row.backend_rt_id,
            row.backend_et_id,
            appliedSegmentsForCoWrite,
        );
    }

    await invalidateDetail(externalId);

    return { id: externalId, status: newStatus, versionNo: frozenVersionNo };
}
