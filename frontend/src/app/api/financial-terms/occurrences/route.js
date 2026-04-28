import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const SVC_URL =
    process.env.FINANCIAL_TERMS_URL || 'http://financial-terms-dictionary:8009';

// POST /api/financial-terms/occurrences
// Body: { term_id, audio_file_external_id, correctly_transcribed }
//
// Records an occurrence. Two callers:
//   1. The explicit "💼 Add to dictionary" modal (slice 3 — user toggled
//      "did the model get it right?")
//   2. The auto-trail hook in writeEditsForFile (slice 5 — fires
//      automatically when a reviewer corrects a word that's already in
//      the approved dictionary).
export const POST = requireUser(async (request, { user }) => {
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 });
    }

    let res;
    try {
        res = await fetch(`${SVC_URL}/occurrences`, {
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
