import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';
import { listRecents } from '@/server/cache';

// GET /api/recents → { items: [{ id, accessedAt }, …] }
//
// Server-side mirror of the per-user recently-viewed list. Survives device
// switches and incognito sessions, unlike the localStorage list in
// src/lib/recents.js. The client merges both — see hydrateFromServer().
export const GET = requireUser(async (_request, { user }) => {
    const items = await listRecents(user?.id);
    return NextResponse.json({ items });
});
