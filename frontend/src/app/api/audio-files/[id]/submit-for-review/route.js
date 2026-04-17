import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';
import { setAudioFileStatus } from '@/server/audio-files';

export const POST = requireUser(async (request, { params, user }) => {
    const { id } = await params;
    let body;
    try {
        body = await request.json();
    } catch {
        body = {};
    }
    const reviewerId = body?.reviewerId || null;
    try {
        const result = setAudioFileStatus(id, 'in review', user, {
            actionKey: 'submitted_for_review',
            details: { reviewerId },
        });
        return NextResponse.json({ ...result, reviewerId });
    } catch (err) {
        return NextResponse.json({ detail: err.message }, { status: 400 });
    }
});
