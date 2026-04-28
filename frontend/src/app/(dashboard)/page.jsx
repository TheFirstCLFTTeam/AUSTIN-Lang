'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
    getNotifications,
    getWatchedJobs,
    markAsRead,
    markAllAsRead,
    subscribe as subscribeNotifications,
} from '../../services/notifications';
import {
    getPendingRequests,
    subscribe as subscribeCredentials,
} from '../../services/credential-requests';
import { getCurrentUser } from '../../services/api';

function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function SectionHeader({ children }) {
    return (
        <p
            className="text-[0.625rem] font-semibold uppercase tracking-wider mb-2 px-1"
            style={{ color: '#7a7574' }}
        >
            {children}
        </p>
    );
}

function NotificationPanel() {
    const [notifications, setNotifications] = useState(() => getNotifications());
    const [watchedJobs, setWatchedJobs] = useState(() => getWatchedJobs());
    const [credentialRequests, setCredentialRequests] = useState([]);

    useEffect(() => {
        const unsubNotif = subscribeNotifications(() => {
            setNotifications(getNotifications());
            setWatchedJobs(getWatchedJobs());
        });
        const unsubCred = subscribeCredentials(() => {
            setCredentialRequests(getPendingRequests());
        });
        // Load user's own credential requests on mount
        setCredentialRequests(getPendingRequests());
        return () => { unsubNotif(); unsubCred(); };
    }, []);

    const hasJobNotifications = notifications.length > 0;
    const hasCredentials = credentialRequests.length > 0;
    const hasWatched = watchedJobs.length > 0;
    const hasAnything = hasJobNotifications || hasCredentials || hasWatched;

    if (!hasAnything) {
        return (
            <div className="w-full max-w-lg mt-10 p-5 text-center" style={{ backgroundColor: '#ffffff' }}>
                <p className="text-[0.8125rem]" style={{ color: '#7a7574' }}>
                    No notifications yet. Watch a processing job to get updates here.
                </p>
            </div>
        );
    }

    const unreadCount = notifications.filter((n) => !n.read).length;

    return (
        <div className="w-full max-w-lg mt-10">
            {/* Panel header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <h2
                        className="text-[0.875rem] font-bold uppercase tracking-wider"
                        style={{ color: '#1c1b1b' }}
                    >
                        Notifications
                    </h2>
                    {unreadCount > 0 && (
                        <span
                            className="inline-block px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase"
                            style={{ backgroundColor: 'rgba(178, 1, 0, 0.08)', color: '#b20100' }}
                        >
                            {unreadCount} NEW
                        </span>
                    )}
                </div>
                {unreadCount > 0 && (
                    <button
                        onClick={() => markAllAsRead()}
                        className="text-[0.6875rem] font-semibold uppercase tracking-wider cursor-pointer"
                        style={{ backgroundColor: 'transparent', border: 'none', color: '#b20100' }}
                    >
                        Mark All Read
                    </button>
                )}
            </div>

            <div className="space-y-4">
                {/* Job Updates */}
                {hasJobNotifications && (
                    <div className="p-4" style={{ backgroundColor: '#ffffff' }}>
                        <SectionHeader>Job Updates</SectionHeader>
                        <div className="space-y-1">
                            {notifications.map((n) => (
                                <div
                                    key={n.id}
                                    className="flex items-start gap-3 px-3 py-3"
                                    style={{
                                        backgroundColor: n.read ? 'transparent' : '#faf7f6',
                                        borderLeft: n.read ? '3px solid transparent' : '3px solid #b20100',
                                    }}
                                >
                                    <svg
                                        width="14" height="14" viewBox="0 0 24 24"
                                        fill="none"
                                        stroke={n.type === 'failed' ? '#c80000' : '#007846'}
                                        strokeWidth="2" strokeLinecap="square"
                                        className="shrink-0 mt-0.5"
                                    >
                                        {n.type === 'failed' ? (
                                            <>
                                                <circle cx="12" cy="12" r="10" />
                                                <line x1="15" y1="9" x2="9" y2="15" />
                                                <line x1="9" y1="9" x2="15" y2="15" />
                                            </>
                                        ) : (
                                            <>
                                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                                <polyline points="22 4 12 14.01 9 11.01" />
                                            </>
                                        )}
                                    </svg>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[0.8125rem]" style={{ color: '#1c1b1b' }}>
                                            {n.message}
                                        </p>
                                        <p className="text-[0.625rem] mt-0.5" style={{ color: '#7a7574' }}>
                                            {timeAgo(n.createdAt)}
                                        </p>
                                    </div>
                                    {!n.read && (
                                        <button
                                            onClick={() => markAsRead(n.id)}
                                            className="text-[0.625rem] font-semibold uppercase tracking-wider cursor-pointer shrink-0"
                                            style={{ backgroundColor: 'transparent', border: 'none', color: '#7a7574' }}
                                        >
                                            Read
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Credential Requests */}
                {hasCredentials && (
                    <div className="p-4" style={{ backgroundColor: '#ffffff' }}>
                        <SectionHeader>Credential Requests</SectionHeader>
                        <div className="space-y-1">
                            {credentialRequests.map((req) => (
                                <div
                                    key={req.id}
                                    className="flex items-start gap-3 px-3 py-3"
                                    style={{ backgroundColor: '#faf7f6', borderLeft: '3px solid #7a7574' }}
                                >
                                    <svg
                                        width="14" height="14" viewBox="0 0 24 24"
                                        fill="none" stroke="#7a7574"
                                        strokeWidth="2" strokeLinecap="square"
                                        className="shrink-0 mt-0.5"
                                    >
                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                        <circle cx="12" cy="7" r="4" />
                                    </svg>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[0.8125rem]" style={{ color: '#1c1b1b' }}>
                                            Your credential change is pending approval
                                        </p>
                                        <div className="flex flex-wrap gap-x-3 mt-1">
                                            {Object.entries(req.changes).map(([field, { from, to }]) => (
                                                <span key={field} className="text-[0.625rem]" style={{ color: '#7a7574' }}>
                                                    <span className="uppercase">{field}</span>: {from} → {to}
                                                </span>
                                            ))}
                                        </div>
                                        <p className="text-[0.625rem] mt-0.5" style={{ color: '#7a7574' }}>
                                            Submitted {timeAgo(req.submittedAt)}
                                        </p>
                                    </div>
                                    <span
                                        className="inline-block px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase shrink-0"
                                        style={{ backgroundColor: 'rgba(178, 1, 0, 0.08)', color: '#b20100' }}
                                    >
                                        Pending
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Watched Jobs */}
                {hasWatched && (
                    <div className="p-4" style={{ backgroundColor: '#ffffff' }}>
                        <SectionHeader>Watched Jobs</SectionHeader>
                        <div className="space-y-1">
                            {watchedJobs.map((w) => (
                                <Link
                                    key={w.jobId}
                                    href="/processing"
                                    className="flex items-center gap-3 px-3 py-3 no-underline transition-colors"
                                    style={{ backgroundColor: 'transparent' }}
                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#faf7f6'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                >
                                    <svg
                                        width="14" height="14" viewBox="0 0 24 24"
                                        fill="#b20100" stroke="#b20100"
                                        strokeWidth="1.75" strokeLinecap="square"
                                        className="shrink-0"
                                    >
                                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                                    </svg>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[0.8125rem] font-medium" style={{ color: '#1c1b1b' }}>
                                            {w.jobName}
                                        </p>
                                        <p className="text-[0.625rem]" style={{ color: '#7a7574' }}>
                                            Watching since {timeAgo(w.watchedAt)}
                                        </p>
                                    </div>
                                    <svg
                                        width="12" height="12" viewBox="0 0 24 24"
                                        fill="none" stroke="#7a7574" strokeWidth="2"
                                        className="shrink-0"
                                    >
                                        <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function HomePage() {
    return (
        <div className="flex flex-col items-center justify-center py-20">
            <img src="/logo.png" alt="AUSTIN-Lang Logo" className="w-40 h-40 object-contain mb-6" />

            <h1
                className="text-[2.5rem] font-bold mb-2 text-center"
                style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}
            >
                AUSTIN-Lang
            </h1>

            <p className="text-[0.875rem] mb-10 text-center max-w-md" style={{ color: "#7a7574" }}>
                Automated Speech Recognition for financial compliance.
                Upload, transcribe, review, and improve.
            </p>

            <div className="flex gap-4">
                <Link
                    href="/upload"
                    className="px-6 py-3 text-[0.8125rem] font-semibold no-underline"
                    style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", borderRadius: "0px" }}
                >
                    Upload Audio
                </Link>
                <Link
                    href="/files"
                    className="px-6 py-3 text-[0.8125rem] font-medium no-underline"
                    style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}
                >
                    My Transcripts
                </Link>
                <Link
                    href="/dashboard"
                    className="px-6 py-3 text-[0.8125rem] font-medium no-underline"
                    style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}
                >
                    Analytics Dashboard
                </Link>
            </div>

            <NotificationPanel />
        </div>
    );
}
