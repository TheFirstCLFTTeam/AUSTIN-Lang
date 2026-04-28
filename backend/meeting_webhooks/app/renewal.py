"""Proactive subscription renewal.

Microsoft Graph `callRecording` subscriptions max out at 3 days; a renewal
job is mandatory infrastructure, not optional. The lifecycle handler
covers the reactive `reauthorizationRequired` event, but Graph doesn't
guarantee that fires before expiry — we still need to PATCH proactively.

This module spins up a single asyncio task on FastAPI startup. Every
`RENEWAL_INTERVAL_SECONDS` it scans the `subscription` table for rows
expiring within 36 hours and asks the matching provider to renew them.

Provider-agnostic: any provider that overrides `renew_subscription` is
picked up automatically. Providers without subscription state (Zoom,
generic) raise NotImplementedError from the base class and the loop
skips them silently.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

from .db import get_db, list_subscriptions_for_renewal, list_providers_with_subscriptions
from .providers.base import get_provider, list_providers

log = logging.getLogger(__name__)

# Default 30 min — tight enough that even a 36h window has many retry
# opportunities, loose enough to never thunder against Graph.
RENEWAL_INTERVAL_SECONDS = int(os.getenv("WEBHOOK_RENEWAL_INTERVAL_SECONDS", "1800"))


async def renewal_loop(stop_event: asyncio.Event) -> None:
    """Run until `stop_event` is set. Each iteration renews everything
    eligible across every provider that supports it."""
    log.info(
        "renewal loop starting (interval=%ds)", RENEWAL_INTERVAL_SECONDS,
    )
    while not stop_event.is_set():
        try:
            await _tick()
        except Exception:
            log.exception("renewal tick crashed")
        # Sleep until the next tick OR the stop event fires, whichever first.
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=RENEWAL_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            continue
    log.info("renewal loop stopped")


async def _tick() -> None:
    for provider in list_providers():
        # A provider that hasn't overridden renew_subscription has no
        # subscriptions to maintain. Skip without instantiating the DB
        # query so providers like Zoom/generic don't appear in logs.
        if type(provider).renew_subscription is _base_renew:
            continue

        rows = list_subscriptions_for_renewal(provider=provider.id)
        if not rows:
            continue
        log.info("renewing %d %s subscription(s)", len(rows), provider.id)
        for row in rows:
            try:
                new_expiry = await provider.renew_subscription(row["external_id"])
            except NotImplementedError:
                continue
            except Exception:
                log.exception(
                    "renew_subscription failed for %s/%s",
                    provider.id, row["external_id"],
                )
                continue
            get_db().execute(
                """UPDATE subscription
                      SET expires_at = ?, last_renewed_at = datetime('now')
                    WHERE provider = ? AND external_id = ?""",
                (new_expiry, provider.id, row["external_id"]),
            )
            log.info(
                "renewed %s/%s -> %s", provider.id, row["external_id"], new_expiry,
            )


# Reference to BaseProvider's default impl, used to detect "did this
# provider override the method?" without import gymnastics.
from .providers.base import BaseProvider as _BaseProvider  # noqa: E402

_base_renew = _BaseProvider.renew_subscription
