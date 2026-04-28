"""FastAPI bootstrap for the financial-terms-dictionary service.

Sibling pattern to backend/meeting_webhooks/app/main.py and
backend/training_orchestrator/main.py. Adding a new route module is
one new file + one include_router line.

Slices 1 + 2 of docs/07 Integration CAA 27APR2026/financial-terms-dictionary.md.
The matching algorithm (app/matching.py) is intentionally still pending —
that arrives with slice 4 when the metric strategy lands.
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import get_db
from .routes_admin import router as admin_router
from .routes_occurrences import router as occurrences_router
from .routes_occurrences import snapshot_router
from .routes_terms import router as terms_router


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)


app = FastAPI(title="financial-terms-dictionary", version="0.1.0")


app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "").split(",")
        if os.getenv("CORS_ALLOW_ORIGINS") else [],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(terms_router)
app.include_router(occurrences_router)
app.include_router(snapshot_router)
app.include_router(admin_router)


@app.on_event("startup")
def _startup() -> None:
    # Eager DB open so the schema is created at boot, not on first request.
    db = get_db()

    # Slice 2: seed-on-boot when the DB is empty and SEED_ON_BOOT=true.
    # The CSV is bundled into the image at /app/financialTerms.csv (set
    # via SEED_CSV_PATH). Re-running on a populated DB is a no-op because
    # the importer dedupes by term_normalized — so this is safe even if
    # the env flag stays on across restarts.
    if not settings.seed_on_boot:
        return
    row_count = db.execute("SELECT COUNT(*) FROM financial_term").fetchone()[0]
    if row_count > 0:
        return

    log = logging.getLogger(__name__)
    try:
        from .seed import import_csv
        counts = import_csv(settings.seed_csv_path)
        log.info("seeded financial_term on boot: %s", counts)
    except FileNotFoundError as exc:
        log.info("seed CSV not present (%s); skipping seed-on-boot", exc)
    except Exception:
        log.exception("seed-on-boot failed; service still up with empty DB")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":  # pragma: no cover
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
