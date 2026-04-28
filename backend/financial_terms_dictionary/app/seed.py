"""CSV → DB importer with cleaning heuristics.

The shipped `financialTerms.csv` is Investopedia-derived and contains a
non-trivial fraction of noise rows — Investopedia article titles like
`"10-K Wrap: What It Is, How It Works, Elements"` mixed in alongside real
terms like `"10-K"` and `"10-Year Treasury Note"`.

`classify_row()` decides whether a row is:

  - clean        — auto-approve into the dictionary
  - suspicious   — import as `pending` for admin triage
  - drop         — empty/whitespace-only; skip silently

`import_csv()` walks the file once, applies the classifier, dedupes
against existing rows by `term_normalized`, and inserts. Idempotent —
re-running is a no-op on rows that already exist.
"""
from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Literal, Optional, Tuple

from . import db


log = logging.getLogger(__name__)


# Heuristics calibrated against the real shipped CSV. See the inline
# samples in __doc__ above. We're conservative — anything ambiguous lands
# as 'suspicious' and the admin moderates.

# Substrings that indicate the row is an Investopedia article title rather
# than a financial term. Lowercase compare; whitespace-tolerant.
SUSPICIOUS_PHRASES: Tuple[str, ...] = (
    "what it is",
    "how it works",
    "what are",
    "what is",
    "how to",
    "how does",
    "definition",
    "meaning",
    "explained",
    "key features",
    "key insights",
    "mechanics",
    "characteristics",
    "examples",
    "differences from",
    "differences between",
    "benefits",
    "key reforms",
    " explained:",
)

# Phrases that, when at the START of the row, mark it as an article title
# ("Understanding the 3-6-3 Rule: …"). Trailing space included so the
# classifier doesn't false-positive on actual terms beginning with these
# letters as substrings.
ARTICLE_OPENERS: Tuple[str, ...] = (
    "understanding ",
    "what is ",
    "what are ",
    "what defines ",
    "how to ",
    "how does ",
    "why is ",
    "why are ",
    "why does ",
)


# Maximum tokens for a "real" financial term. Calibrated against the
# longest legitimate entries in the Investopedia seed (e.g. "Schedule K-1
# Beneficiary's Share of Income Deductions Credits" ~9 words). Anything
# above this is almost always an article title.
MAX_TOKENS_FOR_CLEAN = 10


Status = Literal["clean", "suspicious", "drop"]


def classify_row(text: str) -> tuple[Status, Optional[str]]:
    """Decide whether a CSV row is a clean term, a suspicious likely-title,
    or empty. Returns (status, reason); reason is None for clean and
    'empty' for drops, otherwise a short human-readable string.

    Order of checks goes cheapest-first; the first matching rule wins.
    """
    s = (text or "").strip()
    if not s:
        return ("drop", "empty")

    lower = s.lower()

    # Question marks rarely appear in real terms.
    if "?" in s:
        return ("suspicious", "contains question mark")

    # Prose-style colons: ":" followed by space + alphabetic char (e.g.
    # "Foo: Bar"). Acronym-style colons like "ABC:" are rare in this
    # corpus and we accept the false-negative risk.
    colon_idx = s.find(":")
    if colon_idx != -1 and colon_idx + 2 < len(s):
        after = s[colon_idx + 1: colon_idx + 3]
        if after[:1] == " " and after[1:2].isalpha():
            return ("suspicious", "prose-style colon")

    for opener in ARTICLE_OPENERS:
        if lower.startswith(opener):
            return ("suspicious", f"article-title opener: {opener.strip()!r}")

    for phrase in SUSPICIOUS_PHRASES:
        if phrase in lower:
            return ("suspicious", f"telltale phrase: {phrase!r}")

    if len(s.split()) > MAX_TOKENS_FOR_CLEAN:
        return ("suspicious", f"too many tokens (>{MAX_TOKENS_FOR_CLEAN})")

    return ("clean", None)


def import_csv(
    csv_path: str | Path,
    *,
    submitted_by: Optional[str] = "system",
) -> dict:
    """Walk csv_path, classify each row, insert new rows.

    Returns a counts dict:
        rows_total          — every line read from the CSV
        imported_clean      — auto-approved into financial_term
        imported_pending    — landed as 'pending' for admin triage
        skipped_duplicate   — already in DB (term_normalized match)
        skipped_empty       — blank/whitespace-only rows

    Idempotent: a re-run only inserts rows whose normalised form isn't
    already present. Existing rows are left untouched (status is NOT
    changed by the importer — that's moderator-only).
    """
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(f"seed CSV not found: {path}")

    counts = {
        "rows_total": 0,
        "imported_clean": 0,
        "imported_pending": 0,
        "skipped_duplicate": 0,
        "skipped_empty": 0,
    }

    log.info("financial-terms seed: importing %s", path)
    # Investopedia exports tend to mix UTF-8 with cp1252 (curly quotes,
    # en-dashes, nbsp). Probe-read the first chunk in UTF-8; if that
    # fails, retry as cp1252; if that fails too, fall back to UTF-8 with
    # `errors='replace'` so a single bad byte doesn't block the seed.
    encodings_to_try = ["utf-8", "cp1252"]
    chosen = None
    for enc in encodings_to_try:
        try:
            with path.open("r", encoding=enc, newline="") as probe:
                probe.read()
            chosen = enc
            break
        except UnicodeDecodeError:
            continue
    if chosen is None:
        log.warning(
            "financial-terms seed: %s and %s both failed; falling back to "
            "utf-8 with errors='replace' — invalid bytes become '?'",
            *encodings_to_try,
        )
        fh = path.open("r", encoding="utf-8", errors="replace", newline="")
    else:
        log.info("financial-terms seed: reading as %s", chosen)
        fh = path.open("r", encoding=chosen, newline="")

    with fh:
        reader = csv.reader(fh)
        for row in reader:
            counts["rows_total"] += 1
            text = row[0] if row else ""
            status, reason = classify_row(text)

            if status == "drop":
                counts["skipped_empty"] += 1
                continue

            normalized = db._normalise(text)
            existing = db.get_db().execute(
                "SELECT id FROM financial_term WHERE term_normalized = ?",
                (normalized,),
            ).fetchone()
            if existing:
                counts["skipped_duplicate"] += 1
                continue

            note = "seed CSV (clean)" if status == "clean" else f"seed CSV ({reason})"
            db.submit_term(
                term=text.strip(),
                submitted_by=submitted_by,
                notes=note,
                auto_approve=(status == "clean"),
                approved_by="seed-system" if status == "clean" else None,
            )
            if status == "clean":
                counts["imported_clean"] += 1
            else:
                counts["imported_pending"] += 1

    log.info("financial-terms seed done: %s", counts)
    return counts
