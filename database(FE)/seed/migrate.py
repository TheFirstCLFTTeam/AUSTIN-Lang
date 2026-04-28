"""Apply pending SQL migrations to platform.db / users.db.

    python database(FE)/seed/migrate.py platform
    python database(FE)/seed/migrate.py users

Conventions:
  - Each migration is a `.sql` file under `seed/migrations/<target>/`.
  - Filenames sort lexicographically; `0001_*.sql` before `0002_*.sql`.
  - Applied state is tracked in a `_schema_migrations` table inside the DB.
  - Each row records the filename, applied-at timestamp, and the SHA-256 of
    the file content at apply time. A subsequent run that finds a checksum
    mismatch FAILS LOUDLY (corruption / accidental edit of an applied file).
  - Migrations should be self-idempotent (`IF NOT EXISTS`, `WHERE NOT EXISTS`,
    etc.) so a partial-failure replay is safe.
  - The runner does NOT roll back across files — each file is its own
    transaction. Authors should wrap multi-statement migrations in
    `BEGIN; ... COMMIT;` themselves.

For a fresh seed, the schema file (`schema_platform.sql`) is the source of
truth and migrations are skipped — this script is for upgrading an existing
DB you cannot wipe (i.e. prod, or a developer who wants to keep their state).
"""

from __future__ import annotations

import hashlib
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB_DIR = HERE.parent
MIGRATIONS_ROOT = HERE / "migrations"

TARGETS = {
    "platform": DB_DIR / "platform.db",
    "users": DB_DIR / "users.db",
}


def ensure_migrations_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS _schema_migrations (
            filename   TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now')),
            checksum   TEXT NOT NULL
        )
        """
    )


def load_applied(conn: sqlite3.Connection) -> dict[str, str]:
    return {
        row[0]: row[1]
        for row in conn.execute(
            "SELECT filename, checksum FROM _schema_migrations"
        )
    }


def file_checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def discover_migrations(target: str) -> list[Path]:
    folder = MIGRATIONS_ROOT / target
    if not folder.exists():
        return []
    return sorted(p for p in folder.iterdir() if p.suffix == ".sql")


def apply_migration(conn: sqlite3.Connection, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest()
    # Each migration is its own transaction — authors include BEGIN/COMMIT
    # for multi-statement work, but executescript() also auto-commits any
    # open transaction at the end. The bookkeeping insert is committed
    # separately so we can't end up with an applied migration that wasn't
    # recorded.
    conn.executescript(sql)
    conn.execute(
        "INSERT INTO _schema_migrations (filename, checksum) VALUES (?, ?)",
        (path.name, checksum),
    )
    conn.commit()


def run(target: str) -> None:
    if target not in TARGETS:
        raise SystemExit(f"unknown target {target!r}; expected one of {list(TARGETS)}")
    db_path = TARGETS[target]
    if not db_path.exists():
        raise SystemExit(
            f"DB file not found at {db_path}. Run the seeder first "
            f"(python database(FE)/seed/seed_{target}_db.py)."
        )

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_migrations_table(conn)

    pending = discover_migrations(target)
    if not pending:
        print(f"[migrate:{target}] no migrations under {MIGRATIONS_ROOT / target}")
        return

    applied = load_applied(conn)

    # Verify checksums of already-applied files. A mismatch means someone
    # edited a migration after it was applied — that's never safe.
    for path in pending:
        if path.name in applied:
            stored = applied[path.name]
            current = file_checksum(path)
            if stored != current:
                raise SystemExit(
                    f"[migrate:{target}] CHECKSUM MISMATCH on {path.name}.\n"
                    f"  applied checksum:  {stored}\n"
                    f"  on-disk checksum:  {current}\n"
                    f"  Migrations are append-only — never edit an applied file. "
                    f"Add a new migration that fixes the issue forward."
                )

    to_apply = [p for p in pending if p.name not in applied]
    if not to_apply:
        print(f"[migrate:{target}] up to date ({len(applied)} applied)")
        return

    for path in to_apply:
        print(f"[migrate:{target}] applying {path.name} …")
        try:
            apply_migration(conn, path)
        except sqlite3.Error as err:
            raise SystemExit(f"[migrate:{target}] FAILED on {path.name}: {err}") from err
        print(f"[migrate:{target}]   ok")

    print(f"[migrate:{target}] applied {len(to_apply)} new migration(s)")


def stamp(target: str, conn: sqlite3.Connection | None = None) -> None:
    """Record every on-disk migration for `target` as already applied,
    without executing it. Used by the fresh-seed path: `schema_*.sql` is
    the source of truth there, so the migrations are conceptually already
    in the DB and re-running them would error.

    Idempotent: re-stamping just confirms checksums and inserts any rows
    that are missing.
    """
    if target not in TARGETS:
        raise ValueError(f"unknown target {target!r}")

    own_conn = conn is None
    if own_conn:
        db_path = TARGETS[target]
        if not db_path.exists():
            raise FileNotFoundError(f"DB file not found at {db_path}")
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys = ON")

    try:
        ensure_migrations_table(conn)
        applied = load_applied(conn)
        for path in discover_migrations(target):
            checksum = file_checksum(path)
            if path.name in applied:
                if applied[path.name] != checksum:
                    raise RuntimeError(
                        f"stamp: checksum drift on {path.name}; "
                        f"someone edited an applied migration"
                    )
                continue
            conn.execute(
                "INSERT INTO _schema_migrations (filename, checksum) VALUES (?, ?)",
                (path.name, checksum),
            )
        conn.commit()
    finally:
        if own_conn:
            conn.close()


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: migrate.py <platform|users> [--stamp]")
    target = sys.argv[1]
    if "--stamp" in sys.argv[2:]:
        stamp(target)
        print(f"[migrate:{target}] stamped all on-disk migrations as applied")
        return
    run(target)


if __name__ == "__main__":
    main()
