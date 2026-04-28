// Server-side auth helper used by the dashboard layout (a server component).
//
// Real mode: decodes the HttpOnly JWT cookie and loads the user from users.db.
// Mock mode: parses the readable 'token=MOCK-<userId>' cookie that the
// client-side mock login sets, and looks the user up in the in-memory mock
// users fixture. No DB is involved.

import { cookies } from 'next/headers';

import { users as MOCK_USERS } from './mock-data';

const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_API === 'true';

export async function getServerUser() {
    if (MOCK_MODE) {
        const store = await cookies();
        const raw = store.get('token')?.value;
        if (!raw || !raw.startsWith('MOCK-')) return null;
        const userId = raw.slice('MOCK-'.length);
        const user = MOCK_USERS.find((u) => u.id === userId);
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
    }

    // Real mode — lazy-load so mock-mode builds never require the SQLite
    // driver or open a DB connection.
    const { getCurrentUserFromCookie } = await import('@/server/auth');
    return getCurrentUserFromCookie();
}
