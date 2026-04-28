import { NextResponse } from 'next/server';

import { requireOwnerOrRole } from '@/server/route-helpers';
import { setAudioFileStatus } from '@/server/audio-files';

export const POST = requireOwnerOrRole(async (request, { params, user }) => {
    const { id } = await params;
    let body;
    try {
        body = await request.json();
    } catch {
        body = {};
    }
    const reviewerId = body?.reviewerId || null;
    try {
        const result = await setAudioFileStatus(id, 'in review', user, {
            actionKey: 'submitted_for_review',
            details: { reviewerId },
        });
        return NextResponse.json({ ...result, reviewerId });
    } catch (err) {
        console.error(`submit-for-review failed for file ${id}:`, err);
        return NextResponse.json({ detail: 'Could not submit for review' }, { status: 400 });
    }
});
