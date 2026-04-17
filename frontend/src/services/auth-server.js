// Server-side auth helper used by the dashboard layout (a server component).
//
// Forwards the incoming Cookie header to the FastAPI /auth/me endpoint and
// returns the resolved user, or null if unauthenticated. The HttpOnly JWT
// cookie is never parsed in Node — the backend is the authority.

import { cookies, headers } from 'next/headers';

const API_BASE =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_URL ||
    'http://localhost:8002';

export async function getServerUser() {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    if (!token) return null;

    // Forward just the token cookie to keep the request minimal.
    const cookieHeader = `token=${token}`;

    try {
        const res = await fetch(`${API_BASE}/auth/me`, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Cookie: cookieHeader,
            },
            // Server-to-server; don't cache stale user data between requests.
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}
