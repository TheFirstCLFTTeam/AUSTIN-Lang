import { NextResponse } from 'next/server';

import { requireOwnerOrRole } from '@/server/route-helpers';
import { diffVersions } from '@/server/transcript-versions';

// Diff between this URL's version (`vNo`) and a second version (`b`),
// expressed as `/versions/{vNo}/diff/{b}`. Symmetric, so /diff/A/B and
// /diff/B/A return the same shape with `from` and `to` swapped.
export const GET = requireOwnerOrRole(async (_request, { params }) => {
    const { id, vNo, b } = await params;
    const va = Number(vNo);
    const vb = Number(b);
    if (!Number.isInteger(va) || !Number.isInteger(vb) || va < 1 || vb < 1) {
        return NextResponse.json({ detail: 'Invalid version numbers' }, { status: 400 });
    }
    try {
        const diff = diffVersions(id, va, vb);
        return NextResponse.json({ fileId: id, ...diff });
    } catch (err) {
        if (err.message === 'Version not found') {
            return NextResponse.json({ detail: err.message }, { status: 404 });
        }
        console.error(`diff v${va}↔v${vb} failed for file ${id}:`, err);
        return NextResponse.json({ detail: 'Could not compute diff' }, { status: 400 });
    }
});
