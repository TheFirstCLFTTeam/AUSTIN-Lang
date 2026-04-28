import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const METRICS_URL =
    process.env.METRICS_SERVICE_URL || 'http://metrics-service:8006';

const REQUEST_TIMEOUT_MS = 15000;

// GET /api/metrics/by-dataset?dataset=&base_model=&strategies=
//
// Side-by-side base/finetuned scores for each requested strategy. When
// `strategies` is omitted, the upstream defaults to every strategy
// recorded in the DB for the (base_model, dataset) pair — so seeded
// metrics surface even before they have a runnable MetricStrategy.
//
// See docs/06 server/metrics-service-module.md §6.2.
export const GET = requireUser(async (request) => {
    const url = new URL(request.url);
    const dataset = url.searchParams.get('dataset');
    const baseModel = url.searchParams.get('base_model');
    const strategies = url.searchParams.get('strategies');
    const seriesPoints = url.searchParams.get('series_points');

    if (!dataset || !baseModel) {
        return NextResponse.json(
            { detail: 'dataset and base_model query params are required' },
            { status: 400 },
        );
    }

    const upstream = new URL(`${METRICS_URL}/metrics/by-dataset`);
    upstream.searchParams.set('dataset', dataset);
    upstream.searchParams.set('base_model', baseModel);
    if (strategies) upstream.searchParams.set('strategies', strategies);
    if (seriesPoints) upstream.searchParams.set('series_points', seriesPoints);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(upstream.toString(), {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!res.ok) {
            // 404 from upstream means "no metrics recorded yet" — surface
            // that distinctly from a true backend failure so the UI can
            // render an empty state instead of an error toast.
            if (res.status === 404) {
                return NextResponse.json(await res.json(), { status: 404 });
            }
            return NextResponse.json(
                { detail: 'Failed to fetch metrics by dataset' },
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
