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
    const reason = body?.reason ?? null;
    try {
        const result = setAudioFileStatus(id, 'needs action', user, {
            actionKey: 'requested_changes',
            details: { comment: reason },
        });
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ detail: err.message }, { status: 400 });
    }
});
