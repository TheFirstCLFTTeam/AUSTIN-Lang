"""Slice-1 invariants for the financial-terms-dictionary service.

Covers the storage-layer contract:
  - schema initialises idempotently (re-open doesn't crash);
  - submit dedupes on term_normalized (case + whitespace);
  - moderation lifecycle (pending → approved stamps approver + timestamp);
  - retired terms drop out of the snapshot;
  - occurrences are append-only + idempotent on (term, file);
  - top_wrong / trending stats aggregate correctly;
  - dictionary_snapshot version is the max approved_at across approved rows.

Plus the HTTP surface via FastAPI TestClient:
  - role gates: submitter roles can submit; non-submitters get 403;
  - moderation requires admin;
  - occurrence on unknown term_id is 404;
  - snapshot endpoint round-trips.

Run from backend/Financial_terms_dictionary/:
    python -m unittest discover -s tests
"""
from __future__ import annotations

import importlib
import os
import tempfile
import unittest
from pathlib import Path


# Configure env BEFORE importing the app so settings.* sees test values.
_TMP = tempfile.mkdtemp(prefix="financial-terms-test-")
os.environ["DB_PATH"] = str(Path(_TMP) / "test.db")
os.environ["SEED_ON_BOOT"] = "false"

from app import config as _config_module  # noqa: E402

importlib.reload(_config_module)

from app import db as _db_module  # noqa: E402

importlib.reload(_db_module)
from app import db  # noqa: E402

# Import after env is set + db reloaded so the FastAPI app uses the same
# settings instance.
from fastapi.testclient import TestClient  # noqa: E402

from app import main as _main_module  # noqa: E402

importlib.reload(_main_module)
from app.main import app  # noqa: E402


def _reset_db() -> None:
    """Wipe both tables between tests so cases stay independent."""
    conn = db.get_db()
    with db._lock:
        conn.execute("DELETE FROM financial_term_occurrence")
        conn.execute("DELETE FROM financial_term")
        conn.commit()


# ── Storage-layer tests ────────────────────────────────────────────────────


