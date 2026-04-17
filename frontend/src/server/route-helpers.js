import 'server-only';

import { NextResponse } from 'next/server';

import { getCurrentUserFromCookie } from './auth';

// Wraps a route handler with a cookie-auth check. The handler receives the
// resolved user as its second argument. Returns 401 if no session.
export function requireUser(handler) {
    return async (request, context) => {
        const user = await getCurrentUserFromCookie();
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
        }
        return handler(request, { ...context, user });
    };
}
