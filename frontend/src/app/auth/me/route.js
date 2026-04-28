import { NextResponse } from 'next/server';

import { getCurrentUserFromCookie } from '@/server/auth';

export async function GET() {
    const user = await getCurrentUserFromCookie();
    if (!user) {
        return NextResponse.json({ detail: 'No session' }, { status: 401 });
    }
    return NextResponse.json(user);
}
