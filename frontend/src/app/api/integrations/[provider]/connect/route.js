import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const SVC_URL = process.env.MEETING_WEBHOOKS_URL || 'http://meeting-webhooks:8007';

// POST /api/integrations/{provider}/connect
//
// Kicks off the Connect flow on the meeting-webhooks service. Returns
// { redirect_url } when the provider needs an OAuth/admin-consent redirect,
// or { instructions } for providers that require admin install (Zoom S2S).
// In mock mode the service finalises the connection immediately and the
// response carries no redirect.
export const POST = requireUser(async (request, { user, params }) => {
    const { provider } = await params;
    const origin = request.nextUrl.origin;
    const redirectUri = `${origin}/integrations?callback=${encodeURIComponent(provider)}`;

    let body;
    try {
        body = await request.json();
    } catch {
        body = {};
    }

    let res;
    try {
        res = await fetch(`${SVC_URL}/connect/${encodeURIComponent(provider)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User-Id': user.id,
            },
            body: JSON.stringify({ redirect_uri: redirectUri, ...body }),
        });
    } catch (err) {
        return NextResponse.json(
            { detail: `meeting-webhooks unreachable: ${err.message}` },
            { status: 502 },
        );
    }
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
        return NextResponse.json(
            { detail: data?.detail || `connect failed (${res.status})` },
            { status: res.status },
        );
    }
    return NextResponse.json(data);
});

function safeJson(text) {
    try { return JSON.parse(text); } catch { return text; }
}
