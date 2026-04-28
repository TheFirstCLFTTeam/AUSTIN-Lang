import { NextResponse } from 'next/server';

import { clearAuthCookie, getCurrentUserFromCookie } from '@/server/auth';
import { recordAuditEvent } from '@/server/audit';

export async function POST() {
    const user = await getCurrentUserFromCookie();
    await clearAuthCookie();
    if (user) {
        try {
            recordAuditEvent({
                fileId: null,
                actor: { id: user.id, name: user.name },
                actionKey: 'logout',
                details: null,
            });
        } catch (err) {
            console.error('[auth/logout] failed to record logout:', err);
        }
    }
    return NextResponse.json({ ok: true });
}
