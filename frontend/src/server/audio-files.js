import 'server-only';

import { platformDb, usersDb } from './db';
import { recordAuditEvent } from './audit';

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
                    status, stage, audio_rel_path
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
                    status, stage, audio_rel_path
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
    let edits = [];
    if (rawTranscript) {
        const rows = db
            .prepare(
                `SELECT content FROM transcript_edit
                  WHERE raw_transcript_id = ? ORDER BY edited_at, id`
            )
            .all(rawTranscript.id);
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
    };
}

// Replaces the edits list for a file's raw transcript. Each UI edit is stored
// as a single row in `transcript_edit` with the full edit JSON-encoded into
// the `content` column — a pragmatic overload because the char-level schema
// can't losslessly express the UI's word-level edit shape (TODO: align).
export function writeEditsForFile(fileId, edits, actor) {
    const db = platformDb();
    const row = db
        .prepare(
            `SELECT af.id, rt.id AS raw_transcript_id
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
        db.prepare(`DELETE FROM transcript_edit WHERE raw_transcript_id = ?`).run(
            row.raw_transcript_id
        );
        const ins = db.prepare(
            `INSERT INTO transcript_edit
                (raw_transcript_id, start_char, content, operation, editor_id, edited_at)
             VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const e of items) {
            ins.run(
                row.raw_transcript_id,
                typeof e.wordIndex === 'number' ? e.wordIndex : 0,
                JSON.stringify(e),
                e.op === 'delete' ? 'delete' : 'add',
                actor?.id ?? null,
                e.editedAt || new Date().toISOString(),
            );
        }
    });
    tx(edits || []);

    const externalId = db
        .prepare(`SELECT external_id FROM audio_file WHERE id = ?`)
        .get(row.id)?.external_id || String(row.id);

    recordAuditEvent({
        fileId: externalId,
        actor,
        actionKey: 'edited',
        details: { editCount: (edits || []).length },
    });
}

// Updates audio_file.status and records an audit event. Caller provides the
// audit_action key (must exist in audit_action catalog) and any free-form
// details that will be JSON-encoded into audit_event.details_json.
export function setAudioFileStatus(fileId, newStatus, actor, { actionKey, details }) {
    const db = platformDb();
    const row = db
        .prepare(
            `SELECT id, external_id FROM audio_file WHERE external_id = ? OR id = ?`
        )
        .get(String(fileId), Number(fileId) || -1);
    if (!row) throw new Error('File not found');

    const externalId = row.external_id || String(row.id);
    const tx = db.transaction(() => {
        db.prepare(`UPDATE audio_file SET status = ? WHERE id = ?`).run(newStatus, row.id);
        recordAuditEvent({
            fileId: externalId,
            actor,
            actionKey,
            details,
        });
    });
    tx();

    return { id: externalId, status: newStatus };
}
