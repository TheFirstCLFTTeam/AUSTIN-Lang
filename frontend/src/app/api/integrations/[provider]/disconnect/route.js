import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const SVC_URL = process.env.MEETING_WEBHOOKS_URL || 'http://meeting-webhooks:8007';

// POST /api/integrations/{provider}/disconnect
export const POST = requireUser(async (_request, { user, params }) => {
    const { provider } = await params;
    let res;
    try {
        res = await fetch(`${SVC_URL}/connect/${encodeURIComponent(provider)}`, {
            method: 'DELETE',
            headers: { 'X-User-Id': user.id },
        });
    } catch (err) {
        return NextResponse.json(
            { detail: `meeting-webhooks unreachable: ${err.message}` },
            { status: 502 },
        );
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        return NextResponse.json(
            { detail: `disconnect failed (${res.status}) ${text}` },
            { status: res.status },
        );
    }
    return NextResponse.json(await res.json());
});