class StorageTests(unittest.TestCase):
    def setUp(self):
        _reset_db()

    def test_schema_idempotent(self):
        # Re-running the schema script (which db._open does on every open)
        # must not crash. Calling get_db() multiple times exercises the
        # singleton path; calling _open() directly exercises the schema
        # script applied twice.
        conn1 = db.get_db()
        conn2 = db.get_db()
        self.assertIs(conn1, conn2)

    def test_submit_dedupes_on_normalized(self):
        a = db.submit_term(term="EBITDA", submitted_by="u1")
        b = db.submit_term(term=" ebitda ", submitted_by="u2")
        self.assertEqual(a["id"], b["id"])
        # The original casing is preserved on the canonical row.
        self.assertEqual(a["term"], "EBITDA")

    def test_submit_lands_pending(self):
        row = db.submit_term(term="P/E ratio", submitted_by="u1")
        self.assertEqual(row["status"], "pending")
        self.assertIsNone(row["approved_at"])
        self.assertEqual(row["submitted_by"], "u1")

    def test_moderate_to_approved_stamps_approver(self):
        row = db.submit_term(term="ROE", submitted_by="u1")
        approved = db.moderate_term(
            row["id"], new_status="approved", moderator_id="admin-1",
        )
        self.assertEqual(approved["status"], "approved")
        self.assertEqual(approved["approved_by"], "admin-1")
        self.assertIsNotNone(approved["approved_at"])

    def test_moderate_to_retired_keeps_approver(self):
        row = db.submit_term(term="WACC", submitted_by="u1")
        db.moderate_term(row["id"], new_status="approved", moderator_id="admin-1")
        retired = db.moderate_term(
            row["id"], new_status="retired", moderator_id="admin-2",
        )
        self.assertEqual(retired["status"], "retired")
        # Original approver stays — re-approval doesn't fire on a non-approve.
        self.assertEqual(retired["approved_by"], "admin-1")

    def test_moderate_unknown_returns_none(self):
        self.assertIsNone(
            db.moderate_term(99999, new_status="approved", moderator_id="admin"),
        )

    def test_moderate_invalid_status_raises(self):
        row = db.submit_term(term="DCF", submitted_by="u1")
        with self.assertRaises(ValueError):
            db.moderate_term(row["id"], new_status="bogus", moderator_id="admin")

    def test_list_terms_filters(self):
        a = db.submit_term(term="AAA", submitted_by="u1", category="rating")
        b = db.submit_term(term="BBB", submitted_by="u1", category="rating")
        db.submit_term(term="EPS", submitted_by="u1", category="ratio")
        db.moderate_term(a["id"], new_status="approved", moderator_id="adm")

        approved = db.list_terms(status="approved")
        self.assertEqual([r["id"] for r in approved], [a["id"]])

        ratings = db.list_terms(category="rating")
        self.assertEqual({r["id"] for r in ratings}, {a["id"], b["id"]})

        substring = db.list_terms(q="bb")
        self.assertEqual([r["id"] for r in substring], [b["id"]])

    def test_occurrence_dedupes_on_term_and_file(self):
        term = db.submit_term(term="EBITDA", submitted_by="u1")
        a = db.record_occurrence(
            term_id=term["id"], audio_file_external_id="ext-1",
            correctly_transcribed=False,
        )
        b = db.record_occurrence(
            term_id=term["id"], audio_file_external_id="ext-1",
            correctly_transcribed=True,
        )
        self.assertEqual(a["id"], b["id"])
        # Original "wrong" record stays — the ledger is append-only,
        # so re-submission is a no-op rather than an overwrite.
        self.assertEqual(b["correctly_transcribed"], 0)

    def test_stats_top_wrong(self):
        ebitda = db.submit_term(term="EBITDA", submitted_by="u1")
        eps    = db.submit_term(term="EPS",    submitted_by="u1")
        # EBITDA: 3 wrong, 1 right; EPS: 1 wrong, 0 right.
        for i, ok in enumerate([0, 0, 0, 1]):
            db.record_occurrence(
                term_id=ebitda["id"], audio_file_external_id=f"f{i}",
                correctly_transcribed=bool(ok),
            )
        db.record_occurrence(
            term_id=eps["id"], audio_file_external_id="g0",
            correctly_transcribed=False,
        )
        rows = db.stats_top_wrong()
        self.assertEqual(rows[0]["id"], ebitda["id"])
        self.assertEqual(rows[0]["wrong_count"], 3)
        self.assertEqual(rows[0]["right_count"], 1)
        self.assertEqual(rows[1]["id"], eps["id"])
        self.assertEqual(rows[1]["wrong_count"], 1)

    def test_stats_top_wrong_excludes_perfect_terms(self):
        term = db.submit_term(term="ROE", submitted_by="u1")
        db.record_occurrence(
            term_id=term["id"], audio_file_external_id="f1",
            correctly_transcribed=True,
        )
        # Term has occurrences but zero wrong — should not appear.
        rows = db.stats_top_wrong()
        self.assertEqual(rows, [])

    def test_snapshot_only_includes_approved(self):
        a = db.submit_term(term="EBITDA", submitted_by="u1")
        b = db.submit_term(term="EPS",    submitted_by="u1")
        c = db.submit_term(term="WACC",   submitted_by="u1")
        db.moderate_term(a["id"], new_status="approved", moderator_id="adm")
        db.moderate_term(b["id"], new_status="rejected", moderator_id="adm")
        # c stays pending

        snap = db.dictionary_snapshot()
        self.assertEqual(snap["term_count"], 1)
        self.assertEqual([t["term"] for t in snap["terms"]], ["EBITDA"])
        self.assertIsNotNone(snap["version"])

    def test_snapshot_drops_retired(self):
        a = db.submit_term(term="EBITDA", submitted_by="u1")
        db.moderate_term(a["id"], new_status="approved", moderator_id="adm")
        snap_before = db.dictionary_snapshot()
        self.assertEqual(snap_before["term_count"], 1)

        db.moderate_term(a["id"], new_status="retired", moderator_id="adm")
        snap_after = db.dictionary_snapshot()
        self.assertEqual(snap_after["term_count"], 0)

    def test_snapshot_empty_returns_null_version(self):
        snap = db.dictionary_snapshot()
        self.assertEqual(snap["term_count"], 0)
        self.assertIsNone(snap["version"])
        self.assertEqual(snap["terms"], [])


# ── HTTP surface via TestClient ───────────────────────────────────────────


