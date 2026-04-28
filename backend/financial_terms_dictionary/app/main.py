"""FastAPI bootstrap for the financial-terms-dictionary service.

Sibling pattern to backend/meeting_webhooks/app/main.py and
backend/training_orchestrator/main.py. Adding a new route module is
one new file + one include_router line.

Slice 1 of docs/07 Integration CAA 27APR2026/financial-terms-dictionary.md.
Slice 2 (CSV bulk-import + cleaning, app/seed.py) and the matching
algorithm (app/matching.py) are intentionally not wired here yet.
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import get_db
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


@app.on_event("startup")
def _startup() -> None:
    # Eager DB open so the schema is created at boot, not on first request.
    get_db()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":  # pragma: no cover
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
