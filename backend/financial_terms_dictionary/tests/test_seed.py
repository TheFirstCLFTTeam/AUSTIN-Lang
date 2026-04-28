"""Slice-2 tests — CSV cleaner + importer.

Covers:
  - classify_row classifies real-world Investopedia rows correctly
    (clean vs suspicious vs drop);
  - import_csv counts kept / pending / duplicate / empty;
  - re-running import_csv is idempotent on existing rows;
  - clean rows land approved with approved_by='seed-system';
  - suspicious rows land pending with the cleaner's reason in notes;
  - bulk-import HTTP endpoint requires admin role;
  - bulk-import returns the counts dict.

Run from backend/Financial_terms_dictionary/:
    python -m unittest tests.test_seed
"""
from __future__ import annotations

import importlib
import os
import tempfile
import textwrap
import unittest
from pathlib import Path


_TMP = tempfile.mkdtemp(prefix="financial-terms-seed-test-")
os.environ["DB_PATH"] = str(Path(_TMP) / "test.db")
os.environ["SEED_ON_BOOT"] = "false"   # don't auto-seed during tests
os.environ["SEED_CSV_PATH"] = "/nonexistent/wont-be-read.csv"

from app import config as _config_module  # noqa: E402

importlib.reload(_config_module)

from app import db as _db_module  # noqa: E402

importlib.reload(_db_module)
from app import db  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app import main as _main_module  # noqa: E402

importlib.reload(_main_module)
from app.main import app  # noqa: E402

from app.seed import classify_row, import_csv  # noqa: E402


def _reset_db() -> None:
    conn = db.get_db()
    with db._lock:
        conn.execute("DELETE FROM financial_term_occurrence")
        conn.execute("DELETE FROM financial_term")
        conn.commit()


# ── classify_row unit tests ────────────────────────────────────────────────


class ClassifyRowTests(unittest.TestCase):
    def assert_clean(self, text):
        status, reason = classify_row(text)
        self.assertEqual(status, "clean", f"{text!r} should be clean (got reason={reason})")

    def assert_suspicious(self, text):
        status, _ = classify_row(text)
        self.assertEqual(status, "suspicious", f"{text!r} should be suspicious")

    def assert_drop(self, text):
        status, _ = classify_row(text)
        self.assertEqual(status, "drop", f"{text!r} should be dropped")

    # Empty / whitespace
    def test_empty_drops(self):
        self.assert_drop("")
        self.assert_drop("   ")
        self.assert_drop("\t\n")

    # Real terms — must classify as clean
    def test_short_term(self):
        self.assert_clean("EBITDA")
        self.assert_clean("10-K")
        self.assert_clean("0x Protocol")

    def test_acronym_with_parenthetical(self):
        self.assert_clean("11th District Cost of Funds Index (COFI)")
        self.assert_clean("3/27 Adjustable-Rate Mortgage (ARM)")

    def test_form_name(self):
        self.assert_clean("1040 U.S. Individual Tax Return Form")

    def test_legitimate_long_term(self):
        # Right at the token threshold — must still be clean.
        self.assert_clean("Schedule K-1 Beneficiary Share of Income Deductions Credits")

    # Article titles — must classify as suspicious
    def test_what_it_is_phrase(self):
        self.assert_suspicious('10-K Wrap: What It Is, How It Works, Elements')

    def test_meaning_how_it_works_phrase(self):
        self.assert_suspicious('2-2-8 Adjustable-Rate Mortgage (2/28 ARM): Meaning, How It Works')

    def test_understanding_opener(self):
        self.assert_suspicious("Understanding the 25% Rule: Government Debt and Royalty Guidelines")
        self.assert_suspicious("Understanding the 3-6-3 Rule: Historical Banking Practice Explained")

    def test_question_mark(self):
        self.assert_suspicious("What Defines a Bungalow? Characteristics and History Explained")

    def test_prose_colon(self):
        self.assert_suspicious("Benjamin Graham: The Father of Value Investing and His Legacy")

    def test_too_many_tokens(self):
        long = " ".join(["word"] * 15)
        self.assert_suspicious(long)

    def test_what_starter(self):
        self.assert_suspicious("What Are Amortized Bonds? Definition, Mechanics, and Examples Explained")


# ── import_csv integration tests ───────────────────────────────────────────


def _write_csv(content: str) -> Path:
    p = Path(_TMP) / "fixture.csv"
    p.write_text(textwrap.dedent(content).lstrip("\n"), encoding="utf-8")
    return p


