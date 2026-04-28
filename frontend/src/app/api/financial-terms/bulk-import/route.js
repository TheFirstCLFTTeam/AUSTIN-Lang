import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const SVC_URL =
    process.env.FINANCIAL_TERMS_URL || 'http://financial-terms-dictionary:8009';

// POST /api/financial-terms/bulk-import
// Body (optional): { csv_path }
//
// Re-runs the seed importer. Admin only — upstream enforces, but we
// short-circuit obvious non-admin callers here so they don't hit the
// network.
export const POST = requireUser(async (request, { user }) => {
    if ((user.role || '').toLowerCase() !== 'admin') {
        return NextResponse.json(
            { detail: 'admin role required' },
            { status: 403 },
        );
    }

    let body;
    try {
        body = await request.json();
    } catch {
        body = {};
    }

    let res;
    try {
        res = await fetch(`${SVC_URL}/terms/bulk-import`, {
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
