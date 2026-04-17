import 'server-only';

import { platformDb } from './db';

// Audit-event recorder. Same method as the FastAPI/database service: insert one
// row per user activity into platform.db `audit_event`, with action_key being a
// FK into the `audit_action` catalog. Free-form per-action data goes into
// details_json so each event is a self-describing string of user activity.
//
// Caller is responsible for ensuring `actionKey` exists in audit_action — the
// FK will throw otherwise. Catalog keys (as seeded):
//   uploaded, transcribed, viewed, edited, submitted_for_review, approved,
//   requested_changes, privacy_flagged, pseudonymised, access_granted,
//   added_to_dataset, exported

const insertStmtCache = new Map();

function getInsertStmt() {
    const db = platformDb();
    let stmt = insertStmtCache.get(db);
    if (!stmt) {
        stmt = db.prepare(
            `INSERT INTO audit_event
                (id, file_id, actor_id, actor_name, action_key, timestamp, details_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        insertStmtCache.set(db, stmt);
    }
    return stmt;
}

function nextId(fileId) {
    // Match the seed convention: 'audit-<fileId>-<n>' where n is a per-file
    // counter. Seed IDs can be sparse so we take MAX(suffix)+1 rather than
    // COUNT to avoid collisions.
    if (!fileId) {
        return `audit-sys-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }
    const db = platformDb();
    const prefix = `audit-${fileId}-`;
    const row = db
        .prepare(
            `SELECT MAX(CAST(substr(id, ?) AS INTEGER)) AS max_n
               FROM audit_event
              WHERE file_id = ? AND id LIKE ?`
        )
        .get(prefix.length + 1, fileId, `${prefix}%`);
    const next = (row?.max_n || 0) + 1;
    return `${prefix}${next}`;
}

export function recordAuditEvent({
    fileId = null,
    actor,
    actionKey,
    details = null,
}) {
    if (!actionKey) throw new Error('recordAuditEvent: actionKey required');
    const id = nextId(fileId);
    const timestamp = new Date().toISOString();
    const actorId = actor?.id ?? 'system';
    const actorName = actor?.name ?? 'System';
    const detailsJson = details ? JSON.stringify(details) : null;
    getInsertStmt().run(id, fileId, actorId, actorName, actionKey, timestamp, detailsJson);
    return { id, timestamp };
}
