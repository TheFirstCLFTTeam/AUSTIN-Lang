'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { readCsrfToken } from '../../../services/http';

const PROVIDER_META = {
    teams: {
        blurb: 'Auto-ingest Microsoft Teams meeting recordings. We watch your tenant via Microsoft Graph change notifications and pull the audio as soon as Teams finishes processing it.',
        accent: '#5059c9',
    },
    zoom: {
        blurb: 'Auto-ingest Zoom cloud recordings. Install our Server-to-Server OAuth app in your Zoom Marketplace; we receive a webhook the moment the recording finishes uploading.',
        accent: '#2d8cff',
    },
};

export default function IntegrationsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [data, setData] = useState({ providers: [], connections: [] });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(null); // provider id currently in flight
    const [error, setError] = useState(null);
    const [flash, setFlash] = useState(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch('/api/integrations', { credentials: 'include' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            setData(await r.json());
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // If the user lands here from a provider OAuth callback, show a flash.
    useEffect(() => {
        const cb = searchParams.get('callback');
        if (cb) setFlash(`Returned from ${cb} — refreshing connections…`);
    }, [searchParams]);

    const onConnect = async (providerId) => {
        setBusy(providerId);
        setError(null);
        try {
            const csrf = readCsrfToken();
            const r = await fetch(`/api/integrations/${providerId}/connect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
                },
                credentials: 'include',
                body: JSON.stringify({}),
            });
            const body = await r.json();
            if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
            if (body.redirect_url) {
                window.location.href = body.redirect_url;
                return;
            }
            setFlash(body.instructions || 'Connection started.');
            await refresh();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const onDisconnect = async (providerId) => {
        setBusy(providerId);
        setError(null);
        try {
            const csrf = readCsrfToken();
            const r = await fetch(`/api/integrations/${providerId}/disconnect`, {
                method: 'POST',
                credentials: 'include',
                headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
            });
            if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                throw new Error(body.detail || `HTTP ${r.status}`);
            }
            setFlash('Disconnected.');
            await refresh();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const connectionByProvider = new Map(
        (data.connections || []).map((c) => [c.provider, c]),
    );

    return (
        <div className="px-6 py-8 max-w-4xl mx-auto" style={{ fontFamily: "'Inter', sans-serif" }}>
            <header className="mb-8">
                <h1 className="text-[1.75rem] font-semibold mb-1" style={{ color: '#1c1b1b' }}>
                    Integrations
                </h1>
                <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>
                    Connect a meeting platform to auto-ingest its recordings into the transcription pipeline.
                </p>
            </header>

            {error && (
                <div
                    role="alert"
                    className="mb-4 px-3.5 py-3 text-[0.8125rem]"
                    style={{ backgroundColor: '#fff1f2', border: '1px solid #ffd5d8', color: '#ba1a1a', borderRadius: '6px' }}
                >
                    {error}
                </div>
            )}
            {flash && (
                <div
                    className="mb-4 px-3.5 py-3 text-[0.8125rem]"
                    style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: '6px' }}
                >
                    {flash}
                </div>
            )}

            {loading && (
                <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>Loading…</p>
            )}

            <div className="space-y-3">
                {(data.providers || []).map((p) => {
                    const meta = PROVIDER_META[p.id] || {};
                    const conn = connectionByProvider.get(p.id);
                    const connected = !!conn;
                    return (
                        <article
                            key={p.id}
                            className="px-5 py-4 flex items-start gap-4"
                            style={{ backgroundColor: '#ffffff', border: '1px solid #e8e4e3', borderRadius: '8px' }}
                        >
                            <div
                                className="shrink-0 mt-0.5 flex items-center justify-center"
                                style={{
                                    width: 40, height: 40, borderRadius: '8px',
                                    backgroundColor: (meta.accent || '#7a7574') + '15',
                                    color: meta.accent || '#7a7574',
                                    fontWeight: 700,
                                }}
                                aria-hidden
                            >
                                {p.display_name.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <h2 className="text-[0.9375rem] font-semibold" style={{ color: '#1c1b1b' }}>
                                        {p.display_name}
                                    </h2>
                                    <StatusPill status={conn?.status} />
                                </div>
                                <p className="text-[0.8125rem]" style={{ color: '#7a7574' }}>
                                    {meta.blurb || 'No description available.'}
                                </p>
                                {conn?.external_account && (
                                    <p className="text-[0.75rem] mt-1" style={{ color: '#9a9694' }}>
                                        Account: <span style={{ fontFamily: 'ui-monospace, monospace' }}>{conn.external_account}</span>
                                    </p>
                                )}
                            </div>
                            <div className="shrink-0">
                                {connected ? (
                                    <button
                                        type="button"
                                        onClick={() => onDisconnect(p.id)}
                                        disabled={busy === p.id}
                                        className="px-3.5 py-2 text-[0.8125rem] font-medium cursor-pointer disabled:opacity-60"
                                        style={{ backgroundColor: '#ffffff', border: '1px solid #d4d4d4', borderRadius: '6px', color: '#1c1b1b' }}
                                    >
                                        {busy === p.id ? 'Disconnecting…' : 'Disconnect'}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => onConnect(p.id)}
                                        disabled={busy === p.id}
                                        className="px-3.5 py-2 text-[0.8125rem] font-semibold cursor-pointer disabled:opacity-60"
                                        style={{ backgroundColor: meta.accent || '#1c1b1b', color: '#ffffff', border: 'none', borderRadius: '6px' }}
                                    >
                                        {busy === p.id ? 'Connecting…' : `Connect ${p.display_name}`}
                                    </button>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>

            <p className="mt-6 text-[0.75rem]" style={{ color: '#9a9694' }}>
                Recordings ingested via these connections appear in your file list under the same workflow as manual uploads.
                Source attribution is preserved on each row so you can tell which recordings came from which platform.
            </p>
        </div>
    );
}

function StatusPill({ status }) {
    if (!status) return null;
    const map = {
        connected:      { bg: '#dcfce7', fg: '#166534', label: 'Connected' },
        connected_mock: { bg: '#fef3c7', fg: '#92400e', label: 'Mock' },
        pending:        { bg: '#e0e7ff', fg: '#3730a3', label: 'Pending' },
        degraded:       { bg: '#fee2e2', fg: '#991b1b', label: 'Degraded' },
    };
    const m = map[status] || { bg: '#f3f4f6', fg: '#374151', label: status };
    return (
        <span
            className="inline-flex items-center text-[0.6875rem] font-medium px-2 py-0.5"
            style={{ backgroundColor: m.bg, color: m.fg, borderRadius: '9999px' }}
        >
            {m.label}
        </span>
    );
}
