import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const ORCH_URL =
    process.env.TRAINING_ORCHESTRATOR_URL ||
    'http://training-orchestrator:8008';

const REQUEST_TIMEOUT_MS = 15000;

// GET /api/training-jobs/:id — single-job detail.

export const GET = requireUser(async (_request, { params }) => {
    const { id } = await params;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(
            `${ORCH_URL}/jobs/${encodeURIComponent(id)}`,
            { headers: { Accept: 'application/json' }, signal: controller.signal },
        );
        if (res.status === 404) {
            return NextResponse.json(await res.json(), { status: 404 });
        }
        if (!res.ok) {
            return NextResponse.json(
                { detail: 'Failed to fetch training job' },
                { status: 502 },
            );
        }
        return NextResponse.json(await res.json());
    } catch (err) {
        const aborted = err?.name === 'AbortError';
        return NextResponse.json(
            { detail: aborted ? 'Training-orchestrator timed out' : 'Training-orchestrator unreachable' },
            { status: aborted ? 504 : 502 },
        );
    } finally {
        clearTimeout(timer);
    }
});
