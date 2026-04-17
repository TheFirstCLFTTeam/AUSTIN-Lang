import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';
import { getUserProfile } from '@/server/user-profile';

export const GET = requireUser(async (_request, { user }) => {
    const profile = getUserProfile(user.id);
    if (!profile) {
        return NextResponse.json({ detail: 'Profile not found' }, { status: 404 });
    }
    return NextResponse.json(profile);
});
