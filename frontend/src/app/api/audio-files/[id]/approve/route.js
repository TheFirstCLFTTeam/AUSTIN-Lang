import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';
import { setAudioFileStatus } from '@/server/audio-files';

export const POST = requireUser(async (_request, { params, user }) => {
    const { id } = await params;
    try {
        const result = setAudioFileStatus(id, 'completed', user, {
            actionKey: 'approved',
            details: null,
        });
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ detail: err.message }, { status: 400 });
    }
});
