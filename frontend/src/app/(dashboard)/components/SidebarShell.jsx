'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';

const NAV_ITEMS = [
    { label: 'My Transcripts', path: '/files', icon: 'doc' },
    { label: 'Processing', path: '/processing', icon: 'processing' },
    { label: 'Shared', path: '/shared', icon: 'shared' },
    { label: 'Starred', path: '/starred', icon: 'star' },
    { label: 'Recent', path: '/recent', icon: 'clock' },
];

const NAV_TOOLS = [
    { label: 'Metrics Dashboard', path: '/dashboard', icon: 'chart' },
    { label: 'Training Jobs', path: '/training', icon: 'training' },
    { label: 'Privacy Flags', path: '/privacy', icon: 'shield' },
];

const NAV_ADMIN = [
    { label: 'User Management', path: '/admin', icon: 'admin' },
    { label: 'Group Management', path: '/admin/groups', icon: 'shared' },
];

function NavIcon({ type, className = '' }) {
    const base = `w-4 h-4 ${className}`;
    switch (type) {
        case 'doc':
            return (<svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>);
        case 'shared':
            return (<svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>);
        case 'star':
            return (<svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>);
        case 'processing':
            return (<svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4" /><path d="M12 18v4" /><path d="M4.93 4.93l2.83 2.83" /><path d="M16.24 16.24l2.83 2.83" /><path d="M2 12h4" /><path d="M18 12h4" /><path d="M4.93 19.07l2.83-2.83" /><path d="M16.24 7.76l2.83-2.83" /></svg>);
        case 'clock':
            return (<svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>);
        case 'chart':
            return (<svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>);
        case 'training':
            return (<svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>);
        case 'shield':
            return (<svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>);
        case 'trash':
            return (<svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>);
        case 'admin':
            return (<svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>);
        default:
            return null;
    }
}

export default function SidebarShell({ userRole }) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);

    const isActive = (path) => pathname === path || pathname.startsWith(path + '/');

    const sidebarW = collapsed ? 'w-16' : 'w-60';

    return (
        <aside
            className={`${sidebarW} flex flex-col justify-between shrink-0 transition-all duration-200`}
            style={{ backgroundColor: '#ffffff' }}
        >
            <div>
                {/* Logo */}
                <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
                    <img src="/logo.png" alt="CLFT" className="h-7 w-7 object-contain" />
                    {!collapsed && (
                        <div>
                            <span className="text-[0.875rem] font-bold tracking-tight" style={{ color: '#1c1b1b' }}>
                                AUSTIN-LANG
                            </span>
                            <p className="text-[0.625rem] uppercase tracking-widest" style={{ color: '#7a7574' }}>
                                Institutional Precision
                            </p>
                        </div>
                    )}
                </div>

                {/* New Transcription Button */}
                <div className="px-4 mb-4">
                    <Link
                        href="/upload"
                        className="flex items-center justify-center gap-2 w-full py-2 text-[0.8125rem] font-semibold cursor-pointer no-underline"
                        style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', borderRadius: '0px' }}
                    >
                        {collapsed ? '+' : '+ NEW TRANSCRIPTION'}
                    </Link>
                </div>

                {/* Primary Nav */}
                <nav className="px-2">
                    {NAV_ITEMS.map((item) => {
                        const active = isActive(item.path);
                        return (
                            <Link
                                key={item.path}
                                href={item.path}
                                className="flex items-center gap-3 px-3 py-2 mb-0.5 text-[0.8125rem] font-medium no-underline transition-colors"
                                style={{
                                    color: active ? '#b20100' : '#1c1b1b',
                                    backgroundColor: active ? 'rgba(178, 1, 0, 0.05)' : 'transparent',
                                    borderLeft: active ? '3px solid #b20100' : '3px solid transparent',
                                    borderRadius: '0px',
                                }}
                            >
                                <NavIcon type={item.icon} />
                                {!collapsed && item.label}
                            </Link>
                        );
                    })}

                    <Link
                        href="/trash"
                        className="flex items-center gap-3 px-3 py-2 mb-0.5 text-[0.8125rem] font-medium no-underline transition-colors"
                        style={{
                            color: isActive('/trash') ? '#b20100' : '#7a7574',
                            backgroundColor: isActive('/trash') ? 'rgba(178, 1, 0, 0.05)' : 'transparent',
                            borderLeft: isActive('/trash') ? '3px solid #b20100' : '3px solid transparent',
                            borderRadius: '0px',
                        }}
                    >
                        <NavIcon type="trash" />
                        {!collapsed && 'Trash'}
                    </Link>
                </nav>

                {(userRole === 'engineer' || userRole === 'admin') && (
                    <>
                        <div className="mx-5 my-3 h-px" style={{ backgroundColor: 'rgba(233, 188, 181, 0.15)' }} />
                        <nav className="px-2">
                            {NAV_TOOLS.map((item) => {
                                const active = isActive(item.path);
                                return (
                                    <Link
                                        key={item.path}
                                        href={item.path}
                                        className="flex items-center gap-3 px-3 py-2 mb-0.5 text-[0.8125rem] font-medium no-underline transition-colors"
                                        style={{
                                            color: active ? '#b20100' : '#1c1b1b',
                                            backgroundColor: active ? 'rgba(178, 1, 0, 0.05)' : 'transparent',
                                            borderLeft: active ? '3px solid #b20100' : '3px solid transparent',
                                            borderRadius: '0px',
                                        }}
                                    >
                                        <NavIcon type={item.icon} />
                                        {!collapsed && item.label}
                                    </Link>
                                );
                            })}
                        </nav>
                    </>
                )}

                {userRole === 'admin' && (
                    <>
                        <div className="mx-5 my-3 h-px" style={{ backgroundColor: 'rgba(233, 188, 181, 0.15)' }} />
                        <nav className="px-2">
                            {NAV_ADMIN.map((item) => {
                                const active = isActive(item.path);
                                return (
                                    <Link
                                        key={item.path}
                                        href={item.path}
                                        className="flex items-center gap-3 px-3 py-2 mb-0.5 text-[0.8125rem] font-medium no-underline transition-colors"
                                        style={{
                                            color: active ? '#b20100' : '#1c1b1b',
                                            backgroundColor: active ? 'rgba(178, 1, 0, 0.05)' : 'transparent',
                                            borderLeft: active ? '3px solid #b20100' : '3px solid transparent',
                                            borderRadius: '0px',
                                        }}
                                    >
                                        <NavIcon type={item.icon} />
                                        {!collapsed && item.label}
                                    </Link>
                                );
                            })}
                        </nav>
                    </>
                )}
            </div>

            {/* Bottom */}
            <div>
                {!collapsed && (
                    <div className="px-5 pb-5">
                        <div className="h-1 w-full" style={{ backgroundColor: '#f6f3f2' }}>
                            <div className="h-1 transition-all" style={{ width: '16%', backgroundColor: '#1c1b1b' }} />
                        </div>
                        <p className="text-[0.75rem] mt-1.5" style={{ color: '#7a7574' }}>2.4 GB of 15 GB used</p>
                    </div>
                )}
                <div className="flex justify-end px-3 pb-3">
                    <button
                        onClick={() => setCollapsed((c) => !c)}
                        className="w-8 h-8 flex items-center justify-center cursor-pointer rounded-full transition-all duration-200"
                        style={{ backgroundColor: 'transparent', border: '1px solid #e8e4e3', color: '#7a7574' }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f6f3f2'; e.currentTarget.style.color = '#1c1b1b'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#7a7574'; }}
                    >
                        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
                    </button>
                </div>
            </div>
        </aside>
    );
}
