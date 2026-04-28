import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const SVC_URL = process.env.MEETING_WEBHOOKS_URL || 'http://meeting-webhooks:8007';

// GET /api/integrations
//
// Returns { providers: [...], connections: [...] } so the Integrations page
// can render the catalogue and the user's current connections in one shot.
export const GET = requireUser(async (_request, { user }) => {
    let providers = [];
    let connections = [];
    try {
        const [pRes, cRes] = await Promise.all([
            fetch(`${SVC_URL}/providers`, { headers: { 'X-User-Id': user.id } }),
            fetch(`${SVC_URL}/connections`, { headers: { 'X-User-Id': user.id } }),
        ]);
        if (pRes.ok) providers = await pRes.json();
        if (cRes.ok) connections = await cRes.json();
    } catch (err) {
        return NextResponse.json(
            { detail: `meeting-webhooks unreachable: ${err.message}` },
            { status: 502 },
        );
    }
    return NextResponse.json({ providers, connections });
});
