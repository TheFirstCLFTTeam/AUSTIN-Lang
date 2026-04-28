import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';
import { getAudioFileDetail } from '@/server/audio-files';
import { getCachedDetail, setCachedDetail, recordRecent } from '@/server/cache';

export const GET = requireUser(async (_request, { params, user }) => {
    const { id } = await params;

    // Read-through. Cache miss → SQLite → populate cache for the next caller.
    let detail = await getCachedDetail(id);
    if (!detail) {
        detail = getAudioFileDetail(id);
        if (detail) await setCachedDetail(id, detail);
    }
    if (!detail) {
        return NextResponse.json({ detail: 'File not found' }, { status: 404 });
    }

    // Fire-and-forget — never blocks the response. recordRecent itself is
    // fail-open, so a Redis outage just means no recents tracking.
    recordRecent(user?.id, id).catch(() => {});

    return NextResponse.json(detail);
});
