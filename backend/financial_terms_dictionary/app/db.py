"""SQLite-backed persistence for the financial terms dictionary.

Single-process service — a singleton connection is fine. Separate `_lock`
guards the connection initialisation; SQLite itself serialises writes.

Naming: every helper takes keyword args matching the column names so
route handlers can pass through pydantic models with `.model_dump()`.
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional

from .config import settings


_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None


SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def _open() -> sqlite3.Connection:
    db_path = Path(settings.db_path)
    if str(db_path.parent) not in ("", "."):
        db_path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(settings.db_path, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
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


# ── Term helpers ────────────────────────────────────────────────────────────

VALID_STATUSES = {"pending", "approved", "rejected", "retired"}


def _normalise(term: str) -> str:
    """Canonical form for dedupe: stripped + casefold (a stronger lower())."""
    return (term or "").strip().casefold()


def submit_term(
    *,
    term: str,
    submitted_by: Optional[str],
    category: Optional[str] = None,
    definition: Optional[str] = None,
    source_file_id: Optional[str] = None,
    notes: Optional[str] = None,
    auto_approve: bool = False,
    approved_by: Optional[str] = None,
) -> dict[str, Any]:
    """Insert a new term as `pending` (or `approved` when `auto_approve`).

    Idempotent on `term_normalized` — re-submitting an existing term returns
    the existing row unchanged. Callers wanting "upsert with edit" should
    use `moderate_term` separately.
    """
    if not term or not term.strip():
        raise ValueError("term is required")
    norm = _normalise(term)

    with tx() as db:
        existing = db.execute(
            "SELECT * FROM financial_term WHERE term_normalized = ?", (norm,),
        ).fetchone()
        if existing:
            return dict(existing)

        status = "approved" if auto_approve else "pending"
        approved_at = "datetime('now')" if auto_approve else None

        if auto_approve:
            cur = db.execute(
                """INSERT INTO financial_term
                       (term, term_normalized, category, definition, status,
                        submitted_by, source_file_id, notes,
                        approved_by, approved_at)
                   VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?, datetime('now'))""",
                (term.strip(), norm, category, definition,
                 submitted_by, source_file_id, notes,
                 approved_by or submitted_by),
            )
        else:
            cur = db.execute(
                """INSERT INTO financial_term
                       (term, term_normalized, category, definition, status,
                        submitted_by, source_file_id, notes)
                   VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)""",
                (term.strip(), norm, category, definition,
                 submitted_by, source_file_id, notes),
            )
        new_row = db.execute(
            "SELECT * FROM financial_term WHERE id = ?", (cur.lastrowid,),
        ).fetchone()
        return dict(new_row)


def get_term(term_id: int) -> Optional[dict[str, Any]]:
    row = get_db().execute(
        "SELECT * FROM financial_term WHERE id = ?", (term_id,),
    ).fetchone()
    return dict(row) if row else None


def list_terms(
    *,
    status: Optional[str] = None,
    category: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """List terms with optional filters. `q` is a substring match against
    the canonical `term` (case-insensitive via term_normalized)."""
    where: list[str] = []
    params: list[Any] = []
    if status:
        if status not in VALID_STATUSES:
            raise ValueError(f"unknown status {status!r}")
        where.append("status = ?")
        params.append(status)
    if category:
        where.append("category = ?")
        params.append(category)
    if q:
        where.append("term_normalized LIKE ?")
        params.append(f"%{_normalise(q)}%")

    sql = "SELECT * FROM financial_term"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY submitted_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    rows = get_db().execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def moderate_term(
    term_id: int,
    *,
    new_status: str,
    moderator_id: str,
    category: Optional[str] = None,
    definition: Optional[str] = None,
    notes: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Flip status. Optional category/definition/notes patch happens at the
    same time — moderation is the natural moment to also fix metadata.

    Returns the updated row, or None if the id doesn't exist.
    """
    if new_status not in VALID_STATUSES:
        raise ValueError(f"unknown status {new_status!r}")

    with tx() as db:
        existing = db.execute(
            "SELECT * FROM financial_term WHERE id = ?", (term_id,),
        ).fetchone()
        if not existing:
            return None

        sets = ["status = ?"]
        params: list[Any] = [new_status]
        # Stamp approver only on the approval transition; subsequent edits
        # don't overwrite who first approved it.
        if new_status == "approved" and existing["approved_at"] is None:
            sets.append("approved_by = ?")
            params.append(moderator_id)
            sets.append("approved_at = datetime('now')")
        if category is not None:
            sets.append("category = ?")
            params.append(category)
        if definition is not None:
            sets.append("definition = ?")
            params.append(definition)
        if notes is not None:
            sets.append("notes = ?")
            params.append(notes)
        params.append(term_id)
        db.execute(
            f"UPDATE financial_term SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        updated = db.execute(
            "SELECT * FROM financial_term WHERE id = ?", (term_id,),
        ).fetchone()
        return dict(updated)


