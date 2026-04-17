import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';
import { writeEditsForFile } from '@/server/audio-files';

export const PUT = requireUser(async (request, { params, user }) => {
    const { id } = await params;
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 });
    }
    const edits = Array.isArray(body?.edits) ? body.edits : [];
    try {
        writeEditsForFile(id, edits, user);
    } catch (err) {
        return NextResponse.json({ detail: err.message }, { status: 400 });
    }
    return NextResponse.json({ fileId: id, edits });
});
