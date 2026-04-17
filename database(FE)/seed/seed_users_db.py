"""Seed database(FE)/users.db from seed/fixtures/*.json.

Run from repo root or from database(FE)/:
    python database(FE)/seed/seed_users_db.py

Drops + recreates every table in users.db, then inserts identity rows:
  user, user_profile, user_recording_daily, user_notification_pref,
  user_session, user_permission_group, user_permission_grant,
  user_access_right, client, client_language.

Passwords are bcrypt-hashed before insert. Plaintext is the value from
the mock fixtures (currently 'password123' for all four personas).
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from hashing import hash_password  # noqa: E402

DB_DIR = HERE.parent
DB_PATH = DB_DIR / "users.db"
SCHEMA_PATH = DB_DIR / "schema_users.sql"
FIXTURES = HERE / "fixtures"


def load_fixture(name: str):
    path = FIXTURES / f"{name}.json"
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def rebuild_schema(conn: sqlite3.Connection) -> None:
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema_sql)


def seed_users(conn: sqlite3.Connection, users: list[dict]) -> None:
    rows = []
    for u in users:
        rows.append((
            u["id"],
            u["email"],
            hash_password(u["password"]),
            u["name"],
            u["role"],
            u.get("company"),
            u.get("fileOrgGroup"),
            1 if u.get("isControlMember") else 0,
        ))
    conn.executemany(
        """INSERT INTO "user"
           (id, email, password_hash, name, role, company, file_org_group, is_control_member)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )


def seed_profiles(conn: sqlite3.Connection, profiles: dict[str, dict]) -> None:
    profile_rows, daily_rows, pref_rows = [], [], []
    session_rows, pg_rows, grant_rows = [], [], []

    for user_id, prof in profiles.items():
        profile_rows.append((
            user_id,
            prof.get("name"),
            prof.get("profilePic"),
            prof.get("designation"),
            prof.get("employeeId"),
            prof.get("department"),
            prof.get("recordingsHandled", {}).get("total", 0),
            prof.get("preferences", {}).get("localization", {}).get("primary"),
            prof.get("preferences", {}).get("localization", {}).get("secondary"),
            prof.get("security", {}).get("status"),
            1 if prof.get("security", {}).get("mfaEnabled") else 0,
        ))

        for d in prof.get("recordingsHandled", {}).get("daily", []):
            daily_rows.append((user_id, d["day"], d["count"]))

        for pref in prof.get("preferences", {}).get("notifications", []):
            pref_rows.append((user_id, pref))

        for sess in prof.get("security", {}).get("activeSessions", []):
            session_rows.append((sess["id"], user_id, sess["label"]))

        for group in prof.get("permissionGroups", []):
            cur = conn.execute(
                "INSERT INTO user_permission_group (user_id, name, is_primary) VALUES (?, ?, ?)",
                (user_id, group["name"], 1 if group.get("isPrimary") else 0),
            )
            pg_id = cur.lastrowid
            for perm in group.get("permissions", []):
                grant_rows.append((pg_id, perm))

    conn.executemany(
        """INSERT INTO user_profile (
             user_id, display_name, profile_pic, designation, employee_id,
             department, recordings_total, locale_primary, locale_secondary,
             security_status, mfa_enabled
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        profile_rows,
    )
    conn.executemany(
        "INSERT INTO user_recording_daily (user_id, day_label, count) VALUES (?, ?, ?)",
        daily_rows,
    )
    conn.executemany(
        "INSERT INTO user_notification_pref (user_id, pref) VALUES (?, ?)",
        pref_rows,
    )
    conn.executemany(
        "INSERT INTO user_session (id, user_id, label) VALUES (?, ?, ?)",
        session_rows,
    )
    conn.executemany(
        "INSERT INTO user_permission_grant (permission_group_id, permission_label) VALUES (?, ?)",
        grant_rows,
    )


def seed_clients(conn: sqlite3.Connection, clients: list[dict]) -> None:
    client_rows, language_rows = [], []
    for c in clients:
        client_rows.append((
            c["id"],
            c["name"],
            c.get("company"),
            c.get("relationship"),
            c.get("relationshipId"),
            c.get("region"),
            c.get("riskLevel"),
            c.get("callFrequency"),
            c.get("primaryActivity"),
        ))
        for lang in c.get("languages", []):
            language_rows.append((c["id"], lang))
    conn.executemany(
        """INSERT INTO client (
             id, name, company, relationship, relationship_id, region,
             risk_level, call_frequency, primary_activity
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        client_rows,
    )
    conn.executemany(
        "INSERT INTO client_language (client_id, language) VALUES (?, ?)",
        language_rows,
    )


def count(conn: sqlite3.Connection, table: str) -> int:
    return conn.execute(f"SELECT COUNT(*) FROM \"{table}\"").fetchone()[0]


def main() -> None:
    if not SCHEMA_PATH.exists():
        raise SystemExit(f"schema missing: {SCHEMA_PATH}")
    if not FIXTURES.exists():
        raise SystemExit(f"fixtures missing: {FIXTURES} — run `npm run dump` first")

    users = load_fixture("users")
    profiles = load_fixture("user_profiles")
    clients = load_fixture("clients")

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        rebuild_schema(conn)
        with conn:
            seed_users(conn, users)
            seed_profiles(conn, profiles)
            seed_clients(conn, clients)

        print(f"users.db seeded -> {DB_PATH}")
        for t in (
            "user", "user_profile", "user_recording_daily",
            "user_notification_pref", "user_session",
            "user_permission_group", "user_permission_grant",
            "client", "client_language",
        ):
            print(f"  {t.ljust(28)} {count(conn, t):>6}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
