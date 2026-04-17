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
    const db = new Database(file, { fileMustExist: true });
    db.pragma('journal_mode = WAL');
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
