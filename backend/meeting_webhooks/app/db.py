"""SQLite-backed state for the meeting-webhooks service.

Three tables:
  connection      — one row per (user, provider) link, holds OAuth tokens and
                    provider-side identifiers (tenant_id, account_id).
  subscription    — Graph-only: provider subscription IDs + expiry, so the
                    renewal cron knows what to PATCH.
  recording_seen  — dedupe ledger keyed by (provider, external_recording_id).
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from typing import Any, Iterator, Optional

from .config import settings

_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None


SCHEMA = """
CREATE TABLE IF NOT EXISTS connection (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    provider        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    -- provider-side identifiers (tenant_id for Teams, account_id for Zoom)
    external_account TEXT,
    -- opaque JSON blob with tokens, refresh tokens, expiries. We KMS-wrap in
    -- prod; for dev SQLite is local-only.
    credentials_json TEXT,
    -- per-connection shared secret echoed by the provider (clientState etc.)
    client_state    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS subscription (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id   INTEGER NOT NULL REFERENCES connection(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    external_id     TEXT NOT NULL,         -- Graph subscription ID
    expires_at      TEXT NOT NULL,         -- ISO-8601, used by renewal cron
    last_renewed_at TEXT,
    encryption_cert_id TEXT,
    UNIQUE(provider, external_id)
);

CREATE TABLE IF NOT EXISTS recording_seen (
    provider           TEXT NOT NULL,
    external_recording_id TEXT NOT NULL,
    processed_at       TEXT NOT NULL DEFAULT (datetime('now')),
    audio_file_id      TEXT,                -- platform.db external_id we ended up with
    PRIMARY KEY (provider, external_recording_id)
);
"""


def _open() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(settings.db_path) or ".", exist_ok=True)
    db = sqlite3.connect(settings.db_path, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(SCHEMA)
    return db


def get_db() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            _conn = _open()
        return _conn


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    db = get_db()
    with _lock:
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise


# ── connection helpers ──────────────────────────────────────────────────────

def upsert_connection(
    *,
    user_id: str,
    provider: str,
    status: str,
    external_account: Optional[str] = None,
    credentials: Optional[dict[str, Any]] = None,
    client_state: Optional[str] = None,
) -> int:
    with tx() as db:
        existing = db.execute(
            "SELECT id FROM connection WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        ).fetchone()
        creds = json.dumps(credentials) if credentials is not None else None
        if existing:
            db.execute(
                """UPDATE connection
                      SET status = ?,
                          external_account = COALESCE(?, external_account),
                          credentials_json = COALESCE(?, credentials_json),
                          client_state = COALESCE(?, client_state),
                          updated_at = datetime('now')
                    WHERE id = ?""",
                (status, external_account, creds, client_state, existing["id"]),
            )
            return int(existing["id"])
        cur = db.execute(
            """INSERT INTO connection
                   (user_id, provider, status, external_account,
                    credentials_json, client_state)
                   VALUES (?, ?, ?, ?, ?, ?)""",
            (user_id, provider, status, external_account, creds, client_state),
        )
        return int(cur.lastrowid)


def get_connection(*, user_id: str, provider: str) -> Optional[sqlite3.Row]:
    return get_db().execute(
        "SELECT * FROM connection WHERE user_id = ? AND provider = ?",
        (user_id, provider),
    ).fetchone()


def get_connection_by_id(connection_id: int) -> Optional[sqlite3.Row]:
    return get_db().execute(
        "SELECT * FROM connection WHERE id = ?", (connection_id,),
    ).fetchone()


def list_connections(user_id: str) -> list[dict[str, Any]]:
    rows = get_db().execute(
        "SELECT * FROM connection WHERE user_id = ? ORDER BY provider",
        (user_id,),
    ).fetchall()
    return [_connection_public(r) for r in rows]


def disconnect(*, user_id: str, provider: str) -> bool:
    with tx() as db:
        cur = db.execute(
            "DELETE FROM connection WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        )
        return cur.rowcount > 0


def _connection_public(row: sqlite3.Row) -> dict[str, Any]:
    """Public shape — credentials are NEVER returned."""
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "provider": row["provider"],
        "status": row["status"],
        "external_account": row["external_account"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def credentials_of(row: sqlite3.Row) -> dict[str, Any]:
    raw = row["credentials_json"]
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return {}


# ── subscription helpers ────────────────────────────────────────────────────

def record_subscription(
    *, connection_id: int, provider: str, external_id: str, expires_at: str,
    encryption_cert_id: Optional[str] = None,
) -> None:
    with tx() as db:
        db.execute(
            """INSERT OR REPLACE INTO subscription
                   (connection_id, provider, external_id, expires_at,
                    last_renewed_at, encryption_cert_id)
                   VALUES (?, ?, ?, ?, datetime('now'), ?)""",
            (connection_id, provider, external_id, expires_at, encryption_cert_id),
        )


def list_subscriptions_for_renewal(*, provider: str) -> list[sqlite3.Row]:
    """Subscriptions expiring within ~36 h (Graph max is 3 days; renew at half-life)."""
    return get_db().execute(
        """SELECT * FROM subscription
            WHERE provider = ?
              AND datetime(expires_at) <= datetime('now', '+36 hours')""",
        (provider,),
    ).fetchall()


# ── dedupe ─────────────────────────────────────────────────────────────────

def has_seen_recording(provider: str, external_id: str) -> bool:
    return get_db().execute(
        "SELECT 1 FROM recording_seen WHERE provider = ? AND external_recording_id = ?",
        (provider, external_id),
    ).fetchone() is not None


def mark_recording_seen(provider: str, external_id: str, audio_file_id: Optional[str] = None) -> None:
    with tx() as db:
        db.execute(
            """INSERT OR IGNORE INTO recording_seen
                   (provider, external_recording_id, audio_file_id)
                   VALUES (?, ?, ?)""",
            (provider, external_id, audio_file_id),
        )
