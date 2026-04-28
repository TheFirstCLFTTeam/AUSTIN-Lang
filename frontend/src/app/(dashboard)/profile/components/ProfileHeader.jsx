'use client';

import { useRouter } from 'next/navigation';

export default function ProfileHeader({ name }) {
    const router = useRouter();

    return (
        <div>
            <div
                className="flex items-center gap-2 text-[0.6875rem] mb-1"
                style={{ color: '#7a7574' }}
            >
                <button
                    onClick={() => router.back()}
                    className="w-6 h-6 flex items-center justify-center shrink-0 transition-colors"
                    style={{ backgroundColor: '#1c1b1b', color: '#ffffff', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#c20000'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#1c1b1b'; }}
                    aria-label="Go back"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter">
                        <path d="M19 12H5" />
                        <path d="M12 19l-7-7 7-7" />
                    </svg>
                </button>
                <span
                    className="uppercase tracking-wider"
                    style={{ color: '#b20100' }}
                >
                    Institutional Profile
                </span>
            </div>
            <h1
                className="text-[2.5rem] font-bold tracking-tight mb-8"
                style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}
            >
                {name.toUpperCase()}
            </h1>
        </div>
    );
}
