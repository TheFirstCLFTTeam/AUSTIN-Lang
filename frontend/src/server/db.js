import 'server-only';

import path from 'node:path';
import Database from 'better-sqlite3';

// In Docker the compose file mounts the seeded SQLite files at /db/*.db.
// Outside Docker (npm run dev) the DBs live next to the repo at
// ../database(FE)/*.db relative to the frontend project.
const DEFAULT_USERS_DB = path.resolve(process.cwd(), '../database(FE)/users.db');
const DEFAULT_PLATFORM_DB = path.resolve(process.cwd(), '../database(FE)/platform.db');

const USERS_DB_PATH = process.env.USERS_DB_PATH || DEFAULT_USERS_DB;
const PLATFORM_DB_PATH = process.env.PLATFORM_DB_PATH || DEFAULT_PLATFORM_DB;

let _users = null;
let _platform = null;

function open(file) {
    let db;
    try {
        db = new Database(file, { fileMustExist: true });
    } catch (err) {
        // Surface the two common operator failures with a tag the route layer
        // can map to a useful HTTP status + message instead of a bare 500.
        if (err && err.code === 'SQLITE_CANTOPEN') {
            const e = new Error(`SQLite file not found at ${file}. Run \`python database(FE)/seed/seed_users_db.py\` to create it, or set USERS_DB_PATH.`);
            e.code = 'DB_FILE_MISSING';
            throw e;
        }
        if (err && /bindings file|NODE_MODULE_VERSION/i.test(err.message || '')) {
            const e = new Error(`better-sqlite3 native binding failed to load for Node ${process.version}. Run \`npm rebuild better-sqlite3\` from frontend/.`);
            e.code = 'DB_BINDING_BROKEN';
            throw e;
        }
        throw err;
    }
    // WAL mode misbehaves on Windows→Linux Docker Desktop bind mounts — writes
    // go to an in-memory WAL that never flushes back to disk. Stick with the
    // classic rollback journal — it's correct on every filesystem.
    db.pragma('journal_mode = DELETE');
    db.pragma('foreign_keys = ON');
    return db;
}

export function usersDb() {
    if (!_users) _users = open(USERS_DB_PATH);
    return _users;
}

export function platformDb() {
    if (!_platform) _platform = open(PLATFORM_DB_PATH);
    return _platform;
}
