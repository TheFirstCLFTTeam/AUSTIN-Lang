'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { fetchFileDetail } from '@/services/api';
import {
    AUDIT_ACTIONS,
    AUDIT_CATEGORIES,
    getAuditTrail,
    formatAuditDetail,
} from '@/services/mock_data-audit';
import OwnerBadge from '../../../components/OwnerBadge';

function formatAbsolute(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatRelative(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const diffMs = Date.now() - d.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diffMs < 0) return 'just now';
    if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`;
    if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`;
    if (diffMs < 7 * day) return `${Math.round(diffMs / day)}d ago`;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatCard({ label, value, sublabel, accent }) {
    return (
        <div className="p-6" style={{ backgroundColor: '#ffffff' }}>
            <p
                className="text-[0.625rem] font-semibold uppercase tracking-widest mb-4"
                style={{ color: '#7a7574' }}
            >
                {label}
            </p>
            <p
                className="text-[1.75rem] font-bold leading-none tracking-tight"
                style={{
                    color: accent ? '#b20100' : '#1c1b1b',
                    letterSpacing: '-0.02em',
                }}
            >
                {value}
            </p>
            {sublabel && (
                <p className="text-[0.6875rem] mt-2" style={{ color: '#7a7574' }}>
                    {sublabel}
                </p>
            )}
        </div>
    );
}

function ActionPill({ action }) {
    const meta = AUDIT_ACTIONS[action];
    if (!meta) return null;
    return (
        <span
            className="inline-block px-2 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest shrink-0"
            style={{
                backgroundColor: meta.color,
                color: '#ffffff',
            }}
        >
            {meta.label}
        </span>
    );
}

function FilterChip({ label, active, onClick, count }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
            style={{
                backgroundColor: active ? '#1c1b1b' : 'transparent',
                color: active ? '#ffffff' : '#7a7574',
                border: `1px solid ${active ? '#1c1b1b' : 'rgba(233, 188, 181, 0.4)'}`,
                borderRadius: '0px',
            }}
        >
            {label}
            {count != null && (
                <span className="ml-2 opacity-70">{count}</span>
            )}
        </button>
    );
}

