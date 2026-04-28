import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const SVC_URL =
    process.env.FINANCIAL_TERMS_URL || 'http://financial-terms-dictionary:8009';

// GET /api/financial-terms/{id}
export const GET = requireUser(async (_request, { params, user }) => {
    const { id } = await params;
    let res;
    try {
        res = await fetch(`${SVC_URL}/terms/${encodeURIComponent(id)}`, {
            headers: {
                Accept: 'application/json',
                'X-User-Id': user.id,
                'X-User-Role': user.role || 'generic',
            },
        });
    } catch (err) {
        return NextResponse.json(
            { detail: `financial-terms-dictionary unreachable: ${err.message}` },
            { status: 502 },
        );
    }
    return relay(res);
});

// PATCH /api/financial-terms/{id}
// Body: { status?, category?, definition?, notes? }
// Admin only — upstream enforces. Forwards the role so a non-admin
// PATCHing from the wire gets a 403 there, not a silent pass.
export const PATCH = requireUser(async (request, { params, user }) => {
    const { id } = await params;
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 });
    }

    let res;
    try {
        res = await fetch(`${SVC_URL}/terms/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-User-Id': user.id,
                'X-User-Role': user.role || 'generic',
            },
            body: JSON.stringify(body),
        });
    } catch (err) {
        return NextResponse.json(
            { detail: `financial-terms-dictionary unreachable: ${err.message}` },
            { status: 502 },
        );
    }
    return relay(res);
});

async function relay(res) {
    const text = await res.text();
    let data = null;
    if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
        return NextResponse.json(
            typeof data === 'object' && data ? data : { detail: data || `upstream ${res.status}` },
            { status: res.status },
        );
    }
    return NextResponse.json(data);
}
