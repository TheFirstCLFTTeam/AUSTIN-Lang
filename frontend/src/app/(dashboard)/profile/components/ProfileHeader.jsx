'use client';

export default function ProfileHeader({ name }) {
    return (
        <div>
            <div
                className="flex items-center gap-2 text-[0.6875rem] mb-1"
                style={{ color: '#7a7574' }}
            >
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