export default function FileAuditPage() {
    const params = useParams();
    const router = useRouter();
    const fileId = params?.id;

    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [categoryFilter, setCategoryFilter] = useState('all');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchFileDetail(fileId)
            .then((f) => { if (!cancelled) setFile(f); })
            .catch(() => { if (!cancelled) setFile(null); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [fileId]);

    const events = useMemo(
        () => getAuditTrail(fileId, file?.uploaded_at),
        [fileId, file?.uploaded_at],
    );

    const categoryCounts = useMemo(() => {
        const map = new Map();
        events.forEach((e) => {
            const cat = AUDIT_ACTIONS[e.action]?.category || 'Other';
            map.set(cat, (map.get(cat) || 0) + 1);
        });
        return map;
    }, [events]);

    const filtered = useMemo(() => {
        if (categoryFilter === 'all') return events;
        return events.filter(
            (e) => (AUDIT_ACTIONS[e.action]?.category || 'Other') === categoryFilter,
        );
    }, [events, categoryFilter]);

    const stats = useMemo(() => {
        if (events.length === 0) return null;
        const unique = new Set(events.map((e) => e.actorId));
        const sorted = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const first = sorted[0].timestamp;
        const last = sorted[sorted.length - 1].timestamp;
        return {
            eventCount: events.length,
            uniqueActors: unique.size,
            firstIso: first,
            lastIso: last,
        };
    }, [events]);

    const displayName = file?.name?.replace(/\.[^.]+$/, '') || fileId;

    return (
        <div>
            {/* Breadcrumb */}
            <div
                className="flex items-center gap-2 text-[0.6875rem] mb-2"
                style={{ color: '#7a7574' }}
            >
                <Link
                    href="/files"
                    className="uppercase tracking-widest no-underline"
                    style={{ color: '#b20100' }}
                >
                    Files
                </Link>
                <span>/</span>
                {file && (
                    <>
                        <Link
                            href={`/files/${fileId}`}
                            className="uppercase tracking-widest truncate no-underline"
                            style={{ color: '#1c1b1b', maxWidth: '30ch' }}
                            title={displayName}
                        >
                            {displayName}
                        </Link>
                        <span>/</span>
                    </>
                )}
                <span className="uppercase tracking-widest" style={{ color: '#1c1b1b' }}>
                    Audit Trail
                </span>
            </div>

            {/* Editorial header */}
            <div
                className="flex items-end justify-between gap-6 mb-8 pb-6"
                style={{ borderBottom: '2px solid #1c1b1b' }}
            >
                <div className="min-w-0">
                    <p
                        className="text-[0.625rem] font-semibold uppercase tracking-widest mb-3"
                        style={{ color: '#b20100' }}
                    >
                        Compliance &middot; Interaction Log
                    </p>
                    <h1
                        className="text-[2.5rem] font-bold leading-none tracking-tight uppercase break-words"
                        style={{ color: '#1c1b1b', letterSpacing: '-0.03em' }}
                    >
                        Audit Trail
                    </h1>
                    <p
                        className="text-[0.75rem] mt-3 truncate"
                        style={{ color: '#7a7574' }}
                        title={displayName}
                    >
                        {loading
                            ? 'Loading file...'
                            : file
                                ? displayName
                                : `No file metadata for ${fileId}`}
                    </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <button
                        onClick={() => router.back()}
                        className="px-6 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            border: '1.5px solid #1c1b1b',
                            borderRadius: '0px',
                            color: '#1c1b1b',
                        }}
                    >
                        &larr; Back
                    </button>
                    {file && (
                        <Link
                            href={`/files/${fileId}`}
                            className="px-6 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer no-underline"
                            style={{
                                background: 'linear-gradient(135deg, #b20100, #e10000)',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '0px',
                            }}
                        >
                            Open Transcript &rarr;
                        </Link>
                    )}
                </div>
            </div>

            {/* Summary stats */}
            {stats && (
                <div
                    className="grid grid-cols-4 mb-8"
                    style={{ backgroundColor: 'rgba(233, 188, 181, 0.15)', gap: '1px' }}
                >
                    <StatCard
                        label="Total Events"
                        value={stats.eventCount.toLocaleString()}
                        sublabel="On this recording"
                    />
                    <StatCard
                        label="Unique Actors"
                        value={stats.uniqueActors}
                        sublabel="Operators + system"
                    />
                    <StatCard
                        label="First Activity"
                        value={formatRelative(stats.firstIso)}
                        sublabel={formatAbsolute(stats.firstIso)}
                    />
                    <StatCard
                        label="Last Activity"
                        value={formatRelative(stats.lastIso)}
                        sublabel={formatAbsolute(stats.lastIso)}
                        accent
                    />
                </div>
            )}

            {/* Filter chips */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
                {AUDIT_CATEGORIES.map((cat) => {
                    const count = cat.key === 'all' ? events.length : categoryCounts.get(cat.key) || 0;
                    if (cat.key !== 'all' && count === 0) return null;
                    return (
                        <FilterChip
                            key={cat.key}
                            label={cat.label}
                            count={count}
                            active={categoryFilter === cat.key}
                            onClick={() => setCategoryFilter(cat.key)}
                        />
                    );
                })}
            </div>

            {/* Timeline */}
            {loading ? (
                <div className="p-10 text-center" style={{ backgroundColor: '#ffffff' }}>
                    <p className="text-[0.75rem] uppercase tracking-widest" style={{ color: '#7a7574' }}>
                        Loading audit trail...
                    </p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="p-10 text-center" style={{ backgroundColor: '#ffffff' }}>
                    <p className="text-[0.875rem] mb-1" style={{ color: '#1c1b1b' }}>
                        No events for this filter.
                    </p>
                    <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                        Try switching to <button
                            type="button"
                            onClick={() => setCategoryFilter('all')}
                            className="underline cursor-pointer"
                            style={{ background: 'transparent', border: 'none', color: '#b20100', padding: 0 }}
                        >All activity</button>.
                    </p>
                </div>
            ) : (
                <div style={{ backgroundColor: '#ffffff' }}>
                    <div
                        className="flex items-center px-6 py-4 text-[0.625rem] font-semibold uppercase tracking-widest"
                        style={{
                            color: '#7a7574',
                            borderBottom: '1px solid rgba(233, 188, 181, 0.25)',
                        }}
                    >
                        <div className="w-40">Actor</div>
                        <div className="w-44">Action</div>
                        <div className="flex-1">Detail</div>
                        <div className="w-40 text-right">Timestamp</div>
                    </div>
                    {filtered.map((e, idx) => (
                        <div
                            key={e.id}
                            className="flex items-center px-6 py-4"
                            style={{
                                borderBottom:
                                    idx === filtered.length - 1
                                        ? 'none'
                                        : '1px solid rgba(233, 188, 181, 0.08)',
                            }}
                        >
                            <div className="w-40 min-w-0 pr-3">
                                {e.actorId === 'system' ? (
                                    <div className="flex items-center gap-2">
                                        <span
                                            className="shrink-0 inline-flex items-center justify-center text-[0.5625rem] font-bold"
                                            style={{
                                                width: 20,
                                                height: 20,
                                                borderRadius: '50%',
                                                backgroundColor: '#1c1b1b',
                                                color: '#ffffff',
                                            }}
                                        >
                                            {'\u2699'}
                                        </span>
                                        <span
                                            className="text-[0.8125rem] truncate"
                                            style={{ color: '#1c1b1b' }}
                                            title={e.actorName}
                                        >
                                            {e.actorName}
                                        </span>
                                    </div>
                                ) : (
                                    <OwnerBadge owner={e.actorId} size="sm" />
                                )}
                            </div>
                            <div className="w-44 pr-3">
                                <ActionPill action={e.action} />
                            </div>
                            <div className="flex-1 min-w-0 pr-3">
                                <p
                                    className="text-[0.8125rem]"
                                    style={{ color: '#1c1b1b' }}
                                >
                                    {AUDIT_ACTIONS[e.action]?.verb || e.action}
                                </p>
                                {formatAuditDetail(e) && (
                                    <p
                                        className="text-[0.6875rem] mt-0.5 truncate"
                                        style={{ color: '#7a7574' }}
                                        title={formatAuditDetail(e)}
                                    >
                                        {formatAuditDetail(e)}
                                    </p>
                                )}
                            </div>
                            <div
                                className="w-40 text-right"
                                title={formatAbsolute(e.timestamp)}
                            >
                                <p
                                    className="text-[0.75rem] font-semibold"
                                    style={{ color: '#1c1b1b' }}
                                >
                                    {formatRelative(e.timestamp)}
                                </p>
                                <p
                                    className="text-[0.625rem] mt-0.5 font-mono"
                                    style={{ color: '#7a7574' }}
                                >
                                    {formatAbsolute(e.timestamp)}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Audit footer */}
            <div
                className="flex items-center justify-between mt-10 pt-4 text-[0.625rem] uppercase tracking-widest"
                style={{
                    color: '#7a7574',
                    borderTop: '1px solid rgba(233, 188, 181, 0.2)',
                }}
            >
                <span>Retention: 7 years &middot; FR-A01</span>
                <span>
                    Compliance Hash: AUD-{String(fileId || '').slice(-6).toUpperCase()}-
                    {stats ? stats.eventCount.toString(16).toUpperCase() : '0'} Verified
                </span>
                <span>Immutable \u00b7 Append-only ledger</span>
            </div>
        </div>
    );
}
