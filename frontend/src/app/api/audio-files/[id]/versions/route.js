import { NextResponse } from 'next/server';

import { requireOwnerOrRole } from '@/server/route-helpers';
import { listVersions } from '@/server/transcript-versions';

export const GET = requireOwnerOrRole(async (_request, { params }) => {
    const { id } = await params;
    try {
        const versions = listVersions(id);
        return NextResponse.json({ fileId: id, versions });
    } catch (err) {
        console.error(`list versions failed for file ${id}:`, err);
        return NextResponse.json({ detail: 'Could not list versions' }, { status: 400 });
    }
});
