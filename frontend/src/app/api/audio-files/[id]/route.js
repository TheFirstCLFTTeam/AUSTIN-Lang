import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';
import { getAudioFileDetail } from '@/server/audio-files';

export const GET = requireUser(async (_request, { params }) => {
    const { id } = await params;
    const detail = getAudioFileDetail(id);
    if (!detail) {
        return NextResponse.json({ detail: 'File not found' }, { status: 404 });
    }
    return NextResponse.json(detail);
});
