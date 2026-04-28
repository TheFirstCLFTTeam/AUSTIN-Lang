'use client';

import { useCallback, useEffect, useState } from 'react';

import {
    fetchVersions,
    diffVersions as fetchDiff,
    restoreVersion,
} from '../../../services/api';
import Dialog from './Dialog';

// Slice 2 of transcript-versioning-plan.md. Renders:
//   - A chip above the transcript editor showing the current version state.
//   - A right-side slide-out panel listing every version, with per-version
//     "Compare with current" and "Restore" affordances.
//   - A confirm modal when Restore would clobber an unsaved draft (409 path
//     from the server; see Q3 of slice 1).
//
// The component owns the version-list fetch lifecycle. It does NOT mutate
// the parent page's state — restoring triggers `onAfterRestore?.()` so the
// parent can refetch the file detail and re-render the transcript editor.

const LABEL_STYLE = {
    draft:              { bg: '#fef3c7', fg: '#92400e', label: 'Draft' },
    submitted:          { bg: '#dbeafe', fg: '#1e40af', label: 'Submitted' },
    approved:           { bg: '#d1fae5', fg: '#1a7f37', label: 'Approved' },
    changes_requested:  { bg: '#fee2e2', fg: '#b20100', label: 'Changes requested' },
    restored:           { bg: '#ede9fe', fg: '#5b21b6', label: 'Restored' },
};

function relativeTime(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    const now = Date.now();
    const sec = Math.max(0, Math.floor((now - then) / 1000));
    if (sec < 60)   return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60)   return `${min}m ago`;
    const hr  = Math.floor(min / 60);
    if (hr  < 24)   return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7)    return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
}

function VersionLabel({ label, isDraft }) {
    const meta = LABEL_STYLE[label] || { bg: '#f6f3f2', fg: '#7a7574', label };
    return (
        <span
            className="text-[0.65rem] font-semibold uppercase tracking-wider px-2 py-0.5"
            style={{ backgroundColor: meta.bg, color: meta.fg, borderRadius: '3px' }}
        >
            {meta.label}{isDraft && label === 'draft' ? ' (current)' : ''}
        </span>
    );
}

function VersionChip({ current, onClick }) {
    if (!current) return null;
    const meta = LABEL_STYLE[current.label] || { fg: '#7a7574', label: current.label };
    return (
        <button
            onClick={onClick}
            className="inline-flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors"
            style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e6e1df',
                borderRadius: '4px',
                color: '#1c1b1b',
                fontFamily: "'Inter', sans-serif",
                fontSize: '0.75rem',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f6f3f2'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#ffffff'; }}
            title="Open version history"
        >
            <span className="font-semibold">v{current.versionNo}</span>
            <span style={{ color: meta.fg, fontWeight: 600 }}>{meta.label}</span>
            <span style={{ color: '#7a7574' }}>· {relativeTime(current.createdAt)}</span>
        </button>
    );
}

