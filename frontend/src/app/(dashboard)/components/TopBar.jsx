'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import LogoutButton from './LogoutButton';
import { fetchUserProfile, getCurrentUser } from '../../../services/api';
import {
    getNotificationsForUser,
    getUnreadCountForUser,
    markAsRead,
    markAllAsRead,
    subscribe,
} from '../../../services/notifications';

export default function TopBar({ userRole }) {
    const [profilePic, setProfilePic] = useState(null);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [panelOpen, setPanelOpen] = useState(false);
    const panelRef = useRef(null);
    const user = getCurrentUser();

    useEffect(() => {
        fetchUserProfile().then((profile) => {
            if (profile?.profilePic) setProfilePic(profile.profilePic);
        });
    }, []);

    // Subscribe to notification changes and refresh counts.
    useEffect(() => {
        if (!user?.id) return;
        function refresh() {
            setNotifications(getNotificationsForUser(user.id));
            setUnreadCount(getUnreadCountForUser(user.id));
        }
        refresh();
        const unsub = subscribe(refresh);
        return unsub;
    }, [user?.id]);

    // Close panel on outside click.
    useEffect(() => {
        if (!panelOpen) return;
        function handleClick(e) {
            if (panelRef.current && !panelRef.current.contains(e.target)) setPanelOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [panelOpen]);

    function formatTimestamp(iso) {
        const d = new Date(iso);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            + ' ' + d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    }

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
                {/* Notification bell */}
                <div className="relative" ref={panelRef}>
                    <button
                        onClick={() => setPanelOpen((v) => !v)}
                        className="relative w-8 h-8 flex items-center justify-center cursor-pointer"
                        style={{ backgroundColor: 'transparent', border: 'none', color: '#7a7574' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#1c1b1b'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#7a7574'; }}
                        title="Notifications"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                        </svg>
                        {unreadCount > 0 && (
                            <span
                                className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center text-[0.5625rem] font-bold"
                                style={{ backgroundColor: '#b20100', color: '#ffffff', borderRadius: '50%' }}
                            >
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </button>

                    {panelOpen && (
                        <div
                            className="absolute right-0 top-full mt-2 w-80 z-50"
                            style={{ backgroundColor: '#ffffff', border: '1px solid #f0edec', boxShadow: '0 4px 16px rgba(28, 27, 27, 0.10)' }}
                        >
                            <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid #f0edec' }}>
                                <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: '#1c1b1b' }}>
                                    Notifications
                                </span>
                                {unreadCount > 0 && (
                                    <button
                                        onClick={() => markAllAsRead()}
                                        className="text-[0.625rem] font-semibold cursor-pointer"
                                        style={{ backgroundColor: 'transparent', border: 'none', color: '#004ec6' }}
                                    >
                                        Mark all read
                                    </button>
                                )}
                            </div>
                            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                {notifications.length === 0 ? (
                                    <p className="px-3 py-6 text-center text-[0.75rem]" style={{ color: '#7a7574' }}>No notifications</p>
                                ) : (
                                    [...notifications].reverse().map((n) => (
                                        <Link
                                            key={n.id}
                                            href={n.fileId ? `/files/${n.fileId}` : '#'}
                                            onClick={() => { markAsRead(n.id); setPanelOpen(false); }}
                                            className="flex items-start gap-2.5 px-3 py-2.5 no-underline transition-colors"
                                            style={{
                                                borderBottom: '1px solid #f6f3f2',
                                                backgroundColor: n.read ? 'transparent' : 'rgba(0, 78, 198, 0.03)',
                                            }}
                                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f6f3f2'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = n.read ? 'transparent' : 'rgba(0, 78, 198, 0.03)'; }}
                                        >
                                            <div className="mt-0.5 shrink-0">
                                                {n.type === 'review_submitted' ? (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#004ec6" strokeWidth="2">
                                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                        <polyline points="14 2 14 8 20 8" />
                                                        <line x1="16" y1="13" x2="8" y2="13" />
                                                        <line x1="16" y1="17" x2="8" y2="17" />
                                                    </svg>
                                                ) : (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2">
                                                        <circle cx="12" cy="12" r="10" />
                                                        <line x1="12" y1="8" x2="12" y2="12" />
                                                        <line x1="12" y1="16" x2="12.01" y2="16" />
                                                    </svg>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[0.75rem] leading-snug" style={{ color: '#1c1b1b', fontWeight: n.read ? 400 : 600 }}>
                                                    {n.message}
                                                </p>
                                                <p className="text-[0.625rem] mt-0.5" style={{ color: '#7a7574' }}>
                                                    {formatTimestamp(n.createdAt)}
                                                </p>
                                            </div>
                                            {!n.read && (
                                                <span className="w-2 h-2 shrink-0 mt-1.5" style={{ backgroundColor: '#004ec6', borderRadius: '50%' }} />
                                            )}
                                        </Link>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <LogoutButton />
                <Link
                    href="/profile"
                    className="w-8 h-8 flex items-center justify-center text-[0.75rem] font-bold no-underline overflow-hidden"
                    style={{ backgroundColor: '#313030', color: '#f3f0ef', borderRadius: '0px' }}
                >
                    <img src={profilePic || '/default_pfp.png'} alt="Profile" className="w-full h-full object-cover" />
                </Link>
            </div>
        </header>
    );
}
