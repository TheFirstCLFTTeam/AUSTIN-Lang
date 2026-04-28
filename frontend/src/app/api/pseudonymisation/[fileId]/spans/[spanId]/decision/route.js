import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const ORCHESTRATOR_URL =
    process.env.PSEUDONYM_ORCHESTRATOR_URL ||
    'http://pseudonymisation-orchestrator:5002';

// POST /api/pseudonymisation/:fileId/spans/:spanId/decision
// Body: { decision: 'accepted' | 'rejected', note?: string }
//
// Only reviewers may decide. The orchestrator enforces this via X-User-Role;
// we also gate locally so non-reviewers get a 403 without a round-trip.
export const POST = requireUser(async (request, { params, user }) => {
    const role = (user.role || '').toLowerCase();
    if (role !== 'reviewer' && role !== 'admin') {
        return NextResponse.json(
            { detail: 'Only reviewers may decide spans' },
            { status: 403 },
        );
    }

    const { fileId, spanId } = await params;
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 });
    }

    try {
        const res = await fetch(
            `${ORCHESTRATOR_URL}/transcripts/${encodeURIComponent(fileId)}` +
                `/pseudonymisation/spans/${encodeURIComponent(spanId)}/decision`,
            {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-User-Id': user.id,
                    // Orchestrator only accepts 'reviewer'; normalise admin → reviewer.
                    'X-User-Role': 'reviewer',
                },
                body: JSON.stringify(body),
            },
        );
        const text = await res.text();
        if (!res.ok) {
            return NextResponse.json(
                { detail: text || `Orchestrator ${res.status}` },
                { status: res.status },
            );
        }
        return new NextResponse(text, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err) {
        return NextResponse.json(
            { detail: `Orchestrator unreachable: ${err.message}` },
            { status: 502 },
        );
    }
});
