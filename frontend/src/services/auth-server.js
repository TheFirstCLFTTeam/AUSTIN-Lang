// Server-side auth helper used by the dashboard layout (a server component).
//
// Resolves the current user from the HttpOnly JWT cookie by talking to the
// local SQLite-backed helpers directly — no HTTP round-trip, since this code
// already runs on the Next.js server.

import { getCurrentUserFromCookie } from '@/server/auth';

export async function getServerUser() {
    return getCurrentUserFromCookie();
}
