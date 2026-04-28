import { NextResponse } from 'next/server';

import { requireOwnerOrRole } from '@/server/route-helpers';
import { restoreVersion } from '@/server/transcript-versions';

export const POST = requireOwnerOrRole(async (request, { params, user }) => {
    const { id, vNo } = await params;
    const versionNo = Number(vNo);
    if (!Number.isInteger(versionNo) || versionNo < 1) {
        return NextResponse.json({ detail: 'Invalid version number' }, { status: 400 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        body = {};
    }
    const existingDraft = body?.existingDraft ?? null;
    if (existingDraft && !['save', 'discard'].includes(existingDraft)) {
        return NextResponse.json(
            { detail: "existingDraft must be 'save' or 'discard'" },
            { status: 400 },
        );
    }

    try {
        const result = restoreVersion(id, versionNo, user, { existingDraft });
        return NextResponse.json({ fileId: id, ...result });
    } catch (err) {
        if (err.code === 'DIRTY_DRAFT') {
            return NextResponse.json(
                {
                    detail: err.message,
                    code: 'DIRTY_DRAFT',
                    draftVersionNo: err.draftVersionNo,
                    draftEditCount: err.draftEditCount,
                },
                { status: 409 },
            );
        }
        if (err.message === 'Version not found' || err.message === 'File not found') {
            return NextResponse.json({ detail: err.message }, { status: 404 });
        }
        console.error(`restore v${versionNo} failed for file ${id}:`, err);
        return NextResponse.json({ detail: 'Could not restore version' }, { status: 400 });
    }
});
