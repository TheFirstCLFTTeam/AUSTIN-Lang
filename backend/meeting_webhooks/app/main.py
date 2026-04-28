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

import asyncio
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import providers as _providers  # noqa: F401  — eager registration
from .config import settings
from .db import get_db
from .renewal import renewal_loop
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


_stop_event: asyncio.Event | None = None
_renewal_task: asyncio.Task | None = None


@app.on_event("startup")
async def _startup() -> None:
    # Eager DB open so the schema is created at boot, not on first request.
    get_db()
    # Spin up the proactive subscription-renewal loop as a daemon task.
    # Disabled when WEBHOOK_RENEWAL_ENABLED=false — useful for tests and for
    # operators who want to run renewal as a sidecar cron instead.
    if os.getenv("WEBHOOK_RENEWAL_ENABLED", "true").lower() != "false":
        global _stop_event, _renewal_task
        _stop_event = asyncio.Event()
        _renewal_task = asyncio.create_task(renewal_loop(_stop_event))


@app.on_event("shutdown")
async def _shutdown() -> None:
    if _stop_event is not None:
        _stop_event.set()
    if _renewal_task is not None:
        try:
            await asyncio.wait_for(_renewal_task, timeout=5)
        except asyncio.TimeoutError:
            _renewal_task.cancel()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":  # pragma: no cover
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
