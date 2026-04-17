'use client';

// Receives the server-resolved user object from the dashboard layout and
// writes it into sessionStorage so sync getCurrentUser() call sites resolve
// without a round-trip. Renders nothing.

import { useEffect } from 'react';
import { setCachedUser, bootstrapAuth } from '@/services/api';

export default function AuthHydrator({ user }) {
    useEffect(() => {
        if (user) {
            setCachedUser(user);
            return;
        }
        // Fallback: if the server didn't pre-resolve (e.g. API was down during
        // SSR), try once from the client. This keeps the UX soft — the page
        // will unblock and features that require the user will re-render.
        bootstrapAuth().catch(() => {});
    }, [user]);

    return null;
}
