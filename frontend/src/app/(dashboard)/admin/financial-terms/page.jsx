'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getCurrentUser } from '@/services/api';
import {
    fetchStats,
    fetchTerms,
    moderateTermPatch,
    runBulkImport,
} from '@/services/financial-terms';

const TABS = [
    { id: 'pending', label: 'Pending' },
    { id: 'approved', label: 'Approved' },
    { id: 'top_wrong', label: 'Top wrong terms' },
];

function StatusBadge({ status }) {
    const map = {
        pending:   { bg: '#fef3c7', fg: '#92400e' },
        approved:  { bg: '#d1fae5', fg: '#1a7f37' },
        rejected:  { bg: '#fee2e2', fg: '#b20100' },
        retired:   { bg: '#e6e1df', fg: '#7a7574' },
    };
    const meta = map[status] || map.pending;
    return (
        <span
            className="inline-block px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-widest"
            style={{ backgroundColor: meta.bg, color: meta.fg, borderRadius: '3px' }}
        >
            {status}
        </span>
    );
}

function relativeTime(iso) {
    if (!iso) return '';
    const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
}

export default function FinancialTermsAdminPage() {
    const [user, setUser] = useState(null);
    const [activeTab, setActiveTab] = useState('pending');
    const [terms, setTerms] = useState([]);
    const [stats, setStats] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [busyId, setBusyId] = useState(null);
    const [search, setSearch] = useState('');
    const [importBusy, setImportBusy] = useState(false);
    const [importResult, setImportResult] = useState(null);

    useEffect(() => {
        Promise.resolve(getCurrentUser()).then(setUser).catch(() => setUser(null));
    }, []);

    const isAdmin = (user?.role || '').toLowerCase() === 'admin';

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            if (activeTab === 'top_wrong') {
                const result = await fetchStats({ kind: 'top_wrong', limit: 100 });
                setStats(result.rows || []);
            } else {
                const rows = await fetchTerms({
                    status: activeTab,
                    q: search || undefined,
                    limit: 200,
                });
                setTerms(rows);
            }
        } catch (err) {
            setError(err?.message || 'Failed to load');
        } finally {
            setLoading(false);
        }
    }, [activeTab, search]);

    useEffect(() => { reload(); }, [reload]);

    const moderate = useCallback(async (id, status) => {
        if (!isAdmin) return;
        setBusyId(id);
        try {
            await moderateTermPatch(id, { status });
            await reload();
        } catch (err) {
            setError(err?.message || `Could not set status to ${status}`);
        } finally {
            setBusyId(null);
        }
    }, [isAdmin, reload]);

    const triggerBulkImport = useCallback(async () => {
        if (!isAdmin) return;
        setImportBusy(true);
        setImportResult(null);
        try {
            const result = await runBulkImport();
            setImportResult(result);
            await reload();
        } catch (err) {
            setError(err?.message || 'Bulk import failed');
        } finally {
            setImportBusy(false);
        }
    }, [isAdmin, reload]);

    if (user && !isAdmin) {
        return (
            <div className="px-6 py-12 max-w-2xl">
                <h1 className="text-[1.25rem] font-bold mb-3" style={{ color: '#1c1b1b' }}>
                    Financial terms — admin
                </h1>
                <div
                    className="px-4 py-3 text-[0.875rem]"
                    style={{ backgroundColor: '#fff1f2', border: '1px solid #ffd5d8', color: '#b20100' }}
                >
                    This page is admin-only. Your role is <code>{user.role}</code>.
                </div>
            </div>
        );
    }

    return (
        <div className="px-6 py-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
                <div>
                    <h1 className="text-[1.25rem] font-bold mb-1" style={{ color: '#1c1b1b' }}>
                        Financial terms — admin
                    </h1>
                    <p className="text-[0.8125rem]" style={{ color: '#7a7574' }}>
                        Moderate user-submitted terms. The approved list drives the
                        <code className="mx-1 px-1" style={{ backgroundColor: '#f6f3f2' }}>financial_term_accuracy</code>
                        metric and the auto-trail occurrence ledger.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={triggerBulkImport}
                        disabled={importBusy || !isAdmin}
                        className="text-[0.7rem] uppercase tracking-wider px-3 py-2 cursor-pointer"
                        style={{
                            backgroundColor: importBusy ? '#e6e1df' : '#f6f3f2',
                            color: '#1c1b1b', border: 'none',
                            cursor: importBusy ? 'wait' : 'pointer',
                        }}
                        title="Re-runs the CSV importer with the cleaning heuristics. Idempotent — only inserts new rows."
                    >
                        {importBusy ? 'Importing…' : 'Re-run CSV import'}
                    </button>
                </div>
            </div>

            {importResult && (
                <div
                    className="mb-4 px-3 py-2 text-[0.8125rem]"
                    style={{ backgroundColor: '#d1fae5', color: '#1a7f37', border: '1px solid #99e2bd' }}
                >
                    Imported: clean={importResult.counts?.imported_clean ?? 0} ·
                    {' '}pending={importResult.counts?.imported_pending ?? 0} ·
                    {' '}duplicate={importResult.counts?.skipped_duplicate ?? 0} ·
                    {' '}empty={importResult.counts?.skipped_empty ?? 0}
                </div>
            )}

            {/* Tabs */}
            <div className="flex items-center gap-1 mb-4" style={{ borderBottom: '1px solid #e6e1df' }}>
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            color: activeTab === tab.id ? '#1c1b1b' : '#7a7574',
                            borderBottom: activeTab === tab.id ? '2px solid #1c1b1b' : '2px solid transparent',
                            border: 'none',
                            borderBottomWidth: '2px',
                            borderBottomStyle: 'solid',
                            borderBottomColor: activeTab === tab.id ? '#1c1b1b' : 'transparent',
                            marginBottom: '-1px',
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Search bar (terms tabs only) */}
            {activeTab !== 'top_wrong' && (
                <div className="mb-4">
                    <input
                        type="search"
                        placeholder="Search terms…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="px-3 py-2 text-[0.875rem] w-full max-w-md"
                        style={{
                            backgroundColor: '#f6f3f2', border: 'none',
                            borderBottom: '2px solid #c4c4c4', color: '#1c1b1b',
                        }}
                    />
                </div>
            )}

            {error && (
                <div
                    role="alert"
                    className="mb-4 px-3 py-2 text-[0.8125rem]"
                    style={{ backgroundColor: '#fff1f2', color: '#b20100', border: '1px solid #ffd5d8' }}
                >
                    {error}
                </div>
            )}

            {loading && (
                <div className="text-[0.8125rem] py-4" style={{ color: '#7a7574' }}>Loading…</div>
            )}

            {/* Body */}
            {!loading && activeTab === 'top_wrong' && (
                <TopWrongTable rows={stats} />
            )}
            {!loading && activeTab !== 'top_wrong' && (
                <TermsTable
                    rows={terms}
                    activeTab={activeTab}
                    busyId={busyId}
                    onApprove={(id) => moderate(id, 'approved')}
                    onReject={(id) => moderate(id, 'rejected')}
                    onRetire={(id) => moderate(id, 'retired')}
                />
            )}
        </div>
    );
}

