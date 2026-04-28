import 'server-only';

import { platformDb } from './db';

// Audit-event recorder. Same method as the FastAPI/database service: insert one
// row per user activity into platform.db `audit_event`, with action_key being a
// FK into the `audit_action` catalog. Free-form per-action data goes into
// details_json so each event is a self-describing string of user activity.
//
// Catalog keys live in database(FE)/seed/fixtures/audit_actions.json and are
// loaded by the seed script. The auth-event keys (login_succeeded /
// login_failed / logout) are also upserted at module load so login can be
// audited even on DBs seeded before those keys existed.

const AUTH_EVENT_KEYS = [
    { key: 'login_succeeded', label: 'Login succeeded', verb: 'signed in', category: 'Auth', color: '#1a7f37' },
    { key: 'login_failed', label: 'Login failed', verb: 'tried to sign in with the wrong credentials', category: 'Auth', color: '#b20100' },
    { key: 'logout', label: 'Logout', verb: 'signed out', category: 'Auth', color: '#7a7574' },
];

let _catalogEnsured = false;
function ensureAuthCatalog() {
    if (_catalogEnsured) return;
    const stmt = platformDb().prepare(
        `INSERT OR IGNORE INTO audit_action (key, label, verb, category, color)
         VALUES (?, ?, ?, ?, ?)`
    );
    for (const a of AUTH_EVENT_KEYS) {
        stmt.run(a.key, a.label, a.verb, a.category, a.color);
    }
    _catalogEnsured = true;
}

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
    ensureAuthCatalog();
    const id = nextId(fileId);
    const timestamp = new Date().toISOString();
    const actorId = actor?.id ?? 'system';
    const actorName = actor?.name ?? 'System';
    const detailsJson = details ? JSON.stringify(details) : null;
    getInsertStmt().run(id, fileId, actorId, actorName, actionKey, timestamp, detailsJson);
    return { id, timestamp };
}
