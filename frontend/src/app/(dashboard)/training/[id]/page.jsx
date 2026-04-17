'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
    getTrainingJobById,
    getTrainingLogs,
    detectMetricsFromLogs,
} from '@/services/training-jobs';
import OwnerBadge from '../../components/OwnerBadge';

function formatAbsolute(iso) {
    if (!iso) return '\u2014';
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
    if (!iso) return '\u2014';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const diffMs = Date.now() - d.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diffMs < 0) return 'scheduled';
    if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`;
    if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`;
    return `${Math.round(diffMs / day)}d ago`;
}

function formatDuration(totalMin) {
    if (totalMin == null || !Number.isFinite(totalMin)) return '\u2014';
    if (totalMin < 60) return `${Math.round(totalMin)}m`;
    const h = Math.floor(totalMin / 60);
    const m = Math.round(totalMin % 60);
    return `${h}h ${m}m`;
}

function StatusBadge({ status }) {
    const map = {
        running: { bg: 'rgba(178, 1, 0, 0.08)', color: '#b20100', label: 'RUNNING' },
        paused: { bg: 'rgba(122, 117, 116, 0.1)', color: '#7a7574', label: 'PAUSED' },
        queued: { bg: 'rgba(0, 78, 198, 0.08)', color: '#004ec6', label: 'QUEUED' },
        completed: { bg: 'rgba(26, 127, 55, 0.08)', color: '#1a7f37', label: 'COMPLETED' },
    };
    const s = map[status] || map.queued;
    return (
        <span
            className="inline-block px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-widest"
            style={{ backgroundColor: s.bg, color: s.color }}
        >
            {s.label}
        </span>
    );
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

function DetailRow({ label, value, mono }) {
    return (
        <div className="flex items-baseline justify-between gap-4 py-2" style={{ borderBottom: '1px solid rgba(233, 188, 181, 0.12)' }}>
            <span className="text-[0.6875rem] font-semibold uppercase tracking-widest shrink-0" style={{ color: '#7a7574' }}>
                {label}
            </span>
            <span
                className={`text-[0.8125rem] text-right ${mono ? 'font-mono' : ''}`}
                style={{ color: '#1c1b1b' }}
            >
                {value}
            </span>
        </div>
    );
}

// Lightweight SVG sparkline for the loss curve — no chart library, uses the
// handful of points on lossHistory.
//
// BACKEND HANDOVER: `history` today is seeded mock data on the job object.
// When wired to a real pipeline, this list must be built *only* from
// training-log events. The convention is: every time the log stream emits a
// line containing both `step=N` (or `step N`) and a `loss=X` token, append
// `{ step: N, loss: X }` to the series and re-render. No other telemetry
// source feeds this graph — if the training container didn't log it, it
// doesn't appear on the chart. The log-pattern detector in
// `detectMetricsFromLogs` classifies `loss` as a "performance" metric
// automatically, so the pipeline can use that classification to decide
// which key drives the y-axis of this sparkline per experiment without
// hard-coding it.
function LossSparkline({ history }) {
    if (!history || history.length < 2) {
        return (
            <div
                className="flex items-center justify-center text-[0.6875rem]"
                style={{ height: 120, backgroundColor: '#faf9f8', color: '#7a7574' }}
            >
                No loss history yet.
            </div>
        );
    }
    const w = 520;
    const h = 120;
    const pad = 16;
    const xs = history.map((p) => p.step);
    const ys = history.map((p) => p.loss);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const pts = history.map((p) => {
        const x = pad + ((p.step - xMin) / xSpan) * (w - pad * 2);
        const y = h - pad - ((p.loss - yMin) / ySpan) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const areaPath = `M ${pts[0]} L ${pts.join(' L ')} L ${pad + (w - pad * 2)},${h - pad} L ${pad},${h - pad} Z`;
    const linePath = `M ${pts.join(' L ')}`;
    return (
        <div style={{ backgroundColor: '#faf9f8', padding: '0.5rem' }}>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
                <path d={areaPath} fill="rgba(178, 1, 0, 0.08)" />
                <path d={linePath} fill="none" stroke="#b20100" strokeWidth="1.5" />
                {pts.map((p, i) => {
                    const [x, y] = p.split(',');
                    return <circle key={i} cx={x} cy={y} r="2.5" fill="#b20100" />;
                })}
            </svg>
            <div className="flex justify-between text-[0.5625rem] font-mono mt-1 px-1" style={{ color: '#7a7574' }}>
                <span>step {xMin.toLocaleString()}</span>
                <span>loss {yMin.toFixed(2)} → {ys[ys.length - 1].toFixed(2)}</span>
                <span>step {xMax.toLocaleString()}</span>
            </div>
        </div>
    );
}

function LogPanel({ logs }) {
    if (!logs || logs.length === 0) {
        return (
            <div
                className="p-6 text-[0.75rem]"
                style={{ backgroundColor: '#1c1b1b', color: '#7a7574' }}
            >
                No log lines yet.
            </div>
        );
    }
    return (
        <div
            className="p-4 overflow-x-auto"
            style={{
                backgroundColor: '#1c1b1b',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                maxHeight: 340,
                overflowY: 'auto',
            }}
        >
            {logs.map((line, i) => (
                <div key={i} className="flex items-baseline gap-3 text-[0.75rem] py-0.5 whitespace-nowrap">
                    <span style={{ color: '#7a7574' }}>
                        {new Date(line.ts).toISOString().split('T')[1].slice(0, 8)}
                    </span>
                    <span
                        className="font-semibold uppercase"
                        style={{
                            color:
                                line.level === 'warn'
                                    ? '#e9bcb5'
                                    : line.level === 'error'
                                        ? '#b20100'
                                        : '#4ade80',
                            minWidth: '3rem',
                        }}
                    >
                        {line.level}
                    </span>
                    <span style={{ color: '#f6f3f2' }}>{line.msg}</span>
                </div>
            ))}
        </div>
    );
}

export default function TrainingJobDetailPage() {
    const params = useParams();
    const router = useRouter();
    const jobId = params?.id;

    // Subscribe-on-mount pattern: the training-jobs module is in-memory only,
    // so a useEffect + local state gets us the snapshot. If we wire a real
    // source later, this is the seam.
    const [job, setJob] = useState(() => getTrainingJobById(jobId));

    useEffect(() => {
        setJob(getTrainingJobById(jobId));
    }, [jobId]);

    const logs = useMemo(() => getTrainingLogs(job), [job]);
    const detectedMetrics = useMemo(() => detectMetricsFromLogs(logs), [logs]);

    // ── Backend handover note ────────────────────────────────────────────
    // Everything on this screen that claims to be derived from training
    // progress must come from the log stream ONLY. Two consumers today:
    //
    //   1. `detectMetricsFromLogs(logs)` — infers which tokens in the log
    //      are performance metrics (vs. static labels) by watching repeated
    //      `key=value` patterns.
    //   2. The loss sparkline below (`<LossSparkline history={...} />`).
    //      Currently reads `job.lossHistory` from the mock; that's a stand-
    //      in. When the real backend lands, the graph must be appended to
    //      as each log line arrives — specifically, when the detector
    //      recognises a line containing `step=N` plus a varying metric like
    //      `loss=X`, emit a new datapoint `{ step: N, loss: X }` and push
    //      it into the plotted series. The graph should NOT be driven by
    //      any other telemetry source — if the training container didn't
    //      log it, it doesn't appear on the graph.

    if (!job) {
        return (
            <div>
                <div className="flex items-center gap-2 text-[0.6875rem] mb-2" style={{ color: '#7a7574' }}>
                    <Link
                        href="/training"
                        className="uppercase tracking-widest no-underline"
                        style={{ color: '#b20100' }}
                    >
                        Training
                    </Link>
                    <span>/</span>
                    <span className="uppercase tracking-widest">Not Found</span>
                </div>
                <div
                    className="flex items-end justify-between mb-10 pb-6"
                    style={{ borderBottom: '2px solid #1c1b1b' }}
                >
                    <div>
                        <h1
                            className="text-[2.5rem] font-bold leading-none tracking-tight uppercase"
                            style={{ color: '#1c1b1b', letterSpacing: '-0.03em' }}
                        >
                            Job Not Found
                        </h1>
                        <p
                            className="text-[0.6875rem] font-semibold uppercase tracking-widest mt-4"
                            style={{ color: '#7a7574' }}
                        >
                            No training job with id {jobId || '\u2014'}
                        </p>
                    </div>
                    <button
                        onClick={() => router.push('/training')}
                        className="px-6 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            border: '1.5px solid #1c1b1b',
                            borderRadius: '0px',
                            color: '#1c1b1b',
                        }}
                    >
                        &larr; Back to Jobs
                    </button>
                </div>
            </div>
        );
    }

    const progressLabel = `${job.progress}%`;
    const stepLabel = job.totalSteps
        ? `${(job.currentStep || 0).toLocaleString()} / ${job.totalSteps.toLocaleString()} steps`
        : '\u2014';

    return (
        <div>
            {/* Breadcrumb */}
            <div
                className="flex items-center gap-2 text-[0.6875rem] mb-2"
                style={{ color: '#7a7574' }}
            >
                <Link
                    href="/training"
                    className="uppercase tracking-widest no-underline"
                    style={{ color: '#b20100' }}
                >
                    Training Jobs
                </Link>
                <span>/</span>
                <span className="uppercase tracking-widest truncate" style={{ color: '#1c1b1b', maxWidth: '40ch' }} title={job.id}>
                    {job.id}
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
                        Training Pipeline &middot; Experiment
                    </p>
                    <h1
                        className="text-[2.5rem] font-bold leading-none tracking-tight uppercase break-words"
                        style={{ color: '#1c1b1b', letterSpacing: '-0.03em' }}
                    >
                        {job.id}
                    </h1>
                    <p
                        className="text-[0.875rem] mt-3"
                        style={{ color: '#1c1b1b' }}
                    >
                        {job.description}
                    </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge status={job.status} />
                    {job.status === 'running' && (
                        <button
                            className="px-4 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                            style={{
                                backgroundColor: 'transparent',
                                border: '1.5px solid #1c1b1b',
                                borderRadius: '0px',
                                color: '#1c1b1b',
                            }}
                        >
                            Pause
                        </button>
                    )}
                    {job.status === 'paused' && (
                        <button
                            className="px-4 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                            style={{
                                background: 'linear-gradient(135deg, #b20100, #e10000)',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '0px',
                            }}
                        >
                            Resume
                        </button>
                    )}
                    <button
                        className="px-4 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            border: '1.5px solid #b20100',
                            borderRadius: '0px',
                            color: '#b20100',
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </div>

            {/* Progress bar */}
            <div className="mb-8" style={{ backgroundColor: '#ffffff' }}>
                <div className="flex items-center justify-between px-6 pt-5 pb-3">
                    <div>
                        <p
                            className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1"
                            style={{ color: '#7a7574' }}
                        >
                            Progress
                        </p>
                        <p
                            className="text-[1.75rem] font-bold leading-none tracking-tight"
                            style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}
                        >
                            {progressLabel}
                        </p>
                    </div>
                    <div className="text-right">
                        <p
                            className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1"
                            style={{ color: '#7a7574' }}
                        >
                            Steps
                        </p>
                        <p
                            className="text-[0.875rem] font-mono"
                            style={{ color: '#1c1b1b' }}
                        >
                            {stepLabel}
                        </p>
                        <p
                            className="text-[0.6875rem] mt-0.5"
                            style={{ color: '#7a7574' }}
                        >
                            Epoch {job.currentEpoch ?? 0} / {job.epochs}
                        </p>
                    </div>
                </div>
                <div
                    className="mx-6 mb-6 h-2"
                    style={{ backgroundColor: '#f6f3f2' }}
                >
                    <div
                        className="h-2 transition-all"
                        style={{
                            width: `${job.progress}%`,
                            backgroundColor: job.status === 'running' ? '#b20100' : '#c4c4c4',
                        }}
                    />
                </div>
            </div>

            {/* Runtime stat cards */}
            <div
                className="grid grid-cols-4 mb-10"
                style={{ backgroundColor: 'rgba(233, 188, 181, 0.15)', gap: '1px' }}
            >
                <StatCard
                    label="Elapsed"
                    value={formatDuration(job.elapsedMin)}
                    sublabel={job.startedAtIso ? `Since ${formatRelative(job.startedAtIso)}` : 'Not started'}
                />
                <StatCard
                    label="ETA"
                    value={job.etaMin != null ? formatDuration(job.etaMin) : '\u2014'}
                    sublabel={job.status === 'running' ? 'Projected from loss trend' : job.status === 'queued' ? `Queue pos ${job.queuePosition ?? '?'}` : 'Halted'}
                />
                <StatCard
                    label="GPU Load"
                    value={`${job.gpu}%`}
                    sublabel={job.infra?.gpuType || '\u2014'}
                />
                <StatCard
                    label="Tokens / Sec"
                    value={(job.metrics?.tokensPerSec || 0).toLocaleString()}
                    sublabel={`Grad norm ${job.metrics?.gradNorm?.toFixed(2) ?? '\u2014'}`}
                    accent={job.status === 'running'}
                />
            </div>

            {/* Two-column: configuration + metrics */}
            <div className="grid grid-cols-3 gap-6 mb-10">
                <div className="col-span-2 p-6" style={{ backgroundColor: '#ffffff' }}>
                    <p
                        className="text-[0.625rem] font-semibold uppercase tracking-widest mb-4"
                        style={{ color: '#7a7574' }}
                    >
                        Loss Trajectory
                    </p>
                    <LossSparkline history={job.lossHistory} />
                    <div className="grid grid-cols-2 gap-6 mt-6">
                        <div>
                            <p
                                className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1"
                                style={{ color: '#7a7574' }}
                            >
                                Train Loss
                            </p>
                            <p className="text-[1.25rem] font-bold" style={{ color: '#1c1b1b' }}>
                                {job.metrics?.trainLoss?.toFixed(3) ?? '\u2014'}
                            </p>
                        </div>
                        <div>
                            <p
                                className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1"
                                style={{ color: '#7a7574' }}
                            >
                                Val Loss
                            </p>
                            <p className="text-[1.25rem] font-bold" style={{ color: '#b20100' }}>
                                {job.metrics?.valLoss?.toFixed(3) ?? '\u2014'}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="p-6" style={{ backgroundColor: '#ffffff' }}>
                    <p
                        className="text-[0.625rem] font-semibold uppercase tracking-widest mb-3"
                        style={{ color: '#7a7574' }}
                    >
                        Configuration
                    </p>
                    <DetailRow label="Base Model" value={job.baseModel} />
                    <DetailRow
                        label="Dataset"
                        value={
                            <Link
                                href={`/datasets/${encodeURIComponent(job.datasetRef)}`}
                                className="no-underline hover:underline"
                                style={{ color: '#b20100', textUnderlineOffset: '3px' }}
                                title={job.datasetRef}
                            >
                                {job.datasetName || job.datasetRef}
                            </Link>
                        }
                    />
                    <DetailRow label="LoRA" value={job.useLora ? `rank ${job.rank} · α ${job.loraAlpha}` : 'disabled'} />
                    <DetailRow label="Learning Rate" value={job.lr} mono />
                    <DetailRow label="Epochs" value={job.epochs} />
                    <DetailRow label="Batch Size" value={job.batchSize} />
                    <DetailRow label="Cluster" value={job.infra?.cluster || '\u2014'} mono />
                    <DetailRow label="Region" value={job.infra?.region || '\u2014'} />
                </div>
            </div>

            {/* Submission metadata */}
            <div
                className="grid grid-cols-3 gap-6 mb-10 p-6"
                style={{ backgroundColor: '#ffffff' }}
            >
                <div>
                    <p
                        className="text-[0.625rem] font-semibold uppercase tracking-widest mb-2"
                        style={{ color: '#7a7574' }}
                    >
                        Submitted By
                    </p>
                    <OwnerBadge owner={job.submittedBy} size="sm" />
                </div>
                <div>
                    <p
                        className="text-[0.625rem] font-semibold uppercase tracking-widest mb-2"
                        style={{ color: '#7a7574' }}
                    >
                        Submitted
                    </p>
                    <p className="text-[0.8125rem] font-bold" style={{ color: '#1c1b1b' }}>
                        {formatRelative(job.submittedAtIso)}
                    </p>
                    <p className="text-[0.6875rem] mt-0.5 font-mono" style={{ color: '#7a7574' }}>
                        {formatAbsolute(job.submittedAtIso)}
                    </p>
                </div>
                <div>
                    <p
                        className="text-[0.625rem] font-semibold uppercase tracking-widest mb-2"
                        style={{ color: '#7a7574' }}
                    >
                        Started
                    </p>
                    <p className="text-[0.8125rem] font-bold" style={{ color: '#1c1b1b' }}>
                        {formatRelative(job.startedAtIso)}
                    </p>
                    <p className="text-[0.6875rem] mt-0.5 font-mono" style={{ color: '#7a7574' }}>
                        {formatAbsolute(job.startedAtIso)}
                    </p>
                </div>
            </div>

            {/* Pause reason callout */}
            {job.status === 'paused' && job.pauseReason && (
                <div
                    className="p-5 mb-10"
                    style={{
                        backgroundColor: '#1c1b1b',
                        color: '#ffffff',
                        borderLeft: '3px solid #b20100',
                    }}
                >
                    <p
                        className="text-[0.625rem] font-semibold uppercase tracking-widest mb-2"
                        style={{ color: '#e9bcb5' }}
                    >
                        Paused &middot; Blocking Reason
                    </p>
                    <p className="text-[0.8125rem]">{job.pauseReason}</p>
                </div>
            )}

            {/* Auto-detected performance metrics */}
            {detectedMetrics.length > 0 && (
                <div className="mb-10">
                    <div className="flex items-end justify-between mb-3">
                        <div>
                            <h2
                                className="text-[0.875rem] font-bold uppercase tracking-widest"
                                style={{ color: '#1c1b1b' }}
                            >
                                Inferred Performance Metrics
                                <span
                                    className="ml-3 text-[0.6875rem] font-semibold"
                                    style={{ color: '#7a7574' }}
                                >
                                    ({detectedMetrics.filter((m) => m.classification === 'performance').length}
                                    /{detectedMetrics.length})
                                </span>
                            </h2>
                            <p
                                className="text-[0.6875rem] uppercase tracking-widest mt-1"
                                style={{ color: '#7a7574' }}
                            >
                                Auto-detected from repeating tokens in the log stream &middot; no hand-maintained schema
                            </p>
                        </div>
                    </div>
                    <div style={{ backgroundColor: '#ffffff' }}>
                        <div
                            className="flex items-center px-6 py-3 text-[0.625rem] font-semibold uppercase tracking-widest"
                            style={{
                                color: '#7a7574',
                                borderBottom: '1px solid rgba(233, 188, 181, 0.25)',
                            }}
                        >
                            <div className="flex-1">Token</div>
                            <div className="w-28 text-right">Occurrences</div>
                            <div className="w-28 text-right">Distinct Values</div>
                            <div className="w-24 text-right">Variability</div>
                            <div className="w-32 text-right">Latest Value</div>
                            <div className="w-32 text-right">Classification</div>
                        </div>
                        {detectedMetrics.map((m) => (
                            <div
                                key={m.key}
                                className="flex items-center px-6 py-3"
                                style={{ borderBottom: '1px solid rgba(233, 188, 181, 0.08)' }}
                            >
                                <div className="flex-1 min-w-0 pr-3">
                                    <p
                                        className="text-[0.875rem] font-mono font-bold"
                                        style={{ color: '#1c1b1b' }}
                                    >
                                        {m.key}
                                    </p>
                                </div>
                                <div
                                    className="w-28 text-right text-[0.8125rem] font-mono"
                                    style={{ color: '#1c1b1b' }}
                                >
                                    {m.occurrences}
                                </div>
                                <div
                                    className="w-28 text-right text-[0.8125rem] font-mono"
                                    style={{ color: '#1c1b1b' }}
                                >
                                    {m.distinctValues}
                                </div>
                                <div
                                    className="w-24 text-right text-[0.8125rem] font-mono"
                                    style={{ color: '#7a7574' }}
                                >
                                    {(m.variability * 100).toFixed(0)}%
                                </div>
                                <div
                                    className="w-32 text-right text-[0.8125rem] font-mono"
                                    style={{
                                        color: m.classification === 'performance' ? '#b20100' : '#1c1b1b',
                                    }}
                                >
                                    {m.lastValue}
                                </div>
                                <div className="w-32 text-right">
                                    <span
                                        className="inline-block px-2 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest"
                                        style={{
                                            backgroundColor:
                                                m.classification === 'performance'
                                                    ? 'rgba(178, 1, 0, 0.08)'
                                                    : 'rgba(122, 117, 116, 0.1)',
                                            color:
                                                m.classification === 'performance'
                                                    ? '#b20100'
                                                    : '#7a7574',
                                        }}
                                    >
                                        {m.classification === 'performance' ? 'Performance' : 'Label'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Log tail */}
            <div className="mb-10">
                <div className="flex items-end justify-between mb-3">
                    <div>
                        <h2
                            className="text-[0.875rem] font-bold uppercase tracking-widest"
                            style={{ color: '#1c1b1b' }}
                        >
                            Recent Logs
                            <span
                                className="ml-3 text-[0.6875rem] font-semibold"
                                style={{ color: '#7a7574' }}
                            >
                                ({logs.length})
                            </span>
                        </h2>
                        <p
                            className="text-[0.6875rem] uppercase tracking-widest mt-1"
                            style={{ color: '#7a7574' }}
                        >
                            Streamed from the training container &middot; most recent at bottom
                        </p>
                    </div>
                </div>
                <LogPanel logs={logs} />
            </div>

            {/* Audit footer */}
            <div
                className="flex items-center justify-between mt-10 pt-4 text-[0.625rem] uppercase tracking-widest"
                style={{
                    color: '#7a7574',
                    borderTop: '1px solid rgba(233, 188, 181, 0.2)',
                }}
            >
                <span>Infrastructure: {job.infra?.cluster || '\u2014'}</span>
                <span>
                    Run Hash: TRN-{job.id.slice(-6).toUpperCase()}-
                    {(job.currentStep || 0).toString(16).toUpperCase()}
                </span>
                <span>Artefacts retained 90d after completion</span>
            </div>
        </div>
    );
}