function TermsTable({ rows, activeTab, busyId, onApprove, onReject, onRetire }) {
    if (rows.length === 0) {
        return (
            <div className="py-8 text-center text-[0.8125rem]" style={{ color: '#7a7574' }}>
                No {activeTab} terms.
            </div>
        );
    }
    return (
        <div className="overflow-x-auto" style={{ backgroundColor: '#ffffff' }}>
            <table className="w-full text-[0.8125rem]">
                <thead>
                    <tr style={{ borderBottom: '1px solid #e6e1df' }}>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: '#7a7574', fontSize: '0.625rem' }}>Term</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: '#7a7574', fontSize: '0.625rem' }}>Status</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: '#7a7574', fontSize: '0.625rem' }}>Category</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: '#7a7574', fontSize: '0.625rem' }}>Submitted</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: '#7a7574', fontSize: '0.625rem' }}>Notes</th>
                        <th className="text-right px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: '#7a7574', fontSize: '0.625rem' }}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((t) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid #f6f3f2' }}>
                            <td className="px-3 py-2 font-medium" style={{ color: '#1c1b1b' }}>{t.term}</td>
                            <td className="px-3 py-2"><StatusBadge status={t.status} /></td>
                            <td className="px-3 py-2" style={{ color: '#7a7574' }}>{t.category || '—'}</td>
                            <td className="px-3 py-2" style={{ color: '#7a7574' }}>
                                <span title={t.submitted_at}>{relativeTime(t.submitted_at)}</span>
                                {t.submitted_by && (<>
                                    <span className="mx-1">·</span>
                                    <span>{t.submitted_by}</span>
                                </>)}
                            </td>
                            <td className="px-3 py-2 max-w-md truncate" style={{ color: '#7a7574' }} title={t.notes || ''}>
                                {t.notes || '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                                <div className="flex justify-end gap-1">
                                    {t.status === 'pending' && (
                                        <>
                                            <ActionButton onClick={() => onApprove(t.id)} busy={busyId === t.id}
                                                bg="#1a7f37" label="Approve" />
                                            <ActionButton onClick={() => onReject(t.id)} busy={busyId === t.id}
                                                bg="#b20100" label="Reject" />
                                        </>
                                    )}
                                    {t.status === 'approved' && (
                                        <ActionButton onClick={() => onRetire(t.id)} busy={busyId === t.id}
                                            bg="#7a7574" label="Retire" />
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ActionButton({ onClick, busy, bg, label }) {
    return (
        <button
            onClick={onClick} disabled={busy}
            className="text-[0.6875rem] uppercase tracking-wider px-2 py-1 cursor-pointer"
            style={{ backgroundColor: busy ? '#e6e1df' : bg, color: '#ffffff', border: 'none',
                cursor: busy ? 'wait' : 'pointer' }}
        >
            {busy ? '…' : label}
        </button>
    );
}

function TopWrongTable({ rows }) {
    if (rows.length === 0) {
        return (
            <div className="py-8 text-center text-[0.8125rem]" style={{ color: '#7a7574' }}>
                No occurrences yet. Once reviewers correct words that are in the dictionary, they show up here ranked by miss-count.
            </div>
        );
    }
    const maxWrong = rows.reduce((m, r) => Math.max(m, r.wrong_count || 0), 1);
    return (
        <div className="overflow-x-auto" style={{ backgroundColor: '#ffffff' }}>
            <table className="w-full text-[0.8125rem]">
                <thead>
                    <tr style={{ borderBottom: '1px solid #e6e1df' }}>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: '#7a7574', fontSize: '0.625rem' }}>Term</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: '#7a7574', fontSize: '0.625rem' }}>Wrong</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: '#7a7574', fontSize: '0.625rem' }}>Right</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: '#7a7574', fontSize: '0.625rem' }}>Total</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: '#7a7574', fontSize: '0.625rem' }}>Error rate</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const wrongPct = r.occurrences ? (r.wrong_count / r.occurrences) * 100 : 0;
                        return (
                            <tr key={r.id} style={{ borderBottom: '1px solid #f6f3f2' }}>
                                <td className="px-3 py-2 font-medium" style={{ color: '#1c1b1b' }}>{r.term}</td>
                                <td className="px-3 py-2" style={{ color: '#b20100', fontWeight: 600 }}>{r.wrong_count}</td>
                                <td className="px-3 py-2" style={{ color: '#1a7f37' }}>{r.right_count}</td>
                                <td className="px-3 py-2" style={{ color: '#7a7574' }}>{r.occurrences}</td>
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <span style={{ color: '#1c1b1b', minWidth: 40 }}>{wrongPct.toFixed(0)}%</span>
                                        <div style={{ width: 120, height: 6, backgroundColor: '#f6f3f2' }}>
                                            <div style={{
                                                width: `${(r.wrong_count / maxWrong) * 100}%`,
                                                height: '100%', backgroundColor: '#b20100',
                                            }} />
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
