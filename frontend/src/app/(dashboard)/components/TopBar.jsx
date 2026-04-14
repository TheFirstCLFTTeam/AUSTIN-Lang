'use client';

import Link from 'next/link';
import LogoutButton from './LogoutButton';

export default function TopBar({ userRole }) {
    return (
        <header className="flex items-center justify-between px-6 py-3" style={{ backgroundColor: '#ffffff' }}>
            <div className="flex-1 max-w-md flex items-center gap-2">
                <input
                    type="text"
                    placeholder="Search transcripts..."
                    className="flex-1 px-3 py-2 text-[0.8125rem] outline-none"
                    style={{ backgroundColor: '#f6f3f2', border: 'none', borderRadius: '0px', color: '#1c1b1b' }}
                />
                <Link
                    href="/"
                    aria-label="Return to main screen"
                    className="w-9 h-9 flex items-center justify-center no-underline shrink-0 transition-colors"
                    style={{ backgroundColor: '#1c1b1b', color: '#ffffff', borderRadius: '0px' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#c20000'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#1c1b1b'; }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
                        <path d="M3 12L12 3l9 9" />
                        <path d="M5 10v10h14V10" />
                    </svg>
                </Link>
            </div>
            <div className="flex items-center gap-4">
                <LogoutButton />
                <Link
                    href="/profile"
                    className="w-8 h-8 flex items-center justify-center text-[0.75rem] font-bold no-underline"
                    style={{ backgroundColor: '#313030', color: '#f3f0ef', borderRadius: '0px' }}
                >
                    {userRole === 'admin' ? 'AD' : userRole === 'engineer' ? 'EN' : userRole === 'reviewer' ? 'RV' : 'GU'}
                </Link>
            </div>
        </header>
    );
}