# ── Occurrence helpers ──────────────────────────────────────────────────────


def record_occurrence(
    *,
    term_id: int,
    audio_file_external_id: str,
    correctly_transcribed: bool,
) -> dict[str, Any]:
    """Append-only occurrence record. Idempotent on (term_id, file) — re-
    submitting a record for the same file is a no-op (returns the existing
    row). Updating "was correct" requires the older row to be removed by
    an admin migration; keeping it append-only matches the "ledger" intent."""
    with tx() as db:
        existing = db.execute(
            """SELECT * FROM financial_term_occurrence
                WHERE term_id = ? AND audio_file_external_id = ?""",
            (term_id, audio_file_external_id),
        ).fetchone()
        if existing:
            return dict(existing)

        cur = db.execute(
            """INSERT INTO financial_term_occurrence
                   (term_id, audio_file_external_id, correctly_transcribed)
               VALUES (?, ?, ?)""",
            (term_id, audio_file_external_id, 1 if correctly_transcribed else 0),
        )
        new_row = db.execute(
            "SELECT * FROM financial_term_occurrence WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
        return dict(new_row)


def stats_top_wrong(*, limit: int = 50) -> list[dict[str, Any]]:
    """Terms most-often gotten wrong by the model, descending."""
    rows = get_db().execute(
        """SELECT t.id, t.term, t.category, t.status,
                  COUNT(*)                               AS occurrences,
                  SUM(CASE WHEN o.correctly_transcribed = 0 THEN 1 ELSE 0 END) AS wrong_count,
                  SUM(CASE WHEN o.correctly_transcribed = 1 THEN 1 ELSE 0 END) AS right_count
             FROM financial_term_occurrence o
             JOIN financial_term            t ON t.id = o.term_id
            GROUP BY t.id
           HAVING wrong_count > 0
            ORDER BY wrong_count DESC, occurrences DESC
            LIMIT ?""",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def stats_trending(*, limit: int = 50, since_iso: Optional[str] = None) -> list[dict[str, Any]]:
    """Terms with the most occurrences (optionally filtered by recency)."""
    where = ""
    params: list[Any] = []
    if since_iso:
        where = "WHERE o.appeared_at >= ?"
        params.append(since_iso)
    sql = f"""SELECT t.id, t.term, t.category, t.status,
                     COUNT(*) AS occurrences
                FROM financial_term_occurrence o
                JOIN financial_term            t ON t.id = o.term_id
               {where}
               GROUP BY t.id
               ORDER BY occurrences DESC
               LIMIT ?"""
    params.append(limit)
    rows = get_db().execute(sql, params).fetchall()
    return [dict(r) for r in rows]


# ── Snapshot ────────────────────────────────────────────────────────────────


def dictionary_snapshot() -> dict[str, Any]:
    """Bulk approved-list + version stamp for manifest-time consumers
    (metrics service at eval-manifest build, retraining-pipeline's
    dataset_builder.py at training-manifest build).

    `version` is the most-recent `approved_at` across approved rows; eval
    manifests record this so reruns are reproducible. Empty approved set
    returns version=None and an empty list."""
    rows = get_db().execute(
        """SELECT id, term, term_normalized, category, definition, approved_at
             FROM financial_term
            WHERE status = 'approved'
            ORDER BY id"""
    ).fetchall()
    version = None
    if rows:
        version = max(r["approved_at"] for r in rows if r["approved_at"]) or None
    return {
        "version": version,
        "term_count": len(rows),
        "terms": [
            {
                "id": r["id"],
                "term": r["term"],
                "term_normalized": r["term_normalized"],
                "category": r["category"],
                "definition": r["definition"],
            }
            for r in rows
        ],
    }
