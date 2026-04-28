import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const ORCHESTRATOR_URL =
    process.env.TRANSCRIPTION_ORCHESTRATOR_URL ||
    'http://transcription-orchestrator:8001';

// GET /api/adapters — proxies the orchestrator's adapter list. Keeps the
// backend URL server-side and lets the upload page discover what LoRA
// adapters are available without a CORS hop.
export const GET = requireUser(async () => {
    try {
        const res = await fetch(`${ORCHESTRATOR_URL}/adapters/`, {
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
            return NextResponse.json({ adapters: ['base'] });
        }
        return NextResponse.json(await res.json());
    } catch {
        return NextResponse.json({ adapters: ['base'] });
    }
});
