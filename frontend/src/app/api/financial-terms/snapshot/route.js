import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const SVC_URL =
    process.env.FINANCIAL_TERMS_URL || 'http://financial-terms-dictionary:8009';

// GET /api/financial-terms/snapshot
//
// Returns { version, term_count, terms[] } — the bulk approved-terms
// list used by the FE's auto-trail hook (slice 5) to look up edit
// `before` text against the dictionary, and by the metric strategy at
// eval time. Cached client-side for ~5 min.
export const GET = requireUser(async (_request, { user }) => {
    let res;
    try {
        res = await fetch(`${SVC_URL}/dictionary/snapshot`, {
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
