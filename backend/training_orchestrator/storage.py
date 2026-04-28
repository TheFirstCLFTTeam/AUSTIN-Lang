import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


DEFAULT_DB_PATH = "/app/data/training_orchestrator.db"
SCHEMA_PATH = Path(__file__).with_name("schema.sql")


# State machine. Allowed transitions only — any other request is a 409.
# Mirrors training-job-pipeline.md §4.1 (queued → preparing → running →
# evaluating → published, plus paused/cancelled/failed off-paths).
ALLOWED_TRANSITIONS: Dict[str, set] = {
    "queued":     {"preparing", "cancelled", "failed"},
    "preparing":  {"running", "cancelled", "failed"},
    "running":    {"evaluating", "paused", "cancelled", "failed"},
    "paused":     {"running", "cancelled", "failed"},
    "evaluating": {"published", "failed"},
    "published":  set(),
    "cancelled":  set(),
    "failed":     set(),
}
TERMINAL_STATES = {"published", "cancelled", "failed"}
VALID_TARGETS = {"cloud", "local", "federated"}
VALID_DATA_ZONES = {"green", "red"}


@dataclass
class TrainingJobRecord:
    id: str
    name: str
    submitted_by: str
    submitted_at: str
    status: str
    target: str
    base_model: str
    dataset_ref: str
    data_zone: str
    env: Dict[str, Any]
    fl_enabled: bool
    dp_enabled: bool
    progress_pct: Optional[float]
    started_at: Optional[str]
    finished_at: Optional[str]
    failure_reason: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class JobError(Exception):
    """Raised by the store on validation failures and illegal transitions."""

    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _utc_iso_now() -> str:
    # Microsecond-precision so consecutive submissions sort deterministically.
    # SQLite stores it as TEXT — comparison is lexicographic which is correct
    # for ISO 8601.
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class JobStore:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or os.getenv("TRAINING_DB_PATH", DEFAULT_DB_PATH)
        parent = Path(self.db_path).parent
        if str(parent) not in ("", "."):
            parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))

    def submit(
        self,
        *,
        name: str,
        submitted_by: str,
        target: str,
        base_model: str,
        dataset_ref: str,
        env: Optional[Dict[str, Any]] = None,
        data_zone: str = "green",
        fl_enabled: bool = False,
        dp_enabled: bool = False,
    ) -> TrainingJobRecord:
        if not name.strip():
            raise JobError("name must be a non-empty string")
        if target not in VALID_TARGETS:
            raise JobError(
                f"target must be one of {sorted(VALID_TARGETS)}, got {target!r}"
            )
        if data_zone not in VALID_DATA_ZONES:
            raise JobError(
                f"data_zone must be one of {sorted(VALID_DATA_ZONES)}, got {data_zone!r}"
            )
        if target == "federated" and not fl_enabled:
            raise JobError("target='federated' requires fl_enabled=true")
        if fl_enabled:
            # The schema accommodates fl_enabled, but the runtime path is
            # blocked behind the F25 framework ADR — see training-job-
            # pipeline.md §4.4. Surface a 501 so callers know the orchestrator
            # itself isn't broken; the workstream just isn't ready yet.
            raise JobError(
                "federated training is not yet available (blocked on F25 ADR)",
                status_code=501,
            )

        job_id = f"job-{uuid.uuid4().hex[:12]}"
        submitted_at = _utc_iso_now()
        env_json = json.dumps(env or {})
        with self._conn() as conn:
            with conn:
                conn.execute(
                    """INSERT INTO training_job
                       (id, name, submitted_by, submitted_at, status, target,
                        base_model, dataset_ref, data_zone, env_json,
                        fl_enabled, dp_enabled)
                       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        job_id,
                        name.strip(),
                        submitted_by,
                        submitted_at,
                        target,
                        base_model,
                        dataset_ref,
                        data_zone,
                        env_json,
                        int(bool(fl_enabled)),
                        int(bool(dp_enabled)),
                    ),
                )
        record = self.get(job_id)
        assert record is not None  # just inserted
        return record

    def get(self, job_id: str) -> Optional[TrainingJobRecord]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM training_job WHERE id = ?", (job_id,)
            ).fetchone()
        return _row_to_record(row) if row else None

    def list(
        self,
        *,
        submitter: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100,
    ) -> List[TrainingJobRecord]:
        clauses: List[str] = []
        params: List[Any] = []
        if submitter is not None:
            clauses.append("submitted_by = ?")
            params.append(submitter)
        if status is not None:
            clauses.append("status = ?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = (
            f"SELECT * FROM training_job {where} "
            "ORDER BY submitted_at DESC, id DESC LIMIT ?"
        )
        params.append(limit)
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [_row_to_record(r) for r in rows]

    def transition(
        self,
        job_id: str,
        new_status: str,
        *,
        failure_reason: Optional[str] = None,
        progress_pct: Optional[float] = None,
    ) -> TrainingJobRecord:
        record = self.get(job_id)
        if record is None:
            raise JobError(f"job {job_id!r} not found", status_code=404)
        if new_status not in ALLOWED_TRANSITIONS.get(record.status, set()):
            raise JobError(
                f"cannot transition {record.status!r} → {new_status!r}",
                status_code=409,
            )

        # Side-effect timestamps for state milestones.
        now = _utc_iso_now()
        sets = ["status = ?"]
        params: List[Any] = [new_status]
        if new_status == "running" and record.started_at is None:
            sets.append("started_at = ?")
            params.append(now)
        if new_status in TERMINAL_STATES:
            sets.append("finished_at = ?")
            params.append(now)
        if failure_reason is not None:
            sets.append("failure_reason = ?")
            params.append(failure_reason)
        if progress_pct is not None:
            sets.append("progress_pct = ?")
            params.append(float(progress_pct))

        params.append(job_id)
        with self._conn() as conn:
            with conn:
                conn.execute(
                    f"UPDATE training_job SET {', '.join(sets)} WHERE id = ?",
                    params,
                )
        updated = self.get(job_id)
        assert updated is not None
        return updated

    def cancel(self, job_id: str) -> TrainingJobRecord:
        return self.transition(job_id, "cancelled")

    def update_progress(self, job_id: str, progress_pct: float) -> TrainingJobRecord:
        """Set progress_pct without changing status. Used by the real
        worker to stream training progress between status transitions —
        transition() rejects no-op state changes (running→running) on
        purpose, but progress is a "nice-to-have" that should land
        whenever the job is in a state that can have it."""
        record = self.get(job_id)
        if record is None:
            raise JobError(f"job {job_id!r} not found", status_code=404)
        # Only meaningful while the job is doing work. Silently no-op
        # when the job is terminal so a late-arriving stdout line can't
        # corrupt a finalised record.
        if record.status in TERMINAL_STATES:
            return record
        with self._conn() as conn:
            with conn:
                conn.execute(
                    "UPDATE training_job SET progress_pct = ? WHERE id = ?",
                    (float(progress_pct), job_id),
                )
        updated = self.get(job_id)
        assert updated is not None
        return updated


def _row_to_record(row: sqlite3.Row) -> TrainingJobRecord:
    env_raw = row["env_json"] or "{}"
    try:
        env = json.loads(env_raw)
    except json.JSONDecodeError:
        env = {}
    return TrainingJobRecord(
        id=row["id"],
        name=row["name"],
        submitted_by=row["submitted_by"],
        submitted_at=row["submitted_at"],
        status=row["status"],
        target=row["target"],
        base_model=row["base_model"],
        dataset_ref=row["dataset_ref"],
        data_zone=row["data_zone"],
        env=env,
        fl_enabled=bool(row["fl_enabled"]),
        dp_enabled=bool(row["dp_enabled"]),
        progress_pct=row["progress_pct"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        failure_reason=row["failure_reason"],
    )
