import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const METRICS_URL =
    process.env.METRICS_SERVICE_URL || 'http://metrics-service:8006';

const REQUEST_TIMEOUT_MS = 15000;

// POST /api/metrics/refresh — busts the metrics service's 60s in-memory
// cache after an edit/approve so the dashboard reflects the change without
// waiting for the TTL. Failures are caller-handled (non-fatal upstream).
export const POST = requireUser(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${METRICS_URL}/metrics/refresh`, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!res.ok) {
            return NextResponse.json(
                { detail: 'Failed to refresh metrics cache' },
                { status: 502 },
            );
        }
        return NextResponse.json(await res.json());
    } catch (err) {
        const aborted = err?.name === 'AbortError';
        return NextResponse.json(
            { detail: aborted ? 'Refresh request timed out' : 'Metrics service unreachable' },
            { status: aborted ? 504 : 502 },
        );
    } finally {
        clearTimeout(timer);
    }
});
