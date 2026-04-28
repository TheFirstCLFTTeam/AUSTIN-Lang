'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    PROVIDERS,
    WEBHOOK_ENDPOINT,
    connectProvider,
    disconnectProvider,
    getConnectedAccounts,
    subscribeConnectedAccounts,
    updateConnection,
} from '@/services/connected-accounts';

function formatRelative(iso) {
    if (!iso) return '\u2014';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const diffMs = Date.now() - d.getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
}

function formatDate(iso) {
    if (!iso) return '\u2014';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ProviderGlyph({ provider }) {
    return (
        <span
            className="inline-flex items-center justify-center text-[0.75rem] font-bold shrink-0"
            style={{
                width: '2.25rem',
                height: '2.25rem',
                backgroundColor: provider.accent,
                color: '#ffffff',
                letterSpacing: '-0.02em',
            }}
            aria-hidden
        >
            {provider.name
                .split(/[\s-]+/)
                .map((w) => w[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
        </span>
    );
}

function IngestStatusBadge({ status }) {
    const styles = {
        ready: { bg: 'rgba(26, 127, 55, 0.08)', color: '#1a7f37', label: 'READY' },
        transcribing: { bg: 'rgba(178, 1, 0, 0.08)', color: '#b20100', label: 'TRANSCRIBING' },
        failed: { bg: 'rgba(122, 117, 116, 0.12)', color: '#7a7574', label: 'FAILED' },
        queued: { bg: 'rgba(0, 78, 198, 0.08)', color: '#004ec6', label: 'QUEUED' },
    };
    const s = styles[status] || styles.queued;
    return (
        <span
            className="inline-block px-2 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest"
            style={{ backgroundColor: s.bg, color: s.color }}
        >
            {s.label}
        </span>
    );
}

const CONNECT_STEPS = [
    { label: 'Redirecting to {provider} for authorization', delay: 700 },
    { label: 'Exchanging auth code for access + refresh tokens', delay: 700 },
    { label: 'Registering webhook subscription', delay: 700 },
    { label: 'Running 24h reconciliation sweep for missed recordings', delay: 800 },
];

function ConnectModal({ provider, onClose, onComplete }) {
    const [stepIdx, setStepIdx] = useState(0);
    const [done, setDone] = useState(false);

    useEffect(() => {
        if (!provider) return undefined;
        setStepIdx(0);
        setDone(false);
        let cancelled = false;
        let i = 0;
        const tick = () => {
            if (cancelled) return;
            if (i >= CONNECT_STEPS.length) {
                setDone(true);
                onComplete(provider.id);
                return;
            }
            setStepIdx(i);
            i += 1;
            setTimeout(tick, CONNECT_STEPS[i - 1]?.delay ?? 600);
        };
        const first = setTimeout(tick, 250);
        return () => {
            cancelled = true;
            clearTimeout(first);
        };
    }, [provider, onComplete]);

    if (!provider) return null;

    return (
        <div
            className="fixed inset-0 flex items-center justify-center z-50 p-4"
            style={{ backgroundColor: 'rgba(28, 27, 27, 0.55)' }}
            onClick={done ? onClose : undefined}
        >
            <div
                className="p-6"
                style={{ backgroundColor: '#ffffff', width: '520px', maxWidth: '100%', borderTop: `3px solid ${provider.accent}` }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-3 mb-4">
                    <ProviderGlyph provider={provider} />
                    <div>
                        <p className="text-[0.625rem] font-semibold uppercase tracking-widest" style={{ color: '#b20100' }}>Link Account</p>
                        <h3 className="text-[1.125rem] font-bold tracking-tight" style={{ color: '#1c1b1b', letterSpacing: '-0.01em' }}>
                            Connecting {provider.name}
                        </h3>
                    </div>
                </div>

                <div className="p-4 mb-4" style={{ backgroundColor: '#1c1b1b', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', minHeight: '150px' }}>
                    {CONNECT_STEPS.map((step, i) => {
                        const shown = i <= stepIdx;
                        const current = !done && i === stepIdx;
                        const finished = done || i < stepIdx;
                        if (!shown) return null;
                        const text = step.label.replace('{provider}', provider.name);
                        return (
                            <div key={i} className="flex items-start gap-2 text-[0.75rem] leading-relaxed">
                                <span
                                    className="shrink-0 mt-1.5"
                                    style={{
                                        width: '6px',
                                        height: '6px',
                                        borderRadius: '50%',
                                        backgroundColor: current ? '#e10000' : finished ? '#1a7f37' : 'rgba(255,255,255,0.3)',
                                        animation: current ? 'connect-pulse 1s ease-in-out infinite' : 'none',
                                    }}
                                />
                                <span style={{ color: current ? '#ffffff' : finished ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)' }}>
                                    {text}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <style jsx>{`
                    @keyframes connect-pulse {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.35; }
                    }
                `}</style>

                {done && (
                    <div className="p-3 mb-4" style={{ backgroundColor: 'rgba(26, 127, 55, 0.08)', borderLeft: '3px solid #1a7f37' }}>
                        <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#1a7f37' }}>
                            Linked
                        </p>
                        <p className="text-[0.75rem]" style={{ color: '#1c1b1b' }}>
                            Future {provider.name} recordings will be delivered to this platform via {provider.delivery.toLowerCase()}.
                        </p>
                    </div>
                )}

                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={!done}
                        className="px-5 py-2 text-[0.75rem] font-semibold uppercase tracking-widest cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                            background: done ? 'linear-gradient(135deg, #b20100, #e10000)' : 'transparent',
                            color: done ? '#ffffff' : '#1c1b1b',
                            border: done ? 'none' : '1.5px solid rgba(28,27,27,0.2)',
                            borderRadius: '0px',
                        }}
                    >
                        {done ? 'Done' : 'Linking...'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function DisconnectModal({ provider, onConfirm, onClose }) {
    if (!provider) return null;
    return (
        <div
            className="fixed inset-0 flex items-center justify-center z-50 p-4"
            style={{ backgroundColor: 'rgba(28, 27, 27, 0.55)' }}
            onClick={onClose}
        >
            <div
                className="p-6"
                style={{ backgroundColor: '#ffffff', width: '440px', maxWidth: '100%', borderTop: '3px solid #b20100' }}
                onClick={(e) => e.stopPropagation()}
            >
                <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: '#b20100' }}>Disconnect</p>
                <h3 className="text-[1.125rem] font-bold tracking-tight mb-2" style={{ color: '#1c1b1b', letterSpacing: '-0.01em' }}>
                    Unlink {provider.name}?
                </h3>
                <p className="text-[0.8125rem] leading-relaxed mb-5" style={{ color: '#7a7574' }}>
                    Existing recordings stay in your file browser. Future {provider.name} recordings will no longer be auto-ingested until you reconnect.
                </p>
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-[0.75rem] font-semibold uppercase tracking-widest cursor-pointer"
                        style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(28,27,27,0.2)', borderRadius: '0px', color: '#1c1b1b' }}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="px-5 py-2 text-[0.75rem] font-semibold uppercase tracking-widest cursor-pointer"
                        style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}
                    >
                        Disconnect
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function ConnectedAccounts() {
    const [{ connections, ingests }, setState] = useState(() => ({ connections: [], ingests: [] }));
    const [connectTarget, setConnectTarget] = useState(null);
    const [disconnectTarget, setDisconnectTarget] = useState(null);

    useEffect(() => {
        setState(getConnectedAccounts());
        return subscribeConnectedAccounts(setState);
    }, []);

    const connectionByProvider = useMemo(() => {
        const map = new Map();
        connections.forEach((c) => map.set(c.providerId, c));
        return map;
    }, [connections]);

    const providerById = useMemo(() => {
        const map = new Map();
        PROVIDERS.forEach((p) => map.set(p.id, p));
        return map;
    }, []);

    const recentIngests = useMemo(
        () => [...ingests].sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt)).slice(0, 6),
        [ingests],
    );

    const handleConnect = (provider) => {
        setConnectTarget(provider);
    };

    const handleConnectComplete = (providerId) => {
        connectProvider(providerId);
    };

    const handleDisconnect = (provider) => {
        setDisconnectTarget(provider);
    };

    const confirmDisconnect = () => {
        if (disconnectTarget) disconnectProvider(disconnectTarget.id);
        setDisconnectTarget(null);
    };

    return (
        <>
            <div className="p-5" style={{ backgroundColor: '#ffffff' }}>
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-1" style={{ color: '#7a7574' }}>
                            Connected Accounts
                        </h3>
                        <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                            Auto-ingest meeting recordings from third-party platforms. Deliveries arrive via provider webhooks and are reconciled nightly against each provider&apos;s API to catch any missed events.
                        </p>
                    </div>
                    <span
                        className="text-[0.5625rem] font-semibold uppercase tracking-widest px-2 py-0.5 shrink-0"
                        style={{ backgroundColor: 'rgba(26, 127, 55, 0.08)', color: '#1a7f37' }}
                    >
                        {connections.length} LINKED
                    </span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                    {PROVIDERS.map((provider) => {
                        const conn = connectionByProvider.get(provider.id);
                        const connected = Boolean(conn);
                        return (
                            <div
                                key={provider.id}
                                className="p-4"
                                style={{
                                    backgroundColor: connected ? 'rgba(178, 1, 0, 0.02)' : '#f6f3f2',
                                    borderLeft: `3px solid ${connected ? provider.accent : 'transparent'}`,
                                }}
                            >
                                <div className="flex items-start gap-3">
                                    <ProviderGlyph provider={provider} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[0.875rem] font-bold" style={{ color: '#1c1b1b' }}>
                                                {provider.name}
                                            </span>
                                            <span
                                                className="text-[0.5625rem] font-semibold uppercase tracking-widest px-1.5 py-0.5"
                                                style={{ backgroundColor: '#1c1b1b', color: '#ffffff' }}
                                            >
                                                {provider.category}
                                            </span>
                                            {connected && (
                                                <span
                                                    className="text-[0.5625rem] font-semibold uppercase tracking-widest px-1.5 py-0.5"
                                                    style={{ backgroundColor: 'rgba(26, 127, 55, 0.08)', color: '#1a7f37' }}
                                                >
                                                    CONNECTED
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[0.75rem] mt-0.5" style={{ color: '#7a7574' }}>
                                            {provider.description}
                                        </p>
                                        <p className="text-[0.6875rem] font-mono mt-1" style={{ color: '#7a7574' }}>
                                            {provider.delivery}
                                        </p>
                                    </div>
                                    <div className="shrink-0">
                                        {connected ? (
                                            <button
                                                type="button"
                                                onClick={() => handleDisconnect(provider)}
                                                className="px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                                                style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(28,27,27,0.2)', borderRadius: '0px', color: '#1c1b1b' }}
                                            >
                                                Disconnect
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleConnect(provider)}
                                                className="px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                                                style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}
                                            >
                                                Connect
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {connected && (
                                    <div className="mt-4 pt-4 grid grid-cols-4 gap-4" style={{ borderTop: '1px solid rgba(233, 188, 181, 0.25)' }}>
                                        <div className="min-w-0">
                                            <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#7a7574' }}>Account</p>
                                            <p className="text-[0.75rem] font-mono truncate" style={{ color: '#1c1b1b' }} title={conn.account}>
                                                {conn.account}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#7a7574' }}>Webhook ID</p>
                                            <p className="text-[0.75rem] font-mono" style={{ color: '#1c1b1b' }}>{conn.webhookId}</p>
                                        </div>
                                        <div>
                                            <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#7a7574' }}>Last Delivery</p>
                                            <p className="text-[0.75rem]" style={{ color: '#1c1b1b' }}>{formatRelative(conn.lastSync)}</p>
                                            <p className="text-[0.625rem]" style={{ color: '#7a7574' }}>Connected {formatDate(conn.connectedAt)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#7a7574' }}>Ingested</p>
                                            <p className="text-[0.75rem] font-bold" style={{ color: '#1c1b1b' }}>{conn.recordingsIngested.toLocaleString()} recordings</p>
                                        </div>
                                    </div>
                                )}

                                {connected && (
                                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                                        <label className="flex items-center gap-2 text-[0.75rem] cursor-pointer" style={{ color: '#1c1b1b' }}>
                                            <input
                                                type="checkbox"
                                                checked={conn.autoIngest}
                                                onChange={(e) => updateConnection(provider.id, { autoIngest: e.target.checked })}
                                                style={{ accentColor: '#b20100', cursor: 'pointer' }}
                                            />
                                            <span>Auto-transcribe new recordings</span>
                                        </label>
                                        <label className="flex items-center gap-2 text-[0.75rem] cursor-pointer" style={{ color: '#1c1b1b' }}>
                                            <input
                                                type="checkbox"
                                                checked={conn.pullSpeakerLabels}
                                                onChange={(e) => updateConnection(provider.id, { pullSpeakerLabels: e.target.checked })}
                                                style={{ accentColor: '#b20100', cursor: 'pointer' }}
                                            />
                                            <span>Also pull provider speaker labels</span>
                                        </label>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="mt-4 p-5" style={{ backgroundColor: '#ffffff' }}>
                <div className="flex items-baseline justify-between mb-3">
                    <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: '#7a7574' }}>
                        Recent Ingests
                    </h3>
                    <p className="text-[0.625rem] uppercase tracking-widest" style={{ color: '#7a7574' }}>
                        Deliveries received via webhook
                    </p>
                </div>

                {recentIngests.length === 0 ? (
                    <p className="text-[0.8125rem] py-4" style={{ color: '#7a7574' }}>
                        No ingests yet. Connect a provider to start receiving recordings automatically.
                    </p>
                ) : (
                    <div>
                        <div
                            className="flex items-center py-2 text-[0.5625rem] font-semibold uppercase tracking-widest"
                            style={{ color: '#7a7574', borderBottom: '1px solid rgba(233, 188, 181, 0.2)' }}
                        >
                            <div className="w-32">Provider</div>
                            <div className="flex-1">Recording</div>
                            <div className="w-20 text-right">Duration</div>
                            <div className="w-28 text-right">Received</div>
                            <div className="w-28 text-right">Status</div>
                        </div>
                        {recentIngests.map((ing) => {
                            const p = providerById.get(ing.providerId);
                            return (
                                <div
                                    key={ing.id}
                                    className="flex items-center py-2.5"
                                    style={{ borderBottom: '1px solid rgba(233, 188, 181, 0.08)' }}
                                >
                                    <div className="w-32 flex items-center gap-2 min-w-0">
                                        <span
                                            className="inline-block shrink-0"
                                            style={{ width: '8px', height: '8px', backgroundColor: p?.accent || '#7a7574' }}
                                        />
                                        <span className="text-[0.75rem] truncate" style={{ color: '#1c1b1b' }}>
                                            {p?.name || ing.providerId}
                                        </span>
                                    </div>
                                    <div className="flex-1 min-w-0 pr-3">
                                        <p className="text-[0.8125rem] font-medium truncate" style={{ color: '#1c1b1b' }}>
                                            {ing.title}
                                        </p>
                                    </div>
                                    <div className="w-20 text-right text-[0.75rem] font-mono" style={{ color: '#7a7574' }}>
                                        {ing.durationMin} min
                                    </div>
                                    <div className="w-28 text-right text-[0.75rem]" style={{ color: '#7a7574' }}>
                                        {formatRelative(ing.receivedAt)}
                                    </div>
                                    <div className="w-28 flex justify-end">
                                        <IngestStatusBadge status={ing.status} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="mt-4 p-5" style={{ backgroundColor: '#ffffff' }}>
                <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                        <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-1" style={{ color: '#7a7574' }}>
                            Webhook Endpoint
                        </h3>
                        <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                            Each provider&apos;s webhook subscription points at this host. Incoming deliveries are signature-verified, acknowledged in &lt;3s, then queued for download. A nightly reconciliation sweep backfills any events the webhook missed.
                        </p>
                    </div>
                </div>
                <pre
                    className="p-3 text-[0.75rem] overflow-x-auto"
                    style={{ backgroundColor: '#1c1b1b', color: '#f6f3f2', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', margin: 0, whiteSpace: 'pre' }}
                >
                    {`POST ${WEBHOOK_ENDPOINT}\nX-Signature: hmac-sha256=...   # verified against AUSTIN_WEBHOOK_SECRET\n\n# nightly reconciliation\n0 2 * * *  austin-workers reconcile --provider all --window 24h`}
                </pre>
            </div>

            <ConnectModal
                provider={connectTarget}
                onClose={() => setConnectTarget(null)}
                onComplete={handleConnectComplete}
            />
            <DisconnectModal
                provider={disconnectTarget}
                onConfirm={confirmDisconnect}
                onClose={() => setDisconnectTarget(null)}
            />
        </>
    );
}
