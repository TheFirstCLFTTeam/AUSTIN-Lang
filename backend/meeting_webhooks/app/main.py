"""FastAPI bootstrap for the meeting-webhooks service.

Routes are split across:
  routes_connect.py    — list / connect / disconnect (called by the frontend)
  routes_webhook.py    — POST /webhooks/{provider} (called by the providers)
  routes_lifecycle.py  — POST /lifecycle/{provider} (Graph subscription mgmt)

Adding a new provider doesn't require editing any of these files — the
provider package eagerly imports each `providers/*.py` module, which
registers the class into the registry.
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import providers as _providers  # noqa: F401  — eager registration
from .config import settings
from .db import get_db
from .routes_connect import router as connect_router
from .routes_lifecycle import router as lifecycle_router
from .routes_webhook import router as webhook_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")

app = FastAPI(title="meeting-webhooks", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # Internal-only by default; the frontend talks to us via the compose
    # service network, not from the browser. Keep this empty unless we
    # later expose the service publicly for direct browser calls.
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "").split(",") if os.getenv("CORS_ALLOW_ORIGINS") else [],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(connect_router)
app.include_router(webhook_router)
app.include_router(lifecycle_router)


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