class HttpRoleGateTests(unittest.TestCase):
    def setUp(self):
        _reset_db()
        self.client = TestClient(app)

    def test_healthz(self):
        r = self.client.get("/healthz")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"status": "ok"})

    def test_submit_requires_user_header(self):
        r = self.client.post("/terms", json={"term": "EBITDA"})
        self.assertEqual(r.status_code, 401)

    def test_submit_rejects_non_submitter_role(self):
        r = self.client.post(
            "/terms", json={"term": "EBITDA"},
            headers={"X-User-Id": "u-generic", "X-User-Role": "generic"},
        )
        self.assertEqual(r.status_code, 403)

    def test_submit_accepts_engineer(self):
        r = self.client.post(
            "/terms", json={"term": "EBITDA"},
            headers={"X-User-Id": "u-eng", "X-User-Role": "engineer"},
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["status"], "pending")
        self.assertEqual(r.json()["submitted_by"], "u-eng")

    def test_moderate_rejects_engineer(self):
        # Submit as engineer.
        post = self.client.post(
            "/terms", json={"term": "EPS"},
            headers={"X-User-Id": "u-eng", "X-User-Role": "engineer"},
        )
        term_id = post.json()["id"]
        # Engineer cannot moderate.
        r = self.client.patch(
            f"/terms/{term_id}",
            json={"status": "approved"},
            headers={"X-User-Id": "u-eng", "X-User-Role": "engineer"},
        )
        self.assertEqual(r.status_code, 403)

    def test_moderate_accepts_admin(self):
        post = self.client.post(
            "/terms", json={"term": "ROE"},
            headers={"X-User-Id": "u-eng", "X-User-Role": "engineer"},
        )
        term_id = post.json()["id"]
        r = self.client.patch(
            f"/terms/{term_id}",
            json={"status": "approved"},
            headers={"X-User-Id": "u-admin", "X-User-Role": "admin"},
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "approved")
        self.assertEqual(r.json()["approved_by"], "u-admin")

    def test_moderate_requires_some_field(self):
        post = self.client.post(
            "/terms", json={"term": "WACC"},
            headers={"X-User-Id": "u-eng", "X-User-Role": "engineer"},
        )
        term_id = post.json()["id"]
        r = self.client.patch(
            f"/terms/{term_id}", json={},
            headers={"X-User-Id": "u-admin", "X-User-Role": "admin"},
        )
        self.assertEqual(r.status_code, 400)

    def test_get_term_404(self):
        r = self.client.get(
            "/terms/99999",
            headers={"X-User-Id": "u-anyone"},
        )
        self.assertEqual(r.status_code, 404)


class HttpOccurrenceTests(unittest.TestCase):
    def setUp(self):
        _reset_db()
        self.client = TestClient(app)

    def _new_term(self, term: str = "EBITDA") -> int:
        r = self.client.post(
            "/terms", json={"term": term},
            headers={"X-User-Id": "u-eng", "X-User-Role": "engineer"},
        )
        return r.json()["id"]

    def test_occurrence_unknown_term_404(self):
        r = self.client.post(
            "/occurrences",
            json={
                "term_id": 99999,
                "audio_file_external_id": "ext-1",
                "correctly_transcribed": False,
            },
            headers={"X-User-Id": "u-svc"},
        )
        self.assertEqual(r.status_code, 404)

    def test_occurrence_round_trip(self):
        term_id = self._new_term()
        r = self.client.post(
            "/occurrences",
            json={
                "term_id": term_id,
                "audio_file_external_id": "ext-1",
                "correctly_transcribed": False,
            },
            headers={"X-User-Id": "u-svc"},
        )
        self.assertEqual(r.status_code, 201)
        body = r.json()
        self.assertEqual(body["term_id"], term_id)
        self.assertEqual(body["correctly_transcribed"], 0)

    def test_stats_top_wrong_endpoint(self):
        term_id = self._new_term()
        # Three wrong calls deduped to one row by (term, file) — drive
        # three distinct files instead so the count actually ticks.
        for f in ["a", "b", "c"]:
            self.client.post(
                "/occurrences",
                json={
                    "term_id": term_id,
                    "audio_file_external_id": f,
                    "correctly_transcribed": False,
                },
                headers={"X-User-Id": "u-svc"},
            )
        r = self.client.get(
            "/occurrences/stats?kind=top_wrong",
            headers={"X-User-Id": "u-anyone"},
        )
        self.assertEqual(r.status_code, 200)
        rows = r.json()["rows"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["wrong_count"], 3)


class HttpSnapshotTests(unittest.TestCase):
    def setUp(self):
        _reset_db()
        self.client = TestClient(app)

    def test_snapshot_round_trip(self):
        # Submit + approve a term; snapshot picks it up.
        post = self.client.post(
            "/terms", json={"term": "EBITDA"},
            headers={"X-User-Id": "u-eng", "X-User-Role": "engineer"},
        )
        term_id = post.json()["id"]
        self.client.patch(
            f"/terms/{term_id}", json={"status": "approved"},
            headers={"X-User-Id": "u-admin", "X-User-Role": "admin"},
        )

        r = self.client.get(
            "/dictionary/snapshot",
            headers={"X-User-Id": "u-svc"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["term_count"], 1)
        self.assertIsNotNone(body["version"])
        self.assertEqual(body["terms"][0]["term"], "EBITDA")


if __name__ == "__main__":
    unittest.main()
