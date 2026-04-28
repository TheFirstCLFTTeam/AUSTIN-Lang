'use client';

import { useCallback, useEffect, useState } from 'react';

import {
    decideSpan,
    fetchPseudonymisationSpans,
    triggerPseudonymisationRun,
} from '../../../services/pseudonymisation';

// Reviewer-facing panel. Shows PII spans detected by the orchestrator for
// this transcript, lets reviewers accept/reject each one, and offers a "Run"
// action when no pseudonymisation run exists yet. Admins share the reviewer
// view (see decision route for the normalisation).
export default function PseudonymisationPanel({ fileId, role }) {
    const isReviewer = role === 'reviewer' || role === 'admin';
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [busySpanId, setBusySpanId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchPseudonymisationSpans(fileId);
            setData(res);
        } catch (err) {
            setError(err?.message || 'Failed to load pseudonymisation run');
        } finally {
            setLoading(false);
        }
    }, [fileId]);

    useEffect(() => { load(); }, [load]);

    const handleRun = async () => {
        setRunning(true);
        setError(null);
        try {
            await triggerPseudonymisationRun(fileId);
            // The run is async on the orchestrator. Give it a moment, then poll.
            setTimeout(load, 1500);
        } catch (err) {
            setError(err?.message || 'Failed to start pseudonymisation run');
        } finally {
            setRunning(false);
        }
    };

    const handleDecide = async (spanId, decision) => {
        setBusySpanId(spanId);
        setError(null);
        try {
            await decideSpan(fileId, spanId, decision);
            await load();
        } catch (err) {
            setError(err?.message || 'Failed to record decision');
        } finally {
            setBusySpanId(null);
        }
    };

    const spans = data?.spans || [];
    const run = data?.run_id ? data : null;
    const noRun = !loading && !run && spans.length === 0;
    const allDecided = spans.length > 0 && spans.every((s) => s.decision);

    return (
        <div className="p-5" style={{ backgroundColor: '#ffffff', border: '1px solid rgba(28,27,27,0.08)' }}>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-[0.875rem] font-bold uppercase tracking-wide" style={{ color: '#1c1b1b' }}>
                    Pseudonymisation
                </h3>
                {run && (
                    <span className="text-[0.6875rem]" style={{ color: '#7a7574' }}>
                        {spans.length} span{spans.length === 1 ? '' : 's'} · {data.status}
                    </span>
                )}
            </div>

            {loading && (
                <div className="text-[0.8125rem]" style={{ color: '#7a7574' }}>Loading…</div>
            )}

            {error && (
                <div className="p-2 text-[0.75rem] mb-3" style={{ backgroundColor: 'rgba(178,1,0,0.05)', color: '#b20100' }}>
                    {error}
                </div>
            )}

            {noRun && !loading && (
                <div className="flex items-center justify-between gap-3">
                    <p className="text-[0.8125rem]" style={{ color: '#7a7574' }}>
                        No pseudonymisation run has been recorded for this transcript.
                    </p>
                    {isReviewer && (
                        <button
                            onClick={handleRun}
                            disabled={running}
                            className="px-4 py-2 text-[0.75rem] font-semibold uppercase tracking-wide cursor-pointer disabled:opacity-50"
                            style={{ background: '#1c1b1b', color: '#ffffff', border: 'none' }}
                        >
                            {running ? 'Starting…' : 'Run now'}
                        </button>
                    )}
                </div>
            )}

            {run && spans.length > 0 && (
                <>
                    <ul className="flex flex-col gap-2">
                        {spans.map((s) => (
                            <li
                                key={s.span_id}
                                className="p-3"
                                style={{ backgroundColor: '#f6f3f2', border: '1px solid rgba(28,27,27,0.05)' }}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[0.75rem] font-semibold uppercase tracking-wide" style={{ color: '#1c1b1b' }}>
                                        {s.entity_type}
                                    </span>
                                    <span className="text-[0.6875rem]" style={{ color: '#7a7574' }}>
                                        conf {Math.round((s.confidence || 0) * 100)}% · {s.source}
                                    </span>
                                </div>
                                <div className="text-[0.8125rem] mb-2" style={{ color: '#1c1b1b' }}>
                                    <span className="mr-2" style={{ color: '#b20100' }}>
                                        {s.original_text ?? '••• redacted •••'}
                                    </span>
                                    <span style={{ color: '#7a7574' }}>→</span>
                                    <span className="ml-2 font-mono" style={{ color: '#004ec6' }}>
                                        {s.placeholder}
                                    </span>
                                </div>
                                {isReviewer && !s.decision && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleDecide(s.span_id, 'accepted')}
                                            disabled={busySpanId === s.span_id}
                                            className="px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide cursor-pointer disabled:opacity-50"
                                            style={{ background: '#1c1b1b', color: '#ffffff', border: 'none' }}
                                        >
                                            Accept
                                        </button>
                                        <button
                                            onClick={() => handleDecide(s.span_id, 'rejected')}
                                            disabled={busySpanId === s.span_id}
                                            className="px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide cursor-pointer disabled:opacity-50"
                                            style={{ background: '#ffffff', color: '#b20100', border: '1px solid #b20100' }}
                                        >
                                            Reject
                                        </button>
                                    </div>
                                )}
                                {s.decision && (
                                    <span
                                        className="text-[0.6875rem] font-semibold uppercase tracking-wide"
                                        style={{ color: s.decision === 'accepted' ? '#004ec6' : '#7a7574' }}
                                    >
                                        {s.decision}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                    {allDecided && (
                        <div className="mt-3 p-2 text-[0.6875rem]" style={{ backgroundColor: 'rgba(0,78,198,0.05)', color: '#004ec6' }}>
                            All spans decided — transcript can be approved.
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