class ImportCsvTests(unittest.TestCase):
    def setUp(self):
        _reset_db()

    def test_classifies_and_counts(self):
        # 3 clean, 2 suspicious, 1 empty
        path = _write_csv('''
            EBITDA
            10-K
            "10-K Wrap: What It Is, How It Works, Elements"
            10-Year Treasury Note
            "Understanding the 25% Rule: Government Debt and Royalty Guidelines"

        ''')
        counts = import_csv(path)
        self.assertEqual(counts["rows_total"], 6)
        self.assertEqual(counts["imported_clean"], 3)
        self.assertEqual(counts["imported_pending"], 2)
        self.assertEqual(counts["skipped_empty"], 1)
        self.assertEqual(counts["skipped_duplicate"], 0)

    def test_clean_rows_land_approved(self):
        path = _write_csv('''
            EBITDA
            "10-K Wrap: What It Is, How It Works, Elements"
        ''')
        import_csv(path)
        clean = db.list_terms(status="approved")
        self.assertEqual(len(clean), 1)
        self.assertEqual(clean[0]["term"], "EBITDA")
        self.assertEqual(clean[0]["approved_by"], "seed-system")
        self.assertIsNotNone(clean[0]["approved_at"])

    def test_suspicious_rows_land_pending_with_reason(self):
        path = _write_csv('''
            "10-K Wrap: What It Is, How It Works, Elements"
        ''')
        import_csv(path)
        pending = db.list_terms(status="pending")
        self.assertEqual(len(pending), 1)
        self.assertIn("seed CSV", pending[0]["notes"])
        # The cleaner's reason should travel through to the notes field
        # so admins triaging the queue see WHY it was quarantined.
        self.assertTrue(
            any(s in pending[0]["notes"] for s in ("phrase", "colon", "opener", "question", "tokens")),
            f"expected reason in notes, got: {pending[0]['notes']!r}",
        )

    def test_idempotent_on_rerun(self):
        path = _write_csv('''
            EBITDA
            EPS
            "10-K Wrap: What It Is, How It Works, Elements"
        ''')
        first = import_csv(path)
        self.assertEqual(first["imported_clean"] + first["imported_pending"], 3)

        second = import_csv(path)
        self.assertEqual(second["imported_clean"], 0)
        self.assertEqual(second["imported_pending"], 0)
        self.assertEqual(second["skipped_duplicate"], 3)

    def test_dedupes_by_normalized(self):
        # `EBITDA`, `ebitda`, `  EBITDA  ` should land as one row.
        path = _write_csv('''
            EBITDA
            ebitda
              EBITDA
        ''')
        counts = import_csv(path)
        # All three rows survive cleaning (clean), but two are dedupes.
        self.assertEqual(counts["rows_total"], 3)
        self.assertEqual(counts["imported_clean"], 1)
        self.assertEqual(counts["skipped_duplicate"], 2)

    def test_missing_csv_raises(self):
        with self.assertRaises(FileNotFoundError):
            import_csv("/nonexistent/file.csv")


# ── HTTP bulk-import endpoint ──────────────────────────────────────────────


class BulkImportRouteTests(unittest.TestCase):
    def setUp(self):
        _reset_db()
        self.client = TestClient(app)

    def test_requires_admin(self):
        path = _write_csv("EBITDA\n")
        # No user header → 401
        r = self.client.post("/terms/bulk-import", json={"csv_path": str(path)})
        self.assertEqual(r.status_code, 401)
        # Engineer role → 403
        r = self.client.post(
            "/terms/bulk-import",
            json={"csv_path": str(path)},
            headers={"X-User-Id": "u-eng", "X-User-Role": "engineer"},
        )
        self.assertEqual(r.status_code, 403)

    def test_admin_imports_clean(self):
        path = _write_csv('''
            EBITDA
            "Understanding the 25% Rule: Government Debt"
        ''')
        r = self.client.post(
            "/terms/bulk-import",
            json={"csv_path": str(path)},
            headers={"X-User-Id": "u-admin", "X-User-Role": "admin"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["counts"]["imported_clean"], 1)
        self.assertEqual(body["counts"]["imported_pending"], 1)

    def test_missing_csv_returns_404(self):
        r = self.client.post(
            "/terms/bulk-import",
            json={"csv_path": "/nope/missing.csv"},
            headers={"X-User-Id": "u-admin", "X-User-Role": "admin"},
        )
        self.assertEqual(r.status_code, 404)


if __name__ == "__main__":
    unittest.main()
