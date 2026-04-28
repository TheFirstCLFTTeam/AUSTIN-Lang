import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const ORCH_URL =
    process.env.TRAINING_ORCHESTRATOR_URL ||
    'http://training-orchestrator:8008';

const REQUEST_TIMEOUT_MS = 15000;

// POST /api/training-jobs/:id/cancel — cancel a queued/preparing/running/paused job.

export const POST = requireUser(async (_request, { params }) => {
    const { id } = await params;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(
            `${ORCH_URL}/jobs/${encodeURIComponent(id)}/cancel`,
            {
                method: 'POST',
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            },
        );
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        return NextResponse.json(data, { status: res.status });
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
