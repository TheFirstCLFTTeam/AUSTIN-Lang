import 'server-only';

import { NextResponse } from 'next/server';

import { getCurrentUserFromCookie } from './auth';
import { platformDb } from './db';

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

// Roles that are allowed to act on any file regardless of ownership. Mirrors
// the role values seeded in users.db `user.role`.
const FILE_ELEVATED_ROLES = new Set(['admin', 'reviewer', 'engineer']);

// Resolves the owning user id of an audio_file by its external_id (or numeric
// id, since the upload flow inserts both). Returns null when the file doesn't
// exist.
function loadOwnerId(fileId) {
    const row = platformDb()
        .prepare(
            `SELECT owner_id FROM audio_file WHERE external_id = ? OR id = ?`
        )
        .get(String(fileId), Number(fileId) || -1);
    return row ? row.owner_id : null;
}

// Wraps a route handler that mutates an audio_file. Allows the call when the
// caller owns the file OR holds an elevated role. Returns 401 if there's no
// session, 404 if the file is missing, 403 if the user is neither owner nor
// elevated. The file id is read from `params.id`.
//
// docs/07 Integration CAA 27APR2026/fix-triage-frontend-vs-backend.md F4.
export function requireOwnerOrRole(handler, { roles = FILE_ELEVATED_ROLES } = {}) {
    const allowed = roles instanceof Set ? roles : new Set(roles);
    return requireUser(async (request, context) => {
        const { params, user } = context;
        const resolvedParams = await params;
        const fileId = resolvedParams?.id;
        const ownerId = loadOwnerId(fileId);
        if (ownerId === null) {
            return NextResponse.json({ detail: 'File not found' }, { status: 404 });
        }
        if (ownerId !== user.id && !allowed.has(user.role)) {
            return NextResponse.json({ detail: 'Forbidden' }, { status: 403 });
        }
        return handler(request, { ...context, params: Promise.resolve(resolvedParams), user });
    });
}
