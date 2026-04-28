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
    const reason = body?.reason ?? null;
    try {
        const result = setAudioFileStatus(id, 'needs action', user, {
            actionKey: 'requested_changes',
            details: { comment: reason },
        });
        return NextResponse.json(result);
    } catch (err) {
        console.error(`request-changes failed for file ${id}:`, err);
        return NextResponse.json({ detail: 'Could not request changes' }, { status: 400 });
    }
});
