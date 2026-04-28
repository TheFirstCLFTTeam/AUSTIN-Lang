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
    training_job_id: Optional[str] = None
    submitted_by: Optional[str] = None


@dataclass
class LeaderboardRow:
    """Denormalised leaderboard row — one entry per (base_model,
    adapter_name) on a dataset, picking the latest evaluation. WER/CER/
    RTF are pulled from `evaluation_metric` and pivoted column-wise so
    a single SQL query produces the full ranking without per-row
    enrichment."""
    base_model: str
    adapter_name: Optional[str]
    adapter_version: Optional[str]
    dataset_name: str
    evaluated_at: str
    training_job_id: Optional[str]
    submitted_by: Optional[str]
    wer: Optional[float]
    cer: Optional[float]
    rtf: Optional[float]
    evaluation_id: int


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
            # Idempotent retro-fit for long-running DBs created before
            # the leaderboard provenance columns landed. Same pattern
            # used in training_orchestrator/storage.py for script_*.
            for col_def in (
                "training_job_id TEXT",
                "submitted_by TEXT",
            ):
                try:
                    conn.execute(f"ALTER TABLE model_evaluation ADD COLUMN {col_def}")
                except sqlite3.OperationalError as exc:
                    if "duplicate column" not in str(exc).lower():
                        raise

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
        training_job_id: Optional[str] = None,
        submitted_by: Optional[str] = None,
    ) -> int:
        evaluated_at = evaluated_at or _utc_iso_now()
        with self._conn() as conn:
            with conn:
                cur = conn.execute(
                    """INSERT INTO model_evaluation
                       (base_model, adapter_name, adapter_version, dataset_name,
                        evaluated_at, sample_count, status, notes,
                        training_job_id, submitted_by)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        base_model,
                        adapter_name,
                        adapter_version,
                        dataset_name,
                        evaluated_at,
                        sample_count,
                        status,
                        notes,
                        training_job_id,
                        submitted_by,
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

    def latest_baseline_age_days(
        self,
        *,
        base_model: str,
        dataset_name: str,
    ) -> Optional[float]:
        """Days elapsed since the most recent base-only (`adapter_name IS NULL`)
        evaluation row for `(base_model, dataset_name)`. Returns None when
        no baseline row exists. Days as a float so sub-day comparisons
        work for the test suite.

        Drives `METRICS_BASELINE_FRESHNESS_DAYS` enforcement in the
        post-train hook + the `/evaluations/baseline` short-circuit
        (training-job-pipeline.md §3.1 pending #3 / metrics-service-
        module.md §5.4).
        """
        with self._conn() as conn:
            row = conn.execute(
                "SELECT evaluated_at FROM model_evaluation "
                "WHERE base_model = ? AND dataset_name = ? "
                "  AND adapter_name IS NULL AND status = 'completed' "
                "ORDER BY evaluated_at DESC, id DESC LIMIT 1",
                (base_model, dataset_name),
            ).fetchone()
        if not row:
            return None
        try:
            ts = datetime.strptime(row["evaluated_at"], "%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            try:
                ts = datetime.strptime(
                    row["evaluated_at"], "%Y-%m-%dT%H:%M:%S.%fZ"
                )
            except ValueError:
                return None
        ts = ts.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - ts
        return delta.total_seconds() / 86400.0

    def is_baseline_fresh(
        self,
        *,
        base_model: str,
        dataset_name: str,
        freshness_days: float,
    ) -> bool:
        """True when the latest baseline for the pair is within the
        freshness window. False when no baseline exists OR the latest
        is stale. The post-train hook treats this as "skip the baseline
        re-run if True"."""
        age = self.latest_baseline_age_days(
            base_model=base_model, dataset_name=dataset_name,
        )
        if age is None:
            return False
        return age <= freshness_days

    def list_leaderboard(
        self,
        *,
        dataset_name: str,
        base_family: Optional[str] = None,
        only_finetuned: bool = True,
        limit: int = 100,
    ) -> List[LeaderboardRow]:
        """Latest evaluation per (base_model, adapter_name) on a dataset,
        with WER/CER/RTF pivoted out of evaluation_metric so the FE gets
        a flat row shape ready to render. Sorted by WER ascending (lower
        is better) — rows with no WER recorded sort to the bottom.

        `base_family` filters by HF-id prefix (e.g. 'whisper' matches
        'openai/whisper-large-v3-turbo' and 'openai/whisper-tiny'). The
        comparison is a case-insensitive substring on the slash-tail of
        `base_model` so it works for both 'openai/whisper-…' and the
        bare-id rows that older fixtures use.

        `only_finetuned=True` (default) excludes adapter_name IS NULL
        rows so the leaderboard ranks fine-tunes against each other,
        not against their own baselines. Set False to include base rows
        when the caller wants a single combined chart.
        """
        # Step 1: find the latest evaluation_id per (base_model, adapter_name)
        # on this dataset. Use a window-style aggregate via correlated
        # subquery — SQLite has supported window functions since 3.25
        # but the simpler subquery form keeps the SQL portable.
        clauses = ["dataset_name = ?", "status = 'completed'"]
        params: List[Any] = [dataset_name]
        if only_finetuned:
            clauses.append("adapter_name IS NOT NULL")
        if base_family:
            clauses.append("LOWER(base_model) LIKE ?")
            params.append(f"%{base_family.lower()}%")
        where = " AND ".join(clauses)

        # Latest row per (base_model, COALESCE(adapter_name, '__base__'))
        # to keep null-safe grouping.
        latest_sql = f"""
            SELECT id, base_model, adapter_name, adapter_version, dataset_name,
                   evaluated_at, training_job_id, submitted_by
            FROM model_evaluation me
            WHERE {where}
              AND id = (
                  SELECT id FROM model_evaluation
                  WHERE base_model = me.base_model
                    AND COALESCE(adapter_name, '__base__') = COALESCE(me.adapter_name, '__base__')
                    AND dataset_name = me.dataset_name
                    AND status = 'completed'
                  ORDER BY evaluated_at DESC, id DESC LIMIT 1
              )
            LIMIT ?
        """
        params.append(int(limit))

        with self._conn() as conn:
            latest_rows = conn.execute(latest_sql, params).fetchall()
            if not latest_rows:
                return []

            # Step 2: pull WER/CER/RTF for each evaluation in one query.
            ids = [r["id"] for r in latest_rows]
            placeholders = ",".join("?" for _ in ids)
            metric_rows = conn.execute(
                f"""SELECT evaluation_id, strategy_name, value
                    FROM evaluation_metric
                    WHERE evaluation_id IN ({placeholders})
                      AND strategy_name IN ('wer', 'cer', 'rtf')""",
                ids,
            ).fetchall()

        # Pivot: evaluation_id → {wer, cer, rtf}.
        per_eval: Dict[int, Dict[str, float]] = {}
        for m in metric_rows:
            per_eval.setdefault(m["evaluation_id"], {})[m["strategy_name"]] = float(m["value"])

        out: List[LeaderboardRow] = []
        for r in latest_rows:
            metrics = per_eval.get(r["id"], {})
            keys = r.keys()
            out.append(LeaderboardRow(
                base_model=r["base_model"],
                adapter_name=r["adapter_name"],
                adapter_version=r["adapter_version"],
                dataset_name=r["dataset_name"],
                evaluated_at=r["evaluated_at"],
                training_job_id=r["training_job_id"] if "training_job_id" in keys else None,
                submitted_by=r["submitted_by"] if "submitted_by" in keys else None,
                wer=metrics.get("wer"),
                cer=metrics.get("cer"),
                rtf=metrics.get("rtf"),
                evaluation_id=r["id"],
            ))

        # Sort by WER asc; rows without WER sink to the bottom.
        out.sort(key=lambda x: (x.wer is None, x.wer if x.wer is not None else 0.0))
        return out

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
    keys = row.keys()
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
        training_job_id=row["training_job_id"] if "training_job_id" in keys else None,
        submitted_by=row["submitted_by"] if "submitted_by" in keys else None,
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
