import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';
import { listAudioFiles } from '@/server/audio-files';

// GET /api/audio-files?scope=submitted|all|trashed
//   submitted → files owned by the current user (default)
//   all       → every non-deleted file (used by engineer-wide views)
//   trashed   → soft-deleted files (not supported yet; returns [])
export const GET = requireUser(async (request, { user }) => {
    const scope = request.nextUrl.searchParams.get('scope') || 'submitted';
    if (scope === 'trashed') {
        // audio_file has no deleted_at column yet — trash is unsupported in the DB schema.
        return NextResponse.json([]);
    }
    const rows = listAudioFiles();
    if (scope === 'submitted') {
        return NextResponse.json(rows.filter((f) => f.ownerId === user.id));
    }
    return NextResponse.json(rows);
});
