import { NextResponse } from 'next/server';

// Edge-runtime safe constant. Mirrors the one in src/server/auth.js — kept in
// sync manually because proxy.js can't import 'server-only' modules.
const COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-token' : 'token';

// In-memory sliding-window rate limiter for /auth/login POSTs. Single-instance
// only — for multi-instance deploys, swap to @upstash/ratelimit or similar.
// docs/07 Integration CAA 27APR2026/security overview.md §7.
const LOGIN_BUCKET = new Map();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_PER_WINDOW = 8;

function ipFromRequest(request) {
    const fwd = request.headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    return request.headers.get('x-real-ip') || 'unknown';
}

function rateLimitedLogin(request) {
    const ip = ipFromRequest(request);
    const now = Date.now();
    const cutoff = now - LOGIN_WINDOW_MS;
    const hits = (LOGIN_BUCKET.get(ip) || []).filter((t) => t > cutoff);
    if (hits.length >= LOGIN_MAX_PER_WINDOW) {
        return { limited: true, retryAfter: Math.ceil((hits[0] + LOGIN_WINDOW_MS - now) / 1000) };
    }
    hits.push(now);
    LOGIN_BUCKET.set(ip, hits);
    return { limited: false };
}

// Origin-based CSRF defence for state-changing API requests. Together with the
// SameSite=Lax cookie this gives two layers; a full double-submit token is the
// follow-up (F8 in fix-triage-frontend-vs-backend.md).
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function originIsSameSite(request) {
    const origin = request.headers.get('origin');
    if (!origin) return true; // same-origin GETs and form-encoded POSTs may omit Origin
    try {
        return new URL(origin).host === request.nextUrl.host;
    } catch {
        return false;
    }
}

function buildCsp(nonce, isDev) {
    return [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
        `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ''}`,
        "img-src 'self' blob: data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        // Audio playback in the dashboard streams from the audio_submission service.
        "media-src 'self' blob: http://localhost:8000",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
    ].join('; ');
}

export function proxy(request) {
    const { pathname } = request.nextUrl;
    const method = request.method;
    const isDev = process.env.NODE_ENV !== 'production';

    // 1. Rate limit login POSTs.
    if (pathname === '/auth/login' && method === 'POST') {
        const { limited, retryAfter } = rateLimitedLogin(request);
        if (limited) {
            return new NextResponse(
                JSON.stringify({ detail: 'Too many login attempts. Try again later.' }),
                {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': String(retryAfter),
                    },
                },
            );
        }
    }

    // 2. CSRF (origin) check on state-changing API requests. /auth/* routes
    // intentionally exempt because login itself originates from the login page
    // before any same-origin context is established by the cookie.
    if (
        pathname.startsWith('/api/') &&
        STATE_CHANGING_METHODS.has(method) &&
        !originIsSameSite(request)
    ) {
        return new NextResponse(
            JSON.stringify({ detail: 'Cross-origin request rejected.' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
    }

    // 3. Auth redirect (existing behaviour).
    const token = request.cookies.get(COOKIE_NAME)?.value;

    // API + auth endpoints return their own status codes; never redirect them.
    if (pathname.startsWith('/auth/') || pathname.startsWith('/api/')) {
        return withSecurityHeaders(NextResponse.next(), request, isDev);
    }

    if (pathname === '/login' && token) {
        return withSecurityHeaders(NextResponse.redirect(new URL('/', request.url)), request, isDev);
    }

    if (pathname !== '/login' && !token) {
        return withSecurityHeaders(NextResponse.redirect(new URL('/login', request.url)), request, isDev);
    }

    return withSecurityHeaders(NextResponse.next(), request, isDev);
}

// Per-request nonce + CSP. Next.js auto-stamps the nonce on framework scripts
// when it sees the CSP header on the request — see node_modules/next/dist/docs
// /01-app/02-guides/content-security-policy.md.
function withSecurityHeaders(response, request, isDev) {
    // Skip CSP on API routes — JSON responses don't render scripts and the
    // nonce serves no purpose there.
    if (request.nextUrl.pathname.startsWith('/api/')) return response;

    const nonce = btoa(crypto.randomUUID());
    const csp = buildCsp(nonce, isDev);

    // Stamp on both request (so Next.js's renderer picks it up) and response
    // (so the browser enforces it).
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);

    // NextResponse.next() with mutated request headers needs to be re-issued.
    // For redirect responses, we just stamp the response header and skip the
    // request header rewrite (no rendering happens).
    if (response.headers.get('location')) {
        response.headers.set('Content-Security-Policy', csp);
        return response;
    }

    const out = NextResponse.next({ request: { headers: requestHeaders } });
    out.headers.set('Content-Security-Policy', csp);
    out.headers.set('x-nonce', nonce);
    return out;
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|logo.png|login_wallpaper.webp).*)',
    ],
};
