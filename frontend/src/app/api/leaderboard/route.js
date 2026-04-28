import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const METRICS_URL =
    process.env.METRICS_SERVICE_URL || 'http://metrics-service:8006';

const REQUEST_TIMEOUT_MS = 15000;

// GET /api/leaderboard?dataset_id=…&base_family=…&only_finetuned=…
//
// Proxies the metrics-service ranking endpoint. Empty result is a 200
// with `rows: []`, not an error — the FE then falls back to the mock
// fixture so the page never blanks. Distinguishes 404 (dataset not
// known) from 502 (upstream down) so the dashboard can render
// different states. See docs/07 Integration CAA 27APR2026/training-job-
// pipeline.md §4.7.
export const GET = requireUser(async (request) => {
    const url = new URL(request.url);
    const datasetId = url.searchParams.get('dataset_id');
    if (!datasetId) {
        return NextResponse.json(
            { detail: 'dataset_id query parameter is required' },
            { status: 400 },
        );
    }

    const upstream = new URL(`${METRICS_URL}/leaderboard`);
    upstream.searchParams.set('dataset_id', datasetId);
    for (const key of ['base_family', 'only_finetuned', 'limit']) {
        const v = url.searchParams.get(key);
        if (v != null && v !== '') upstream.searchParams.set(key, v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(upstream.toString(), {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (res.status === 404) {
            return NextResponse.json(await res.json(), { status: 404 });
        }
        if (!res.ok) {
            return NextResponse.json(
                { detail: 'Failed to fetch leaderboard' },
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
