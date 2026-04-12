'use client';

import { useState } from 'react';

export default function PermissionGroup({ group, defaultOpen }) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div style={{ backgroundColor: '#ffffff' }}>
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between px-5 py-4 cursor-pointer"
                style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderTop: '1px solid rgba(233, 188, 181, 0.15)',
                }}
            >
                <div className="flex items-center gap-3">
                    {group.isPrimary && (
                        <span
                            className="px-2 py-0.5 text-[0.625rem] font-bold uppercase"
                            style={{
                                backgroundColor: '#b20100',
                                color: '#ffffff',
                                borderRadius: '0px',
                            }}
                        >
                            Primary
                        </span>
                    )}
                    <div className="text-left">
                        <p
                            className="text-[0.625rem] uppercase tracking-wider"
                            style={{ color: '#7a7574' }}
                        >
                            Assigned Group
                        </p>
                        <p
                            className="text-[1.25rem] font-bold"
                            style={{ color: '#1c1b1b' }}
                        >
                            {group.name.toUpperCase()}
                        </p>
                    </div>
                </div>
                <svg
                    className="w-5 h-5 transition-transform"
                    style={{
                        transform:
                            open ? 'rotate(180deg)' : 'rotate(0deg)',
                        color: '#1c1b1b',
                    }}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>
            {open && (
                <div className="px-5 pb-5">
                    <p
                        className="text-[0.625rem] uppercase tracking-wider mb-2"
                        style={{ color: '#7a7574' }}
                    >
                        Primary Permissions
                    </p>
                    <div className="space-y-1.5">
                        {group.permissions.map((p) => (
                            <div
                                key={p}
                                className="flex items-center gap-2"
                            >
                                <span
                                    className="w-1.5 h-1.5 shrink-0"
                                    style={{
                                        backgroundColor: '#b20100',
                                        borderRadius: '0px',
                                    }}
                                />
                                <span
                                    className="text-[0.8125rem] font-medium"
                                    style={{ color: '#1c1b1b' }}
                                >
                                    {p.toUpperCase()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
