-- ============================================================================
-- users.db — identity-only schema for AUSTIN-Lang.
--
-- Holds login-capable operators, their profile metadata, active sessions,
-- profile-embedded permission labels, and the external client (banking
-- customer) catalogue. Group membership and app-level permissions live in
-- platform.db and reference user.id / client.id as plain TEXT (no cross-db FK
-- is supported in SQLite; integrity is enforced at the application layer).
-- ============================================================================

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS user_permission_grant;
DROP TABLE IF EXISTS user_permission_group;
DROP TABLE IF EXISTS user_notification_pref;
DROP TABLE IF EXISTS user_recording_daily;
DROP TABLE IF EXISTS user_session;
DROP TABLE IF EXISTS user_profile;
DROP TABLE IF EXISTS user_access_right;
DROP TABLE IF EXISTS client_language;
DROP TABLE IF EXISTS client;
DROP TABLE IF EXISTS "user";

-- ---------------------------------------------------------------------------
-- user / user_profile
-- ---------------------------------------------------------------------------

CREATE TABLE "user" (
    id                TEXT PRIMARY KEY,              -- 'u1'..'u4'
    email             TEXT NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,                 -- bcrypt
    name              TEXT NOT NULL,
    role              TEXT NOT NULL CHECK (role IN ('generic','engineer','admin','reviewer')),
    company           TEXT,
    file_org_group    TEXT,                          -- legacy folders.js group id
    is_control_member INTEGER NOT NULL DEFAULT 0,    -- 0/1 boolean
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_profile (
    user_id            TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
    display_name       TEXT,
    profile_pic        TEXT,                         -- asset path, e.g. /04UserPFP.png
    designation        TEXT,
    employee_id        TEXT,
    department         TEXT,
    recordings_total   INTEGER DEFAULT 0,
    locale_primary     TEXT,
    locale_secondary   TEXT,
    security_status    TEXT,
    mfa_enabled        INTEGER NOT NULL DEFAULT 0
);

-- Daily recordings-handled breakdown, one row per (user, weekday).
CREATE TABLE user_recording_daily (
    user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    day_label  TEXT NOT NULL,                        -- Mon/Tue/Wed/Thu/Fri
    count      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day_label)
);

-- Notification preference labels, one row per preference.
CREATE TABLE user_notification_pref (
    user_id  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    pref     TEXT NOT NULL,
    PRIMARY KEY (user_id, pref)
);

-- Active sessions per user, as surfaced in the profile view.
CREATE TABLE user_session (
    id         TEXT PRIMARY KEY,                     -- 'sess-001' etc.
    user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,                        -- IP / host label
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Profile-embedded permission GROUPS (display-layer labels only — not the same
-- as platform.db user_group/permissions which are behavioural policies).
CREATE TABLE user_permission_group (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,                        -- 'ML Engineer - Level 3' etc.
    is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE user_permission_grant (
    permission_group_id INTEGER NOT NULL REFERENCES user_permission_group(id) ON DELETE CASCADE,
    permission_label    TEXT NOT NULL,
    PRIMARY KEY (permission_group_id, permission_label)
);

-- Coarse access-right labels (not used currently, but present in mock schema
-- for completeness and future wiring).
CREATE TABLE user_access_right (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    level    TEXT
);

-- ---------------------------------------------------------------------------
-- client (banking customers who appear on recordings — non-login)
-- ---------------------------------------------------------------------------

CREATE TABLE client (
    id                TEXT PRIMARY KEY,              -- 'c1'..'c4'
    name              TEXT NOT NULL,
    company           TEXT,
    relationship      TEXT,
    relationship_id   TEXT,
    region            TEXT,
    risk_level        TEXT CHECK (risk_level IN ('standard','elevated','high')),
    call_frequency    TEXT CHECK (call_frequency IN ('occasional','regular','frequent')),
    primary_activity  TEXT
);

CREATE TABLE client_language (
    client_id TEXT NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    language  TEXT NOT NULL,
    PRIMARY KEY (client_id, language)
);

CREATE INDEX ix_client_region ON client(region);
CREATE INDEX ix_user_role ON "user"(role);
