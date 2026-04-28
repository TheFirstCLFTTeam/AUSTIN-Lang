'use client';

// Live SSE consumer for /api/training-jobs/{id}/logs.
//
// Replaces the MOCK_COMPLETION_DELAY_MS = 8000 + getTrainingLogs() bandaid
// in /training/[id]/page.jsx. Renders a terminal-style log panel + a
// state badge + a progress bar; auto-scrolls; closes when the SSE end
// event arrives.

import { useCallback, useEffect, useRef, useState } from 'react';


const TERMINAL_STATES = new Set(['published', 'cancelled', 'failed']);

const STATUS_STYLE = {
    queued:     { bg: '#f6f3f2', fg: '#7a7574', label: 'Queued' },
    preparing:  { bg: '#fef3c7', fg: '#92400e', label: 'Preparing' },
    running:    { bg: '#dbeafe', fg: '#1e40af', label: 'Running' },
    paused:     { bg: '#e6e1df', fg: '#7a7574', label: 'Paused' },
    evaluating: { bg: '#ede9fe', fg: '#5b21b6', label: 'Evaluating' },
    published:  { bg: '#d1fae5', fg: '#1a7f37', label: 'Published' },
    cancelled:  { bg: '#e6e1df', fg: '#7a7574', label: 'Cancelled' },
    failed:     { bg: '#fee2e2', fg: '#b20100', label: 'Failed' },
};


function StatusBadge({ status }) {
    const meta = STATUS_STYLE[status] || STATUS_STYLE.queued;
    return (
        <span
            className="inline-block px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-widest"
            style={{ backgroundColor: meta.bg, color: meta.fg, borderRadius: '3px' }}
        >
            {meta.label}
        </span>
    );
}


function ProgressBar({ pct, status }) {
    const fillPct = Math.max(0, Math.min(100, pct ?? 0));
    const meta = STATUS_STYLE[status] || STATUS_STYLE.queued;
    return (
        <div className="flex items-center gap-2 w-full">
            <div className="flex-1" style={{ height: 6, backgroundColor: '#f6f3f2' }}>
                <div
                    style={{
                        width: `${fillPct}%`,
                        height: '100%',
                        backgroundColor: meta.fg,
                        transition: 'width 200ms ease-out',
                    }}
                />
            </div>
            <span className="text-[0.75rem] tabular-nums" style={{ color: '#7a7574', minWidth: 36, textAlign: 'right' }}>
                {fillPct.toFixed(0)}%
            </span>
        </div>
    );
}


export default function TrainingJobProgress({ jobId, onTerminalState }) {
    const [status, setStatus] = useState(null);
    const [progressPct, setProgressPct] = useState(null);
    const [failureReason, setFailureReason] = useState(null);
    const [logLines, setLogLines] = useState([]);
    const [connectionError, setConnectionError] = useState(null);
    const [closed, setClosed] = useState(false);
    const logRef = useRef(null);
    const esRef = useRef(null);

    const handleEnd = useCallback((finalStatus) => {
        setClosed(true);
        if (esRef.current) {
            try { esRef.current.close(); } catch { /* ignore */ }
            esRef.current = null;
        }
        if (onTerminalState) onTerminalState(finalStatus);
    }, [onTerminalState]);

    useEffect(() => {
        if (!jobId) return;

        const url = `/api/training-jobs/${encodeURIComponent(jobId)}/logs`;
        const es = new EventSource(url, { withCredentials: true });
        esRef.current = es;

        es.addEventListener('state', (ev) => {
            try {
                const payload = JSON.parse(ev.data);
                setStatus(payload.status);
                setProgressPct(payload.progress_pct);
                if (payload.failure_reason) setFailureReason(payload.failure_reason);
            } catch { /* ignore malformed */ }
        });

        es.addEventListener('log', (ev) => {
            try {
                const payload = JSON.parse(ev.data);
                setLogLines((prev) => {
                    // Cap at 5,000 lines so a runaway log doesn't OOM the browser.
                    const next = prev.length >= 5000 ? prev.slice(prev.length - 4999) : prev.slice();
                    next.push({ ts: payload.ts, line: payload.line });
                    return next;
                });
            } catch { /* ignore */ }
        });

        es.addEventListener('end', (ev) => {
            try {
                const payload = JSON.parse(ev.data);
                handleEnd(payload.status);
            } catch {
                handleEnd(null);
            }
        });

        es.addEventListener('error', () => {
            // EventSource fires `error` on any disconnect, including the
            // intentional close after `end`. Only surface as an error if
            // we haven't already received a terminal event.
            if (esRef.current && !closed) {
                setConnectionError('Connection lost — refresh to reconnect.');
            }
        });

        return () => {
            try { es.close(); } catch { /* ignore */ }
            esRef.current = null;
        };
    }, [jobId, handleEnd, closed]);

    // Auto-scroll log panel as new lines arrive.
    useEffect(() => {
        const el = logRef.current;
        if (!el) return;
        // Only auto-scroll if the user is already near the bottom — don't
        // hijack their scroll position when they've scrolled up to read.
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (atBottom) el.scrollTop = el.scrollHeight;
    }, [logLines.length]);

    return (
        <div>
            <div className="flex items-center gap-3 mb-3">
                <StatusBadge status={status} />
                {failureReason && (
                    <span className="text-[0.75rem]" style={{ color: '#b20100' }}>
                        {failureReason}
                    </span>
                )}
            </div>

            <ProgressBar pct={progressPct} status={status} />

            <div
                ref={logRef}
                className="mt-3 px-3 py-2 font-mono text-[0.75rem] overflow-y-auto"
                style={{
                    backgroundColor: '#1c1b1b',
                    color: '#e6e1df',
                    height: 320,
                    borderRadius: '3px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                }}
            >
                {logLines.length === 0 && (
                    <div style={{ color: '#7a7574' }}>
                        {status === null ? 'Connecting…' : 'Waiting for first log line…'}
                    </div>
                )}
                {logLines.map((entry, i) => (
                    <div key={i}>
                        <span style={{ color: '#7a7574' }}>{entry.ts}</span>
                        {' '}
                        {entry.line}
                    </div>
                ))}
            </div>

            {connectionError && (
                <div
                    className="mt-2 px-3 py-2 text-[0.75rem]"
                    style={{ backgroundColor: '#fff1f2', color: '#b20100', border: '1px solid #ffd5d8' }}
                >
                    {connectionError}
                </div>
            )}
        </div>
    );
}
