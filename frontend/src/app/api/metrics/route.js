import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const METRICS_URL =
    process.env.METRICS_SERVICE_URL || 'http://metrics-service:8006';

const REQUEST_TIMEOUT_MS = 15000;

// GET /api/metrics — proxies the operational dashboard aggregate from the
// metrics service. Keeps the backend URL server-side and avoids a CORS hop.
// See docs/06 server/metrics-service-module.md §6.1.
export const GET = requireUser(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${METRICS_URL}/metrics/dashboard`, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!res.ok) {
            return NextResponse.json(
                { detail: 'Failed to fetch metrics' },
                { status: 502 },
            );
        }
        return NextResponse.json(await res.json());
    } catch (err) {
        const aborted = err?.name === 'AbortError';
        return NextResponse.json(
            { detail: aborted ? 'Metrics request timed out' : 'Metrics service unreachable' },
            { status: aborted ? 504 : 502 },
        );
    } finally {
        clearTimeout(timer);
    }
});
