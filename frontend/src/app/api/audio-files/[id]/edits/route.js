import { NextResponse } from 'next/server';

import { requireOwnerOrRole } from '@/server/route-helpers';
import { writeEditsForFile } from '@/server/audio-files';

export const PUT = requireOwnerOrRole(async (request, { params, user }) => {
    const { id } = await params;
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 });
    }
    const edits = Array.isArray(body?.edits) ? body.edits : [];
    try {
        await writeEditsForFile(id, edits, user);
    } catch (err) {
        console.error(`edits write failed for file ${id}:`, err);
        return NextResponse.json({ detail: 'Could not save edits' }, { status: 400 });
    }
    return NextResponse.json({ fileId: id, edits });
});
