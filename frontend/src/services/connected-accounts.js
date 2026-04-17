// Mock store for third-party accounts a user has linked for auto-ingest.
// Each provider exposes its own delivery mechanism (Zoom webhook, Teams
// Graph subscription, etc.) but they normalise into the same connection +
// recent-ingest shape so the UI can treat them uniformly.

const STORAGE_KEY = 'austin.connectedAccounts';

export const PROVIDERS = [
    {
        id: 'zoom',
        name: 'Zoom',
        category: 'Video Conferencing',
        description: 'Auto-ingest cloud recordings after each meeting ends.',
        delivery: 'Webhook \u00b7 recording.completed',
        scopes: ['recording:read', 'meeting:read', 'user:read'],
        accent: '#2d8cff',
    },
    {
        id: 'teams',
        name: 'Microsoft Teams',
        category: 'Video Conferencing',
        description: 'Pull recordings from OneDrive for Business via Graph subscriptions.',
        delivery: 'Graph subscription \u00b7 driveItem.updated',
        scopes: ['OnlineMeetingRecording.Read.All', 'Files.Read'],
        accent: '#464eb8',
    },
    {
        id: 'google-meet',
        name: 'Google Meet',
        category: 'Video Conferencing',
        description: 'Ingest recordings saved to Drive via Drive change notifications.',
        delivery: 'Drive push channel \u00b7 changes.watch',
        scopes: ['drive.readonly', 'meet.readonly'],
        accent: '#00897b',
    },
    {
        id: 'webex',
        name: 'Cisco Webex',
        category: 'Video Conferencing',
        description: 'Capture cloud recordings from Webex meetings.',
        delivery: 'Webhook \u00b7 recordings resource',
        scopes: ['meeting:recordings_read', 'spark:people_read'],
        accent: '#006d5b',
    },
    {
        id: 'dropbox',
        name: 'Dropbox',
        category: 'Storage',
        description: 'Watch a shared folder for new audio uploads.',
        delivery: 'Webhook \u00b7 /files/list_folder/continue',
        scopes: ['files.content.read'],
        accent: '#0061ff',
    },
];

const DEFAULT_STATE = {
    connections: [
        {
            providerId: 'zoom',
            account: 'engineer@example.com',
            connectedAt: '2026-03-22T10:12:00Z',
            lastSync: '2026-04-17T07:42:00Z',
            autoIngest: true,
            pullSpeakerLabels: true,
            status: 'healthy',
            webhookId: 'wh_zoom_9a3f2e',
            recordingsIngested: 34,
        },
    ],
    ingests: [
        { id: 'ing-101', providerId: 'zoom', title: 'Weekly Platform Sync', receivedAt: '2026-04-17T07:42:00Z', durationMin: 47, status: 'ready' },
        { id: 'ing-102', providerId: 'zoom', title: 'Compliance Review \u2014 Q2', receivedAt: '2026-04-16T15:05:00Z', durationMin: 62, status: 'transcribing' },
        { id: 'ing-103', providerId: 'zoom', title: 'Client Call \u2014 Nakamura', receivedAt: '2026-04-16T09:30:00Z', durationMin: 28, status: 'ready' },
        { id: 'ing-104', providerId: 'zoom', title: 'Design Crit', receivedAt: '2026-04-15T14:00:00Z', durationMin: 52, status: 'failed' },
        { id: 'ing-105', providerId: 'zoom', title: 'Architecture Walkthrough', receivedAt: '2026-04-14T11:20:00Z', durationMin: 41, status: 'ready' },
    ],
};

function loadFromStorage() {
    if (typeof window === 'undefined') return structuredClone(DEFAULT_STATE);
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return structuredClone(DEFAULT_STATE);
        const parsed = JSON.parse(raw);
        return {
            connections: Array.isArray(parsed.connections) ? parsed.connections : [],
            ingests: Array.isArray(parsed.ingests) ? parsed.ingests : [],
        };
    } catch {
        return structuredClone(DEFAULT_STATE);
    }
}

let _state = loadFromStorage();
const _listeners = new Set();

function persist() {
    if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    }
    _listeners.forEach((fn) => fn(snapshot()));
}

function snapshot() {
    return {
        connections: _state.connections.map((c) => ({ ...c })),
        ingests: _state.ingests.map((i) => ({ ...i })),
    };
}

export function getConnectedAccounts() {
    return snapshot();
}

export function subscribeConnectedAccounts(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

export function getConnection(providerId) {
    return _state.connections.find((c) => c.providerId === providerId) || null;
}

export function connectProvider(providerId, { account } = {}) {
    const existing = getConnection(providerId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const conn = {
        providerId,
        account: account || 'engineer@example.com',
        connectedAt: now,
        lastSync: now,
        autoIngest: true,
        pullSpeakerLabels: true,
        status: 'healthy',
        webhookId: `wh_${providerId}_${Math.random().toString(16).slice(2, 8)}`,
        recordingsIngested: 0,
    };
    _state.connections = [..._state.connections, conn];
    persist();
    return conn;
}

export function disconnectProvider(providerId) {
    _state.connections = _state.connections.filter((c) => c.providerId !== providerId);
    persist();
}

export function updateConnection(providerId, patch) {
    _state.connections = _state.connections.map((c) =>
        c.providerId === providerId ? { ...c, ...patch } : c,
    );
    persist();
}

export function resetConnectedAccounts() {
    _state = structuredClone(DEFAULT_STATE);
    persist();
}

export const WEBHOOK_ENDPOINT = 'https://austin.internal/api/integrations/:provider/webhook';
