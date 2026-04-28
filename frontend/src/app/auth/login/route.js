import { NextResponse } from 'next/server';

import { issueJwt, loadUserByEmail, setAuthCookie, verifyPassword } from '@/server/auth';
import { recordAuditEvent } from '@/server/audit';

function clientIp(request) {
    const fwd = request.headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    return request.headers.get('x-real-ip') || null;
}

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

    const ip = clientIp(request);
    const userAgent = request.headers.get('user-agent') || null;

    let row;
    try {
        row = loadUserByEmail(email);
    } catch (err) {
        return infraError(err, 'load user');
    }
    if (!row || !(await verifyPassword(password, row.password_hash))) {
        // Record the attempt under the candidate user when they exist, else as
        // a system-level event tagged with the attempted email. Either way an
        // admin reviewing the audit log can see the failure.
        try {
            recordAuditEvent({
                fileId: null,
                actor: row ? { id: row.id, name: row.name } : { id: 'system', name: 'System' },
                actionKey: 'login_failed',
                details: { email, ip, userAgent },
            });
        } catch (auditErr) {
            console.error('[auth/login] failed to record login_failed:', auditErr);
        }
        return NextResponse.json({ detail: 'Invalid email or password' }, { status: 401 });
    }

    let token;
    try {
        token = await issueJwt(row.id);
        await setAuthCookie(token);
    } catch (err) {
        return infraError(err, 'issue session');
    }

    try {
        recordAuditEvent({
            fileId: null,
            actor: { id: row.id, name: row.name },
            actionKey: 'login_succeeded',
            details: { ip, userAgent },
        });
    } catch (auditErr) {
        console.error('[auth/login] failed to record login_succeeded:', auditErr);
    }

    return NextResponse.json({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
    });
}

// Map known infra failures to a 503 with a message the LoginForm can surface,
// instead of letting them bubble up as opaque 500s. Anything else still 500s
// but with a tagged detail so the user knows where to look.
function infraError(err, stage) {
    const code = err?.code;
    console.error(`[auth/login] ${stage} failed:`, err);
    if (code === 'DB_FILE_MISSING' || code === 'DB_BINDING_BROKEN') {
        return NextResponse.json(
            { detail: err.message, code, stage },
            { status: 503 },
        );
    }
    return NextResponse.json(
        { detail: `Login is unavailable (${stage}). See server logs.`, stage },
        { status: 500 },
    );
}
