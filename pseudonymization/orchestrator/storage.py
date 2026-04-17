"""
Persistence for runs + spans. SQLite by default to match the rest of the
backend; swap to Postgres in prod via PSEUDONYM_DB_URL (the schema is
intentionally portable — TEXT/INTEGER/REAL/BLOB).

original_text is encrypted via the `crypto` module before it lands here.
This module assumes the bytes handed in are already ciphertext.
"""

import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator, List, Optional

from .masking import FinalSpan

DB_PATH = os.getenv("PSEUDONYM_DB_PATH", "/app/pseudonymisation.db")
SCHEMA_PATH = os.getenv(
    "PSEUDONYM_SCHEMA_PATH",
    os.path.join(os.path.dirname(__file__), "schema.sql"),
)


@dataclass
class RunRecord:
    id: str
    transcript_id: str
    model_version: str
    label_set_version: str
    started_at: str
    completed_at: Optional[str]
    status: str            # queued | running | done | failed
    actor_id: str
    attempts: int
    error_code: Optional[str] = None
    error_message: Optional[str] = None


@dataclass
class SpanRecord:
    id: str
    run_id: str
    segment_id: str
    start_char: int
    end_char: int
    original_text: bytes   # ciphertext
    entity_type: str
    placeholder: str
    confidence: float
    source: str
    decision: Optional[str] = None
    reviewer_id: Optional[str] = None
    reviewer_decided_at: Optional[str] = None
    reviewer_note: Optional[str] = None


def init_db() -> None:
    with _connect() as conn, open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        conn.executescript(f.read())


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def insert_run(run: RunRecord) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO pseudonymisation_runs
                (id, transcript_id, model_version, label_set_version,
                 started_at, completed_at, status, actor_id, attempts,
                 error_code, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run.id, run.transcript_id, run.model_version,
                run.label_set_version, run.started_at, run.completed_at,
                run.status, run.actor_id, run.attempts,
                run.error_code, run.error_message,
            ),
        )


def update_run_status(
    run_id: str,
    status: str,
    completed_at: Optional[str] = None,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
    attempts: Optional[int] = None,
) -> None:
    fields = ["status = ?"]
    args: list = [status]
    if completed_at is not None:
        fields.append("completed_at = ?"); args.append(completed_at)
    if error_code is not None:
        fields.append("error_code = ?"); args.append(error_code)
    if error_message is not None:
        fields.append("error_message = ?"); args.append(error_message)
    if attempts is not None:
        fields.append("attempts = ?"); args.append(attempts)
    args.append(run_id)
    with _connect() as conn:
        conn.execute(
            f"UPDATE pseudonymisation_runs SET {', '.join(fields)} WHERE id = ?",
            args,
        )


def insert_spans(spans: List[SpanRecord]) -> None:
    if not spans:
        return
    with _connect() as conn:
        conn.executemany(
            """
            INSERT INTO pseudonymisation_spans
                (id, run_id, segment_id, start_char, end_char, original_text,
                 entity_type, placeholder, confidence, source,
                 decision, reviewer_id, reviewer_decided_at, reviewer_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    s.id, s.run_id, s.segment_id, s.start_char, s.end_char,
                    s.original_text, s.entity_type, s.placeholder, s.confidence,
                    s.source, s.decision, s.reviewer_id, s.reviewer_decided_at,
                    s.reviewer_note,
                )
                for s in spans
            ],
        )


def latest_run_for_transcript(transcript_id: str) -> Optional[RunRecord]:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM pseudonymisation_runs
            WHERE transcript_id = ?
            ORDER BY started_at DESC LIMIT 1
            """,
            (transcript_id,),
        ).fetchone()
    return _row_to_run(row) if row else None


def get_run(run_id: str) -> Optional[RunRecord]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM pseudonymisation_runs WHERE id = ?", (run_id,)
        ).fetchone()
    return _row_to_run(row) if row else None


def list_spans(run_id: str) -> List[SpanRecord]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM pseudonymisation_spans WHERE run_id = ? ORDER BY segment_id, start_char",
            (run_id,),
        ).fetchall()
    return [_row_to_span(r) for r in rows]


def update_span_decision(
    span_id: str, decision: str, reviewer_id: str,
    reviewer_decided_at: str, note: Optional[str],
) -> int:
    with _connect() as conn:
        cur = conn.execute(
            """
            UPDATE pseudonymisation_spans
            SET decision = ?, reviewer_id = ?, reviewer_decided_at = ?, reviewer_note = ?
            WHERE id = ?
            """,
            (decision, reviewer_id, reviewer_decided_at, note, span_id),
        )
        return cur.rowcount


def all_spans_decided(run_id: str) -> bool:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS pending FROM pseudonymisation_spans
            WHERE run_id = ? AND decision IS NULL
            """,
            (run_id,),
        ).fetchone()
    return (row["pending"] if row else 0) == 0


def _row_to_run(row: sqlite3.Row) -> RunRecord:
    return RunRecord(
        id=row["id"], transcript_id=row["transcript_id"],
        model_version=row["model_version"], label_set_version=row["label_set_version"],
        started_at=row["started_at"], completed_at=row["completed_at"],
        status=row["status"], actor_id=row["actor_id"], attempts=row["attempts"],
        error_code=row["error_code"], error_message=row["error_message"],
    )


def _row_to_span(row: sqlite3.Row) -> SpanRecord:
    return SpanRecord(
        id=row["id"], run_id=row["run_id"], segment_id=row["segment_id"],
        start_char=row["start_char"], end_char=row["end_char"],
        original_text=row["original_text"], entity_type=row["entity_type"],
        placeholder=row["placeholder"], confidence=row["confidence"],
        source=row["source"], decision=row["decision"],
        reviewer_id=row["reviewer_id"],
        reviewer_decided_at=row["reviewer_decided_at"],
        reviewer_note=row["reviewer_note"],
    )
