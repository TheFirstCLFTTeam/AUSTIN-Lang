"""Base-model + training-artifact registry — slice A of #4 in the §3.3
backlog (training-job-pipeline.md §4.2).

Read-only HTTP for now: vendor base models are seeded on first boot,
engineers don't yet see derived bases or artifacts because the artifact-
upload contract (slice B) requires torch + transformers in the
orchestrator container, which we're deferring. The store APIs here are
already shaped for derived bases + arch-fingerprint stamping so slice B
is a wiring exercise, not a redesign.

The vendor seed list mirrors the hard-coded `BASE_MODELS` array in
`frontend/src/app/(dashboard)/training/page.jsx` so the dialog's
dropdown and the registry agree out of the box. When the FE switches to
fetching this list from `GET /base-models`, the array on the page can
go away entirely.
"""
from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


# Vendor seeds. Order is the display order on the dialog dropdown;
# `display_name` matches the FE's `BASE_MODELS` array exactly so the
# adapter map in `services/training-jobs.js::HF_ID_TO_DISPLAY` round-
# trips. Adding a new vendor here is one line + a doc note.
VENDOR_SEEDS: List[Dict[str, Any]] = [
    {
        "id": "bm_whisper_large_v3_turbo",
        "family": "whisper",
        "display_name": "Whisper Large-v3",
        "hf_id": "openai/whisper-large-v3-turbo",
        "data_zone": "green",
    },
    {
        "id": "bm_whisper_tiny",
        "family": "whisper",
        "display_name": "Whisper Tiny",
        "hf_id": "openai/whisper-tiny",
        "data_zone": "green",
    },
    {
        "id": "bm_meralion",
        "family": "meralion",
        "display_name": "MERaLiON",
        "hf_id": "MERaLiON/MERaLiON-AudioLLM-Whisper-SEA-LION",
        "data_zone": "green",
    },
    {
        "id": "bm_qwen3_asr",
        "family": "qwen3-asr",
        "display_name": "Qwen3-ASR",
        "hf_id": "Qwen/Qwen3-ASR",
        "data_zone": "green",
    },
]


VALID_ARTIFACT_KINDS = {"adapter", "base_model", "checkpoint", "candidate_base"}


class RegistryError(Exception):
    """Raised on validation failures and missing-row lookups in either
    store. `status_code` propagates straight to the API layer."""

    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class BaseModelRecord:
    id: str
    family: str
    display_name: str
    hf_id: Optional[str]
    owner_user_id: Optional[str]
    parent_base_model_id: Optional[str]
    architecture_fingerprint: Optional[str]
    weights_uri: Optional[str]
    data_zone: str
    created_at: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TrainingArtifactRecord:
    id: str
    job_id: str
    kind: str
    base_model_id: Optional[str]
    uri: str
    sha256: str
    size_bytes: int
    arch_fp: Optional[str]
    weight_fp: Optional[str]
    adapter_fp: Optional[str]
    promotion_note: Optional[str]
    created_at: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class BaseModelStore:
    """SQLite-backed CRUD for the `base_model` table.

    Sharing the connection with `JobStore` would be marginally tidier
    but the schema lives in the same file, the connection is opened
    per-call (cheap), and keeping the stores independent makes them
    easier to test in isolation. JobStore.attach_script proves the
    point — that helper doesn't need to know about the registry."""

    def __init__(self, db_path: str):
        self.db_path = db_path

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def seed_vendors(self, seeds: Optional[List[Dict[str, Any]]] = None) -> int:
        """Idempotent. Inserts any vendor rows missing by id; returns the
        number actually inserted on this call. Called from FastAPI's
        startup hook — every boot is a no-op once the table is full."""
        rows = seeds if seeds is not None else VENDOR_SEEDS
        inserted = 0
        with self._conn() as conn:
            with conn:
                for spec in rows:
                    existing = conn.execute(
                        "SELECT 1 FROM base_model WHERE id = ?", (spec["id"],)
                    ).fetchone()
                    if existing:
                        continue
                    conn.execute(
                        """INSERT INTO base_model
                           (id, family, display_name, hf_id, owner_user_id,
                            parent_base_model_id, architecture_fingerprint,
                            weights_uri, data_zone, created_at)
                           VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)""",
                        (
                            spec["id"],
                            spec["family"],
                            spec["display_name"],
                            spec.get("hf_id"),
                            spec.get("data_zone", "green"),
                            _utc_iso_now(),
                        ),
                    )
                    inserted += 1
        return inserted

    def get(self, base_model_id: str) -> Optional[BaseModelRecord]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM base_model WHERE id = ?", (base_model_id,)
            ).fetchone()
        return _row_to_base_model(row) if row else None

    def find_by_hf_id(self, hf_id: str) -> Optional[BaseModelRecord]:
        """Lookup vendor entry by HF id. Useful when the FE submits a
        legacy `base_model: 'openai/…'` string that the orchestrator
        wants to resolve to a registry id."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM base_model WHERE hf_id = ? "
                "ORDER BY owner_user_id IS NOT NULL, created_at LIMIT 1",
                (hf_id,),
            ).fetchone()
        return _row_to_base_model(row) if row else None

    def list(
        self,
        *,
        family: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        include_vendor: bool = True,
        limit: int = 100,
    ) -> List[BaseModelRecord]:
        clauses: List[str] = []
        params: List[Any] = []
        if family is not None:
            clauses.append("family = ?")
            params.append(family)
        if owner_user_id is not None:
            # Caller wants a specific user's derived bases. By default
            # also include vendor entries (NULL owner) since they are
            # always available; pass include_vendor=False to suppress.
            if include_vendor:
                clauses.append("(owner_user_id = ? OR owner_user_id IS NULL)")
            else:
                clauses.append("owner_user_id = ?")
            params.append(owner_user_id)
        elif not include_vendor:
            clauses.append("owner_user_id IS NOT NULL")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = (
            f"SELECT * FROM base_model {where} "
            "ORDER BY owner_user_id IS NOT NULL, family, display_name LIMIT ?"
        )
        params.append(limit)
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [_row_to_base_model(r) for r in rows]

    def register_derived(
        self,
        *,
        family: str,
        display_name: str,
        owner_user_id: str,
        parent_base_model_id: str,
        architecture_fingerprint: str,
        weights_uri: str,
        data_zone: str = "green",
    ) -> BaseModelRecord:
        """Insert a new engineer-owned base model that diverged from its
        parent (training-job-pipeline.md §4.3 promotion rule, last row).
        The orchestrator's fingerprint check is the only intended caller
        — the API layer doesn't expose this directly."""
        if not owner_user_id:
            raise RegistryError(
                "owner_user_id is required for derived base models"
            )
        parent = self.get(parent_base_model_id)
        if parent is None:
            raise RegistryError(
                f"parent base model {parent_base_model_id!r} not found",
                status_code=404,
            )
        new_id = f"bm_derived_{uuid.uuid4().hex[:12]}"
        with self._conn() as conn:
            with conn:
                conn.execute(
                    """INSERT INTO base_model
                       (id, family, display_name, hf_id, owner_user_id,
                        parent_base_model_id, architecture_fingerprint,
                        weights_uri, data_zone, created_at)
                       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)""",
                    (
                        new_id, family, display_name, owner_user_id,
                        parent_base_model_id, architecture_fingerprint,
                        weights_uri, data_zone, _utc_iso_now(),
                    ),
                )
        record = self.get(new_id)
        assert record is not None
        return record


