import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';
import { getAudioFileDetail } from '@/server/audio-files';
import { invalidateDetail } from '@/server/cache';
import { applyEdits } from '@/lib/transcriptEdits';

const ORCHESTRATOR_URL =
    process.env.PSEUDONYM_ORCHESTRATOR_URL ||
    'http://pseudonymisation-orchestrator:5002';

// POST /api/pseudonymisation/:fileId/run
//
// Kicks off a stateful pseudonymisation run on the orchestrator. The run
// produces persistent spans that reviewers can later accept or reject via
// the decision endpoint. Uses the currently edited transcript (raw + edits
// applied) so what's pseudonymised matches what the reviewer is looking at.
export const POST = requireUser(async (request, { params, user }) => {
    const { fileId } = await params;
    let body = {};
    try { body = await request.json(); } catch { /* empty body is fine */ }
    const reviewerId = body?.reviewerId || null;

    const detail = getAudioFileDetail(fileId);
    if (!detail) {
        return NextResponse.json({ detail: 'File not found' }, { status: 404 });
    }

    const rawSegments = detail.rawTranscript?.transcript_segments || [];
    const applied = applyEdits(rawSegments, detail.edits || []);
    const segments = applied.map((s) => ({
        id: String(s.id),
        text: String(s.text || ''),
    }));

    try {
        const res = await fetch(
            `${ORCHESTRATOR_URL}/transcripts/${encodeURIComponent(fileId)}/submit-for-review`,
            {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-User-Id': user.id,
                    'X-User-Role': user.role || 'user',
                },
                body: JSON.stringify({
                    submitter_id: user.id,
                    reviewer_id: reviewerId,
                    segments,
                }),
            },
        );
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            return NextResponse.json(
                { detail: `Orchestrator ${res.status}: ${text}` },
                { status: 502 },
            );
        }
        // Kicking off a run flips the flag pair on the file detail —
        // drop the cache so the next read picks up the fresh state.
        await invalidateDetail(fileId);
        return NextResponse.json(await res.json());
    } catch (err) {
        return NextResponse.json(
            { detail: `Orchestrator unreachable: ${err.message}` },
            { status: 502 },
        );
    }
});
