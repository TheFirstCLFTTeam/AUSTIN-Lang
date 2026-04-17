import 'server-only';

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

import { usersDb } from './db';

const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'dev-only-not-for-production-please-set-JWT_SECRET'
);
const JWT_ALG = 'HS256';
const JWT_TTL_SEC = 12 * 60 * 60;
export const COOKIE_NAME = 'token';

export async function verifyPassword(plaintext, hashed) {
    if (!hashed) return false;
    try {
        return await bcrypt.compare(plaintext, hashed);
    } catch {
        return false;
    }
}

export async function issueJwt(userId) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
        .setProtectedHeader({ alg: JWT_ALG })
        .setSubject(userId)
        .setIssuedAt(now)
        .setExpirationTime(now + JWT_TTL_SEC)
        .sign(JWT_SECRET);
}

export async function decodeJwt(token) {
    try {
        const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: [JWT_ALG] });
        return payload;
    } catch {
        return null;
    }
}

export function loadUserById(userId) {
    return usersDb()
        .prepare(`SELECT id, email, name, role FROM "user" WHERE id = ?`)
        .get(userId) ?? null;
}

export function loadUserByEmail(email) {
    return usersDb()
        .prepare(`SELECT id, email, name, role, password_hash FROM "user" WHERE email = ?`)
        .get(email) ?? null;
}

export async function setAuthCookie(token) {
    const store = await cookies();
    store.set({
        name: COOKIE_NAME,
        value: token,
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: JWT_TTL_SEC,
    });
}

export async function clearAuthCookie() {
    const store = await cookies();
    store.delete(COOKIE_NAME);
}

// Resolve the authenticated user from the request cookie. Returns null if no
// session or invalid token. Use in route handlers and server components.
export async function getCurrentUserFromCookie() {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const payload = await decodeJwt(token);
    if (!payload?.sub) return null;
    return loadUserById(payload.sub);
}
