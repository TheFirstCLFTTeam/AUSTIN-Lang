import { NextResponse } from 'next/server';

import { issueJwt, loadUserByEmail, setAuthCookie, verifyPassword } from '@/server/auth';

export async function POST(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ detail: 'Invalid JSON' }, { status: 400 });
    }
    const { email, password } = body ?? {};
    if (!email || !password) {
        return NextResponse.json({ detail: 'Missing credentials' }, { status: 400 });
    }

    const row = loadUserByEmail(email);
    if (!row || !(await verifyPassword(password, row.password_hash))) {
        return NextResponse.json({ detail: 'Invalid email or password' }, { status: 401 });
    }

    const token = await issueJwt(row.id);
    await setAuthCookie(token);

    return NextResponse.json({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
    });
}