class ArtifactStore:
    def __init__(self, db_path: str):
        self.db_path = db_path

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def record(
        self,
        *,
        job_id: str,
        kind: str,
        uri: str,
        sha256: str,
        size_bytes: int,
        base_model_id: Optional[str] = None,
        arch_fp: Optional[str] = None,
        weight_fp: Optional[str] = None,
        adapter_fp: Optional[str] = None,
        promotion_note: Optional[str] = None,
    ) -> TrainingArtifactRecord:
        if kind not in VALID_ARTIFACT_KINDS:
            raise RegistryError(
                f"kind must be one of {sorted(VALID_ARTIFACT_KINDS)}, got {kind!r}"
            )
        artifact_id = f"art_{uuid.uuid4().hex[:12]}"
        with self._conn() as conn:
            with conn:
                conn.execute(
                    """INSERT INTO training_artifact
                       (id, job_id, kind, base_model_id, uri, sha256,
                        size_bytes, arch_fp, weight_fp, adapter_fp,
                        promotion_note, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        artifact_id, job_id, kind, base_model_id, uri,
                        sha256, int(size_bytes), arch_fp, weight_fp,
                        adapter_fp, promotion_note, _utc_iso_now(),
                    ),
                )
        record = self.get(artifact_id)
        assert record is not None
        return record

    def get(self, artifact_id: str) -> Optional[TrainingArtifactRecord]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM training_artifact WHERE id = ?", (artifact_id,)
            ).fetchone()
        return _row_to_artifact(row) if row else None

    def list_for_job(self, job_id: str) -> List[TrainingArtifactRecord]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM training_artifact WHERE job_id = ? "
                "ORDER BY created_at DESC, id DESC",
                (job_id,),
            ).fetchall()
        return [_row_to_artifact(r) for r in rows]


def _row_to_base_model(row: sqlite3.Row) -> BaseModelRecord:
    return BaseModelRecord(
        id=row["id"],
        family=row["family"],
        display_name=row["display_name"],
        hf_id=row["hf_id"],
        owner_user_id=row["owner_user_id"],
        parent_base_model_id=row["parent_base_model_id"],
        architecture_fingerprint=row["architecture_fingerprint"],
        weights_uri=row["weights_uri"],
        data_zone=row["data_zone"],
        created_at=row["created_at"],
    )


def _row_to_artifact(row: sqlite3.Row) -> TrainingArtifactRecord:
    return TrainingArtifactRecord(
        id=row["id"],
        job_id=row["job_id"],
        kind=row["kind"],
        base_model_id=row["base_model_id"],
        uri=row["uri"],
        sha256=row["sha256"],
        size_bytes=row["size_bytes"],
        arch_fp=row["arch_fp"],
        weight_fp=row["weight_fp"],
        adapter_fp=row["adapter_fp"],
        promotion_note=row["promotion_note"],
        created_at=row["created_at"],
    )
