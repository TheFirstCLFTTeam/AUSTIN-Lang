import { NextResponse } from 'next/server';

export function proxy(request) {
    const token = request.cookies.get('token')?.value;
    const { pathname } = request.nextUrl;

    if (pathname === '/login' && token) {
        return NextResponse.redirect(new URL('/', request.url));
    }

    if (pathname !== '/login' && !token) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|logo.png|login_wallpaper.webp).*)',
    ],
};