function DiffSection({ diff }) {
    if (!diff) return null;
    return (
        <div
            className="mt-3 p-3"
            style={{ backgroundColor: '#fcf9f8', border: '1px solid #e6e1df', borderRadius: '4px' }}
        >
            <div className="text-[0.7rem] font-semibold uppercase tracking-wider mb-2" style={{ color: '#7a7574' }}>
                v{diff.from.versionNo} → v{diff.to.versionNo}
            </div>
            {diff.onlyInA.length === 0 && diff.onlyInB.length === 0 && (
                <div className="text-[0.8125rem]" style={{ color: '#7a7574' }}>No differences.</div>
            )}
            {diff.onlyInA.length > 0 && (
                <div className="mb-2">
                    <div className="text-[0.7rem] uppercase tracking-wider mb-1" style={{ color: '#b20100' }}>
                        Removed in v{diff.to.versionNo} ({diff.onlyInA.length})
                    </div>
                    <ul className="text-[0.8125rem] space-y-0.5" style={{ color: '#1c1b1b' }}>
                        {diff.onlyInA.slice(0, 12).map((e, i) => (
                            <li key={i}>
                                <code style={{ backgroundColor: '#fee2e2', padding: '0 4px' }}>
                                    {e.op}: {e.before}{e.after ? ` → ${e.after}` : ''}
                                </code>
                                <span style={{ color: '#7a7574' }}> (seg {e.segmentId})</span>
                            </li>
                        ))}
                        {diff.onlyInA.length > 12 && (
                            <li style={{ color: '#7a7574' }}>… and {diff.onlyInA.length - 12} more.</li>
                        )}
                    </ul>
                </div>
            )}
            {diff.onlyInB.length > 0 && (
                <div>
                    <div className="text-[0.7rem] uppercase tracking-wider mb-1" style={{ color: '#1a7f37' }}>
                        Added in v{diff.to.versionNo} ({diff.onlyInB.length})
                    </div>
                    <ul className="text-[0.8125rem] space-y-0.5" style={{ color: '#1c1b1b' }}>
                        {diff.onlyInB.slice(0, 12).map((e, i) => (
                            <li key={i}>
                                <code style={{ backgroundColor: '#d1fae5', padding: '0 4px' }}>
                                    {e.op}: {e.before}{e.after ? ` → ${e.after}` : ''}
                                </code>
                                <span style={{ color: '#7a7574' }}> (seg {e.segmentId})</span>
                            </li>
                        ))}
                        {diff.onlyInB.length > 12 && (
                            <li style={{ color: '#7a7574' }}>… and {diff.onlyInB.length - 12} more.</li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}

function VersionRow({ version, currentVersionNo, onCompare, onRestore, expandedDiff, onCloseCompare, busy }) {
    const isCurrent = version.versionNo === currentVersionNo;
    const isFrozen = !version.isCurrent;
    return (
        <div className="py-3" style={{ borderBottom: '1px solid #e6e1df' }}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[0.8125rem] font-bold" style={{ color: '#1c1b1b' }}>
                            v{version.versionNo}
                        </span>
                        <VersionLabel label={version.label} isDraft={version.isDraft} />
                    </div>
                    <div className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                        {version.createdByName || version.createdBy} · {relativeTime(version.createdAt)}
                        {version.parentVersionNo != null && version.label === 'restored' && (
                            <> · restored from v{version.parentVersionNo}</>
                        )}
                    </div>
                    {version.note && (
                        <div className="text-[0.75rem] mt-1 italic" style={{ color: '#9e6a00' }}>
                            “{version.note}”
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    {isFrozen && !isCurrent && (
                        <button
                            onClick={() => onCompare(version.versionNo)}
                            className="text-[0.7rem] uppercase tracking-wider px-2 py-1 cursor-pointer transition-colors"
                            style={{ backgroundColor: '#f6f3f2', color: '#1c1b1b', border: 'none' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1c1b1b'; e.currentTarget.style.color = '#ffffff'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f6f3f2'; e.currentTarget.style.color = '#1c1b1b'; }}
                        >
                            Compare
                        </button>
                    )}
                    {isFrozen && (
                        <button
                            onClick={() => onRestore(version.versionNo)}
                            disabled={busy}
                            className="text-[0.7rem] uppercase tracking-wider px-2 py-1 cursor-pointer transition-colors"
                            style={{
                                backgroundColor: busy ? '#e6e1df' : '#1c1b1b',
                                color: '#ffffff', border: 'none',
                                cursor: busy ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {busy ? '...' : 'Restore'}
                        </button>
                    )}
                </div>
            </div>
            {expandedDiff && (
                <div className="relative">
                    <DiffSection diff={expandedDiff} />
                    <button
                        onClick={onCloseCompare}
                        className="absolute top-3 right-1 text-[0.7rem] cursor-pointer"
                        style={{ background: 'transparent', border: 'none', color: '#7a7574' }}
                    >
                        ✕
                    </button>
                </div>
            )}
        </div>
    );
}

export default function TranscriptVersioning({ fileId, onAfterRestore }) {
    const [open, setOpen] = useState(false);
    const [versions, setVersions] = useState(null);   // null = not loaded
    const [error, setError] = useState(null);
    const [diffByVNo, setDiffByVNo] = useState({});   // { [vNo]: diff payload }
    const [restorePrompt, setRestorePrompt] = useState(null); // { versionNo, draftEditCount } when 409
    const [restoringVNo, setRestoringVNo] = useState(null);

    const reload = useCallback(async () => {
        try {
            const result = await fetchVersions(fileId);
            setVersions(result.versions || []);
            setError(null);
        } catch (err) {
            setError(err.message || 'Could not load versions');
        }
    }, [fileId]);

    useEffect(() => {
        if (open && versions === null) reload();
    }, [open, versions, reload]);

    const current = versions?.find((v) => v.isCurrent) || versions?.[0] || null;

    const handleCompare = useCallback(async (vNo) => {
        if (diffByVNo[vNo]) {
            setDiffByVNo((m) => ({ ...m, [vNo]: null }));
            return;
        }
        if (!current) return;
        try {
            const diff = await fetchDiff(fileId, vNo, current.versionNo);
            setDiffByVNo((m) => ({ ...m, [vNo]: diff }));
        } catch (err) {
            setError(err.message || 'Could not compute diff');
        }
    }, [diffByVNo, fileId, current]);

    const performRestore = useCallback(async (versionNo, existingDraft = null) => {
        setRestoringVNo(versionNo);
        try {
            await restoreVersion(fileId, versionNo, { existingDraft });
            setRestorePrompt(null);
            await reload();
            onAfterRestore?.();
        } catch (err) {
            if (err?.status === 409 && err?.body?.code === 'DIRTY_DRAFT') {
                setRestorePrompt({
                    versionNo,
                    draftVersionNo: err.body.draftVersionNo,
                    draftEditCount: err.body.draftEditCount,
                });
            } else {
                setError(err.message || 'Could not restore version');
            }
        } finally {
            setRestoringVNo(null);
        }
    }, [fileId, reload, onAfterRestore]);

    return (
        <>
            <VersionChip current={current} onClick={() => setOpen(true)} />

            {/* Right-side slide-out panel */}
            {open && (
                <div
                    className="fixed inset-0 z-40 flex justify-end"
                    style={{ backgroundColor: 'rgba(28, 27, 27, 0.4)' }}
                    onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
                >
                    <div
                        className="h-full overflow-y-auto"
                        style={{ width: 480, maxWidth: '90vw', backgroundColor: '#ffffff' }}
                    >
                        <div
                            className="flex items-center justify-between px-5 py-4"
                            style={{ borderBottom: '1px solid #e6e1df' }}
                        >
                            <h2
                                className="text-[0.875rem] font-bold uppercase tracking-wider"
                                style={{ color: '#1c1b1b' }}
                            >
                                Version history
                            </h2>
                            <button
                                onClick={() => setOpen(false)}
                                className="w-7 h-7 flex items-center justify-center cursor-pointer"
                                style={{ backgroundColor: '#f6f3f2', border: 'none', color: '#1c1b1b' }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#b20100'; e.currentTarget.style.color = '#ffffff'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f6f3f2'; e.currentTarget.style.color = '#1c1b1b'; }}
                                aria-label="Close"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
                                    <path d="M18 6L6 18" />
                                    <path d="M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="px-5 py-2">
                            {error && (
                                <div
                                    role="alert"
                                    className="my-2 px-3 py-2 text-[0.8125rem]"
                                    style={{ backgroundColor: '#fff1f2', border: '1px solid #ffd5d8', color: '#b20100' }}
                                >
                                    {error}
                                </div>
                            )}
                            {versions === null && !error && (
                                <div className="py-8 text-center text-[0.8125rem]" style={{ color: '#7a7574' }}>
                                    Loading…
                                </div>
                            )}
                            {versions?.length === 0 && (
                                <div className="py-8 text-center text-[0.8125rem]" style={{ color: '#7a7574' }}>
                                    No submissions yet. Versions are created when you submit, approve, or request changes.
                                </div>
                            )}
                            {versions?.map((v) => (
                                <VersionRow
                                    key={v.versionNo}
                                    version={v}
                                    currentVersionNo={current?.versionNo}
                                    onCompare={handleCompare}
                                    onCloseCompare={() => setDiffByVNo((m) => ({ ...m, [v.versionNo]: null }))}
                                    onRestore={performRestore}
                                    expandedDiff={diffByVNo[v.versionNo]}
                                    busy={restoringVNo === v.versionNo}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Dirty-draft confirm dialog (Q3 of slice 1) */}
            <Dialog
                open={!!restorePrompt}
                onClose={() => setRestorePrompt(null)}
                title="Unsaved draft"
            >
                {restorePrompt && (
                    <>
                        <p className="text-[0.875rem] mb-4" style={{ color: '#1c1b1b' }}>
                            You have <b>{restorePrompt.draftEditCount} unsaved edit{restorePrompt.draftEditCount === 1 ? '' : 's'}</b>{' '}
                            in v{restorePrompt.draftVersionNo}. Restoring v{restorePrompt.versionNo} will replace your current draft.
                        </p>
                        <p className="text-[0.8125rem] mb-5" style={{ color: '#7a7574' }}>
                            Choose how to handle the existing draft. There are no hanging drafts allowed —
                            your current edits must either be preserved as a snapshot or discarded.
                        </p>
                        <div className="flex flex-col gap-2">
                            <button
                                onClick={() => performRestore(restorePrompt.versionNo, 'save')}
                                className="text-[0.8125rem] uppercase tracking-wider px-3 py-2 cursor-pointer transition-colors"
                                style={{ backgroundColor: '#1c1b1b', color: '#ffffff', border: 'none', textAlign: 'left' }}
                            >
                                Save current as a snapshot, then restore
                            </button>
                            <button
                                onClick={() => performRestore(restorePrompt.versionNo, 'discard')}
                                className="text-[0.8125rem] uppercase tracking-wider px-3 py-2 cursor-pointer transition-colors"
                                style={{ backgroundColor: '#fff1f2', color: '#b20100', border: '1px solid #ffd5d8', textAlign: 'left' }}
                            >
                                Discard current and restore
                            </button>
                            <button
                                onClick={() => setRestorePrompt(null)}
                                className="text-[0.8125rem] uppercase tracking-wider px-3 py-2 cursor-pointer"
                                style={{ backgroundColor: 'transparent', color: '#7a7574', border: 'none', textAlign: 'left' }}
                            >
                                Cancel
                            </button>
                        </div>
                    </>
                )}
            </Dialog>
        </>
    );
}
