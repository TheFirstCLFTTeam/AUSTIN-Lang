import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const ORCHESTRATOR_URL =
    process.env.PSEUDONYM_ORCHESTRATOR_URL ||
    'http://pseudonymisation-orchestrator:5002';

// GET /api/pseudonymisation/:fileId/spans
//
// Proxies the pseudonymisation orchestrator. Reviewers and admins see the
// decrypted `original_text`; all other roles get it null. The orchestrator
// enforces this off the X-User-Role header — we forward the session role.
export const GET = requireUser(async (_request, { params, user }) => {
    const { fileId } = await params;
    try {
        const res = await fetch(
            `${ORCHESTRATOR_URL}/transcripts/${encodeURIComponent(fileId)}/pseudonymisation`,
            {
                headers: {
                    Accept: 'application/json',
                    'X-User-Id': user.id,
                    'X-User-Role': user.role || 'user',
                },
            },
        );
        if (res.status === 404) {
            return NextResponse.json({ run: null, spans: [] });
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            return NextResponse.json(
                { detail: `Orchestrator ${res.status}: ${text}` },
                { status: 502 },
            );
        }
        return NextResponse.json(await res.json());
    } catch (err) {
        return NextResponse.json(
            { detail: `Orchestrator unreachable: ${err.message}` },
            { status: 502 },
        );
    }
});
