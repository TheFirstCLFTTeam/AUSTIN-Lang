import { NextResponse } from 'next/server';

import { requireOwnerOrRole } from '@/server/route-helpers';
import { setAudioFileStatus } from '@/server/audio-files';

const ORCHESTRATOR_URL =
    process.env.PSEUDONYM_ORCHESTRATOR_URL ||
    'http://pseudonymisation-orchestrator:5002';

// Before marking a transcript completed, run it past the pseudonymisation
// orchestrator's approve guard. The guard refuses approval when spans exist
// but have not all been decided (NFR-S02). We pass through 409 for that
// case; if there's simply no run on file (404), we fall through and approve
// locally — otherwise legacy transcripts with no pseudonymisation history
// couldn't be approved.
async function checkOrchestratorGuard(fileId, user) {
    let res;
    try {
        res = await fetch(
            `${ORCHESTRATOR_URL}/transcripts/${encodeURIComponent(fileId)}/approve`,
            {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'X-User-Id': user.id,
                    // F3 — pass the authenticated user's actual role rather than
                    // hardcoding 'reviewer'. The orchestrator's role check is
                    // still defence-in-depth only; it should be replaced by JWT
                    // verification (see fix-triage-frontend-vs-backend.md F3 BE side).
                    'X-User-Role': user.role || 'generic',
                },
            },
        );
    } catch {
        return { allow: true, reason: 'orchestrator-unreachable' };
    }

    if (res.ok) return { allow: true };
    if (res.status === 404 || res.status === 409) {
        const body = await res.json().catch(() => ({}));
        const detail = (body?.detail || '').toLowerCase();
        // "no pseudonymisation run" → allow (nothing to guard)
        if (detail.includes('no pseudonymisation')) return { allow: true };
        // "run status is ..." (still running) or "every span must have a decision"
        return { allow: false, status: res.status, detail: body?.detail || 'Not approvable' };
    }
    // Unknown error — don't block.
    return { allow: true, reason: `orchestrator-${res.status}` };
}

export const POST = requireOwnerOrRole(async (_request, { params, user }) => {
    const { id } = await params;

    const guard = await checkOrchestratorGuard(id, user);
    if (!guard.allow) {
        return NextResponse.json(
            { detail: guard.detail },
            { status: guard.status || 409 },
        );
    }

    try {
        const result = setAudioFileStatus(id, 'completed', user, {
            actionKey: 'approved',
            details: null,
        });
        return NextResponse.json(result);
    } catch (err) {
        console.error(`approve route failed for file ${id}:`, err);
        return NextResponse.json({ detail: 'Could not approve transcript' }, { status: 400 });
    }
});
