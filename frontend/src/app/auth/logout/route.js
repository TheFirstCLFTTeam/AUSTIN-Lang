import { NextResponse } from 'next/server';

import { clearAuthCookie } from '@/server/auth';

export async function POST() {
    await clearAuthCookie();
    return NextResponse.json({ ok: true });
}
