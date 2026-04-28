import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const SVC_URL =
    process.env.FINANCIAL_TERMS_URL || 'http://financial-terms-dictionary:8009';

// GET /api/financial-terms/occurrences/stats[?kind=top_wrong|trending&limit=&since=]
//
// Drives the "Top wrong terms" and "Trending" admin tabs. Read-only; any
// authenticated user.
export const GET = requireUser(async (request, { user }) => {
    const upstream = new URL(`${SVC_URL}/occurrences/stats`);
    const incoming = request.nextUrl.searchParams;
    for (const k of ['kind', 'limit', 'since']) {
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

    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!res.ok) {
        return NextResponse.json(
            typeof data === 'object' && data ? data : { detail: data || `upstream ${res.status}` },
            { status: res.status },
        );
    }
    return NextResponse.json(data);
});
