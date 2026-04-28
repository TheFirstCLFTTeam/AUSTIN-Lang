import { NextResponse } from 'next/server';

import { requireOwnerOrRole } from '@/server/route-helpers';
import { getVersion } from '@/server/transcript-versions';

export const GET = requireOwnerOrRole(async (_request, { params }) => {
    const { id, vNo } = await params;
    const versionNo = Number(vNo);
    if (!Number.isInteger(versionNo) || versionNo < 1) {
        return NextResponse.json({ detail: 'Invalid version number' }, { status: 400 });
    }
    try {
        const version = getVersion(id, versionNo);
        return NextResponse.json({ fileId: id, version });
    } catch (err) {
        if (err.message === 'Version not found') {
            return NextResponse.json({ detail: err.message }, { status: 404 });
        }
        console.error(`get version v${versionNo} failed for file ${id}:`, err);
        return NextResponse.json({ detail: 'Could not load version' }, { status: 400 });
    }
});
