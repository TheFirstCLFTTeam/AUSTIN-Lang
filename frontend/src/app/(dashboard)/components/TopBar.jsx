'use client';

import Link from 'next/link';
import LogoutButton from './LogoutButton';

export default function TopBar({ userRole }) {
    return (
        <header className="flex items-center justify-between px-6 py-3" style={{ backgroundColor: '#ffffff' }}>
            <div className="flex-1 max-w-md">
                <input
                    type="text"
                    placeholder="Search transcripts..."
                    className="w-full px-3 py-2 text-[0.8125rem] outline-none"
                    style={{ backgroundColor: '#f6f3f2', border: 'none', borderRadius: '0px', color: '#1c1b1b' }}
                />
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
