import json
import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from strategies.base import StrategyResult


DEFAULT_DB_PATH = "/app/data/metrics.db"
SCHEMA_PATH = Path(__file__).with_name("schema.sql")


@dataclass
class EvaluationRecord:
    id: int
    base_model: str
    adapter_name: Optional[str]
    adapter_version: Optional[str]
    dataset_name: str
    evaluated_at: str
    sample_count: int
    status: str
    notes: Optional[str]


@dataclass
class MetricRecord:
    id: int
    evaluation_id: int
    strategy_name: str
    value: float
    breakdown: Dict[str, Any]
    sample_count: int
    computed_at: str


@dataclass
class MetricRolePair:
    base_model: str
    dataset_name: str
    strategy_name: str
    base_value: Optional[float]
    base_evaluated_at: Optional[str]
    finetuned_value: Optional[float]
    finetuned_evaluated_at: Optional[str]
    finetuned_adapter_name: Optional[str]
    finetuned_adapter_version: Optional[str]

    @property
    def delta(self) -> Optional[float]:
        if self.base_value is None or self.finetuned_value is None:
            return None
        return self.finetuned_value - self.base_value


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class MetricsStore:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or os.getenv("METRICS_DB_PATH", DEFAULT_DB_PATH)
        parent = Path(self.db_path).parent
        if str(parent) not in ("", "."):
            parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
        finally:
            conn.close()

    def _init_schema(self) -> None:
        ddl = SCHEMA_PATH.read_text(encoding="utf-8")
        with self._conn() as conn:
            conn.executescript(ddl)

    def record_evaluation(
        self,
        *,
        base_model: str,
        adapter_name: Optional[str],
        adapter_version: Optional[str],
        dataset_name: str,
        sample_count: int,
        results: Iterable[StrategyResult],
        evaluated_at: Optional[str] = None,
        status: str = "completed",
        notes: Optional[str] = None,
    ) -> int:
        evaluated_at = evaluated_at or _utc_iso_now()
        with self._conn() as conn:
            with conn:
                cur = conn.execute(
                    """INSERT INTO model_evaluation
                       (base_model, adapter_name, adapter_version, dataset_name,
                        evaluated_at, sample_count, status, notes)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        base_model,
                        adapter_name,
                        adapter_version,
                        dataset_name,
                        evaluated_at,
                        sample_count,
                        status,
                        notes,
                    ),
                )
                evaluation_id = cur.lastrowid
                for r in results:
                    conn.execute(
                        """INSERT INTO evaluation_metric
                           (evaluation_id, strategy_name, value, breakdown_json, sample_count)
                           VALUES (?, ?, ?, ?, ?)""",
                        (
                            evaluation_id,
                            r.strategy_name,
                            float(r.value),
                            json.dumps(r.breakdown or {}),
                            int(r.sample_count),
                        ),
                    )
                return evaluation_id

    def get_evaluation(self, evaluation_id: int) -> Optional[EvaluationRecord]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM model_evaluation WHERE id = ?", (evaluation_id,)
            ).fetchone()
        return _row_to_evaluation(row) if row else None

    def list_evaluations(
        self,
        *,
        base_model: Optional[str] = None,
        adapter_name: Optional[str] = None,
        dataset_name: Optional[str] = None,
        limit: int = 100,
    ) -> List[EvaluationRecord]:
        clauses: List[str] = []
        params: List[Any] = []
        if base_model is not None:
            clauses.append("base_model = ?")
            params.append(base_model)
        if dataset_name is not None:
            clauses.append("dataset_name = ?")
            params.append(dataset_name)
        # Distinguish "filter not provided" (None) from "filter for base-only
        # rows" (sentinel "__base__"). Callers asking for adapter_name=None
        # would otherwise be ambiguous with "no filter", which is the common
        # case and would silently return base + finetuned mixed.
        if adapter_name is not None:
            if adapter_name == "__base__":
                clauses.append("adapter_name IS NULL")
            else:
                clauses.append("adapter_name = ?")
                params.append(adapter_name)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = (
            f"SELECT * FROM model_evaluation {where} "
            "ORDER BY evaluated_at DESC, id DESC LIMIT ?"
        )
        params.append(limit)
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [_row_to_evaluation(r) for r in rows]

    def list_metrics_for_evaluation(self, evaluation_id: int) -> List[MetricRecord]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM evaluation_metric WHERE evaluation_id = ? ORDER BY id",
                (evaluation_id,),
            ).fetchall()
        return [_row_to_metric(r) for r in rows]

    def list_strategy_names(
        self,
        *,
        base_model: Optional[str] = None,
        dataset_name: Optional[str] = None,
    ) -> List[str]:
        clauses: List[str] = ["me.status = 'completed'"]
        params: List[Any] = []
        if base_model is not None:
            clauses.append("me.base_model = ?")
            params.append(base_model)
        if dataset_name is not None:
            clauses.append("me.dataset_name = ?")
            params.append(dataset_name)
        where = "WHERE " + " AND ".join(clauses)
        sql = (
            "SELECT DISTINCT em.strategy_name "
            "FROM evaluation_metric em "
            "JOIN model_evaluation me ON me.id = em.evaluation_id "
            f"{where} ORDER BY em.strategy_name"
        )
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [r["strategy_name"] for r in rows]

    def delete_evaluations_with_notes(self, notes_value: str) -> int:
        with self._conn() as conn:
            with conn:
                cur = conn.execute(
                    "DELETE FROM model_evaluation WHERE notes = ?", (notes_value,)
                )
                # FK CASCADE removes the matching evaluation_metric rows.
                return cur.rowcount

    def latest_metric_series(
        self,
        *,
        base_model: str,
        dataset_name: str,
        strategy_name: str,
        role: str,
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """Most-recent N (evaluated_at, value) points for one (model, dataset, strategy, role).

        `role` is "base" (adapter_name IS NULL) or "finetuned" (any adapter).
        Points are returned **chronologically** (oldest first) — that's what
        the FE expects for plotting older→newer left-to-right.
        """
        if role == "base":
            adapter_clause = "me.adapter_name IS NULL"
        elif role == "finetuned":
            adapter_clause = "me.adapter_name IS NOT NULL"
        else:
            raise ValueError(f"role must be 'base' or 'finetuned', got {role!r}")

        sql = (
            "SELECT em.value, me.evaluated_at "
            "FROM evaluation_metric em "
            "JOIN model_evaluation me ON me.id = em.evaluation_id "
            "WHERE me.base_model = ? AND me.dataset_name = ? "
            "  AND em.strategy_name = ? AND me.status = 'completed' "
            f"  AND {adapter_clause} "
            "ORDER BY me.evaluated_at DESC, me.id DESC LIMIT ?"
        )
        params = (base_model, dataset_name, strategy_name, int(limit))
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        # Return oldest first for chart-friendly ordering.
        return [
            {"evaluated_at": r["evaluated_at"], "value": r["value"]}
            for r in reversed(rows)
        ]

    def latest_metric_pair(
        self,
        *,
        base_model: str,
        dataset_name: str,
        strategy_name: str,
    ) -> MetricRolePair:
        base = self._latest_metric(
            base_model=base_model,
            dataset_name=dataset_name,
            strategy_name=strategy_name,
            adapter_clause="me.adapter_name IS NULL",
            adapter_params=(),
        )
        finetuned = self._latest_metric(
            base_model=base_model,
            dataset_name=dataset_name,
            strategy_name=strategy_name,
            adapter_clause="me.adapter_name IS NOT NULL",
            adapter_params=(),
        )
        return MetricRolePair(
            base_model=base_model,
            dataset_name=dataset_name,
            strategy_name=strategy_name,
            base_value=base["value"] if base else None,
            base_evaluated_at=base["evaluated_at"] if base else None,
            finetuned_value=finetuned["value"] if finetuned else None,
            finetuned_evaluated_at=finetuned["evaluated_at"] if finetuned else None,
            finetuned_adapter_name=finetuned["adapter_name"] if finetuned else None,
            finetuned_adapter_version=(
                finetuned["adapter_version"] if finetuned else None
            ),
        )

    def _latest_metric(
        self,
        *,
        base_model: str,
        dataset_name: str,
        strategy_name: str,
        adapter_clause: str,
        adapter_params: tuple,
    ) -> Optional[Dict[str, Any]]:
        sql = (
            "SELECT em.value, em.breakdown_json, me.evaluated_at, "
            "       me.adapter_name, me.adapter_version "
            "FROM evaluation_metric em "
            "JOIN model_evaluation me ON me.id = em.evaluation_id "
            "WHERE me.base_model = ? AND me.dataset_name = ? "
            f"  AND em.strategy_name = ? AND me.status = 'completed' "
            f"  AND {adapter_clause} "
            "ORDER BY me.evaluated_at DESC, me.id DESC LIMIT 1"
        )
        params = (base_model, dataset_name, strategy_name, *adapter_params)
        with self._conn() as conn:
            row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None


def _row_to_evaluation(row: sqlite3.Row) -> EvaluationRecord:
    return EvaluationRecord(
        id=row["id"],
        base_model=row["base_model"],
        adapter_name=row["adapter_name"],
        adapter_version=row["adapter_version"],
        dataset_name=row["dataset_name"],
        evaluated_at=row["evaluated_at"],
        sample_count=row["sample_count"],
        status=row["status"],
        notes=row["notes"],
    )


def _row_to_metric(row: sqlite3.Row) -> MetricRecord:
    breakdown_raw = row["breakdown_json"] or "{}"
    try:
        breakdown = json.loads(breakdown_raw)
    except json.JSONDecodeError:
        breakdown = {}
    return MetricRecord(
        id=row["id"],
        evaluation_id=row["evaluation_id"],
        strategy_name=row["strategy_name"],
        value=row["value"],
        breakdown=breakdown,
        sample_count=row["sample_count"],
        computed_at=row["computed_at"],
    )
