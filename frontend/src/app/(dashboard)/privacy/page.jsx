'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
    fetchAllFilesMetadata,
    fetchFileDetail,
    approveTranscript,
} from '@/services/api';
import {
    fetchPseudonymisationSpans,
    triggerPseudonymisationRun,
} from '@/services/pseudonymisation';
import { applyEdits } from '@/lib/transcriptEdits';

function severityFromSpanCount(n) {
    if (!n) return { label: 'clean', bg: 'rgba(122,117,116,0.1)', color: '#7a7574' };
    if (n >= 4) return { label: 'critical', bg: 'rgba(178,1,0,0.08)', color: '#b20100' };
    if (n >= 2) return { label: 'medium', bg: 'rgba(0,78,198,0.08)', color: '#004ec6' };
    return { label: 'low', bg: 'rgba(122,117,116,0.1)', color: '#7a7574' };
}

function formatClock(seconds) {
    if (!Number.isFinite(seconds)) return '00:00';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// Slice a segment's text around each span, highlighting the original or the
// substituted placeholder depending on which view we're rendering. Returns an
// array of {type: 'plain'|'pii'|'placeholder', text} tokens for rendering.
function tokeniseForView(segText, segSpans, view) {
    if (!segText) return [{ type: 'plain', text: '' }];
    const sorted = [...segSpans].sort((a, b) => a.start_char - b.start_char);
    const out = [];
    let cursor = 0;
    for (const s of sorted) {
        if (s.start_char > cursor) {
            out.push({ type: 'plain', text: segText.slice(cursor, s.start_char) });
        }
        const original = s.original_text ?? segText.slice(s.start_char, s.end_char);
        out.push({
            type: view === 'masked' ? 'placeholder' : 'pii',
            text: view === 'masked' ? s.placeholder : original,
            entity: s.entity_type,
        });
        cursor = Math.max(cursor, s.end_char);
    }
    if (cursor < segText.length) {
        out.push({ type: 'plain', text: segText.slice(cursor) });
    }
    return out;
}

export default function PrivacyPage() {
    const router = useRouter();
    const [files, setFiles] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [spansData, setSpansData] = useState(null);
    const [loadingList, setLoadingList] = useState(true);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [running, setRunning] = useState(false);
    const [approving, setApproving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchAllFilesMetadata()
            .then((rows) => {
                const flaggable = rows.filter((f) =>
                    ['in review', 'completed'].includes(f.status),
                );
                setFiles(flaggable);
                if (!selectedId && flaggable.length) setSelectedId(flaggable[0].id);
            })
            .catch((err) => setError(err?.message || 'Failed to load files'))
            .finally(() => setLoadingList(false));
    }, []);

    const loadDetail = useCallback(async (id) => {
        if (!id) return;
        setLoadingDetail(true);
        setError(null);
        try {
            const [d, s] = await Promise.all([
                fetchFileDetail(id),
                fetchPseudonymisationSpans(id).catch(() => ({ run: null, spans: [] })),
            ]);
            setDetail(d);
            setSpansData(s);
        } catch (err) {
            setError(err?.message || 'Failed to load detail');
        } finally {
            setLoadingDetail(false);
        }
    }, []);

    useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);

    const segmentsWithSpans = useMemo(() => {
        if (!detail) return [];
        const rawSegments = detail.rawTranscript?.transcript_segments || [];
        const applied = applyEdits(rawSegments, detail.edits || []);
        const spansBySeg = new Map();
        for (const s of spansData?.spans || []) {
            const arr = spansBySeg.get(String(s.segment_id)) || [];
            arr.push(s);
            spansBySeg.set(String(s.segment_id), arr);
        }
        return applied.map((seg) => ({
            id: seg.id,
            start: seg.start,
            text: seg.text || '',
            spans: spansBySeg.get(String(seg.id)) || [],
        }));
    }, [detail, spansData]);

    const totalSpans = spansData?.spans?.length || 0;
    const selected = files.find((f) => f.id === selectedId);
    const hasRun = !!spansData?.run_id;

    const handleRun = async () => {
        if (!selectedId) return;
        setRunning(true);
        setError(null);
        try {
            await triggerPseudonymisationRun(selectedId);
            setTimeout(() => loadDetail(selectedId), 1500);
        } catch (err) {
            setError(err?.message || 'Failed to start run');
        } finally {
            setRunning(false);
        }
    };

    const handleApprove = async () => {
        if (!selectedId) return;
        setApproving(true);
        setError(null);
        try {
            await approveTranscript(selectedId);
            await loadDetail(selectedId);
        } catch (err) {
            setError(err?.message || 'Approval blocked');
        } finally {
            setApproving(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <p className="text-[0.6875rem] uppercase tracking-wider mb-1" style={{ color: '#7a7574' }}>Compliance Review Queue</p>
                    <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>
                        PRIVACY FLAGS
                    </h1>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => selected && router.push(`/files/${selected.id}/audit`)}
                        disabled={!selected}
                        className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(233, 188, 181, 0.3)', borderRadius: '0px', color: '#1c1b1b' }}
                    >
                        AUDIT TRAIL
                    </button>
                    <button
                        onClick={handleApprove}
                        disabled={!selected || approving}
                        className="px-4 py-1.5 text-[0.8125rem] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}
                    >
                        {approving ? 'APPROVING…' : 'APPROVE FOR GREEN ZONE'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-3 mb-4 text-[0.8125rem]" style={{ backgroundColor: 'rgba(178,1,0,0.05)', color: '#b20100' }}>
                    {error}
                </div>
            )}

            <div className="flex gap-6">
                <div className="w-72 shrink-0">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-[0.875rem] font-bold uppercase tracking-wider" style={{ color: '#1c1b1b' }}>Flagged Recordings</h2>
                        <span className="px-2 py-0.5 text-[0.625rem] font-semibold" style={{ backgroundColor: 'rgba(178, 1, 0, 0.08)', color: '#b20100' }}>
                            {files.length} IN QUEUE
                        </span>
                    </div>

                    {loadingList && (
                        <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>Loading…</p>
                    )}

                    <div className="space-y-2">
                        {files.map((rec) => {
                            const count = rec.id === selectedId ? totalSpans : null;
                            const sev = severityFromSpanCount(count);
                            return (
                                <div
                                    key={rec.id}
                                    onClick={() => setSelectedId(rec.id)}
                                    className="p-4 cursor-pointer transition-colors"
                                    style={{ backgroundColor: selectedId === rec.id ? '#f6f3f2' : '#ffffff' }}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[0.8125rem] font-bold" style={{ color: '#1c1b1b' }}>{rec.id}</span>
                                        <span className="text-[0.625rem] font-semibold uppercase" style={{ color: sev.color }}>
                                            {count == null ? rec.status : `${count} span${count === 1 ? '' : 's'}`}
                                        </span>
                                    </div>
                                    <p className="text-[0.625rem]" style={{ color: '#7a7574' }}>
                                        {rec.name}
                                    </p>
                                    <p className="text-[0.625rem]" style={{ color: '#7a7574' }}>
                                        UPLOADED: {rec.uploaded_at?.slice(0, 19)?.replace('T', ' ') || '—'}
                                    </p>
                                </div>
                            );
                        })}
                        {!loadingList && files.length === 0 && (
                            <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>Nothing flagged for review.</p>
                        )}
                    </div>
                </div>

                <div className="flex-1">
                    {!selected && !loadingDetail && (
                        <div className="flex items-center justify-center py-20">
                            <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>Select a recording to review.</p>
                        </div>
                    )}

                    {selected && (
                        <>
                            <div className="mb-4 flex items-center justify-between">
                                <div>
                                    <h2 className="text-[1.25rem] font-bold mb-1" style={{ color: '#1c1b1b' }}>REVIEW: {selected.name}</h2>
                                    <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                                        {hasRun
                                            ? `${totalSpans} PII span${totalSpans === 1 ? '' : 's'} detected · run ${spansData.status}`
                                            : 'No pseudonymisation run on file.'}
                                    </p>
                                </div>
                                {!hasRun && (
                                    <button
                                        onClick={handleRun}
                                        disabled={running}
                                        className="px-4 py-2 text-[0.75rem] font-semibold uppercase tracking-wide cursor-pointer disabled:opacity-50"
                                        style={{ background: '#1c1b1b', color: '#ffffff', border: 'none' }}
                                    >
                                        {running ? 'Starting…' : 'Run pseudonymisation'}
                                    </button>
                                )}
                            </div>

                            {loadingDetail && (
                                <p className="text-[0.8125rem]" style={{ color: '#7a7574' }}>Loading transcript…</p>
                            )}

                            {!loadingDetail && (
                                <div className="flex gap-4">
                                    <div className="flex-1 p-5" style={{ backgroundColor: '#ffffff' }}>
                                        <h3 className="text-[0.75rem] font-bold uppercase tracking-wider mb-4" style={{ color: '#1c1b1b' }}>Original Transcript</h3>
                                        <div className="space-y-3 font-mono text-[0.75rem]" style={{ color: '#1c1b1b' }}>
                                            {segmentsWithSpans.map((seg) => (
                                                <div key={seg.id}>
                                                    <span style={{ color: '#7a7574' }}>[{formatClock(seg.start)}]</span>{' '}
                                                    {tokeniseForView(seg.text, seg.spans, 'original').map((t, i) => (
                                                        t.type === 'pii' ? (
                                                            <span key={i} className="px-1" title={t.entity} style={{ backgroundColor: 'rgba(178,1,0,0.1)', color: '#b20100', fontWeight: 700 }}>{t.text}</span>
                                                        ) : (
                                                            <span key={i}>{t.text}</span>
                                                        )
                                                    ))}
                                                </div>
                                            ))}
                                            {segmentsWithSpans.length === 0 && (
                                                <p style={{ color: '#7a7574' }}>No transcript segments.</p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex-1 p-5" style={{ backgroundColor: '#ffffff' }}>
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="w-2 h-2" style={{ backgroundColor: '#b20100', borderRadius: '0px' }} />
                                            <h3 className="text-[0.75rem] font-bold uppercase tracking-wider" style={{ color: '#1c1b1b' }}>Pseudonymised Transcript</h3>
                                        </div>
                                        <div className="space-y-3 font-mono text-[0.75rem]" style={{ color: '#1c1b1b' }}>
                                            {segmentsWithSpans.map((seg) => (
                                                <div key={seg.id}>
                                                    <span style={{ color: '#7a7574' }}>[{formatClock(seg.start)}]</span>{' '}
                                                    {tokeniseForView(seg.text, seg.spans, 'masked').map((t, i) => (
                                                        t.type === 'placeholder' ? (
                                                            <span key={i} className="px-1 font-bold" title={t.entity} style={{ backgroundColor: 'rgba(0,78,198,0.08)', color: '#004ec6' }}>{t.text}</span>
                                                        ) : (
                                                            <span key={i}>{t.text}</span>
                                                        )
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
