import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const SVC_URL =
    process.env.FINANCIAL_TERMS_URL || 'http://financial-terms-dictionary:8009';

// GET /api/financial-terms[?status=&category=&q=&limit=&offset=]
//
// Forwards to the dictionary service's /terms endpoint. The microservice
// gates submission by role (reviewer/engineer/admin) but allows all
// authenticated users to read.
export const GET = requireUser(async (request, { user }) => {
    const upstream = new URL(`${SVC_URL}/terms`);
    const incoming = request.nextUrl.searchParams;
    for (const k of ['status', 'category', 'q', 'limit', 'offset']) {
        const v = incoming.get(k);
        if (v != null) upstream.searchParams.set(k, v);
    }

    let res;
    try {
        res = await fetch(upstream.toString(), {
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

// POST /api/financial-terms
// Body: { term, category?, definition?, source_file_id?, notes? }
//
// Lands as `pending` in the dictionary service. Role gate (submitter
// roles only) is enforced upstream — we forward the cookie user's role
// verbatim so a generic user submitting from the wire gets a 403.
export const POST = requireUser(async (request, { user }) => {
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 });
    }

    let res;
    try {
        res = await fetch(`${SVC_URL}/terms`, {
            method: 'POST',
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
