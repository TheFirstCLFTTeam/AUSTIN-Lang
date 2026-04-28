import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const ORCH_URL =
    process.env.TRAINING_ORCHESTRATOR_URL ||
    'http://training-orchestrator:8008';

const REQUEST_TIMEOUT_MS = 15000;

// GET /api/training-jobs[?submitter=&status=&limit=]
// POST /api/training-jobs                            (submit a new job)
//
// Same-origin proxy to the training-orchestrator. The submission body is
// passed through after stamping `submitted_by` from the cookie session,
// so the FE can't claim to be another user. Upstream:
// docs/07 Integration CAA 27APR2026/training-job-pipeline.md §4.1.

export const GET = requireUser(async (request) => {
    const url = new URL(request.url);
    const upstream = new URL(`${ORCH_URL}/jobs`);
    for (const key of ['submitter', 'status', 'limit']) {
        const v = url.searchParams.get(key);
        if (v) upstream.searchParams.set(key, v);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(upstream.toString(), {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!res.ok) {
            return NextResponse.json(
                { detail: 'Failed to list training jobs' },
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

export const POST = requireUser(async (request, { user }) => {
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ detail: 'Body must be JSON' }, { status: 400 });
    }
    // Stamp the submitter from the session — never trust a client-supplied
    // submitted_by. F4 spirit: prevent IDOR via job ownership claims.
    const payload = { ...body, submitted_by: user.id };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${ORCH_URL}/jobs`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        // Pass upstream validation errors through unchanged (400/501/etc.)
        // so the dialog can surface the orchestrator's reason.
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
