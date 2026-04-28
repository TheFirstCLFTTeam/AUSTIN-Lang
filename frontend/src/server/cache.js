import 'server-only';

import Redis from 'ioredis';

// Read-through Redis cache for the file-detail endpoint + a server-side
// per-user "recently viewed" list.
//
// Spec: docs/07 Integration CAA 27APR2026/redis-cache-integration.md.
//
// Hard rule: a Redis outage MUST NEVER produce a 5xx. Every public function
// is fail-open — cache errors are logged at WARN and the caller falls
// through to its non-cached path (typically a SQLite read).

const URL = process.env.REDIS_URL;
const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_API === 'true';
const ENABLED = !!URL && !MOCK_MODE;

const DETAIL_TTL_SEC = 120;
const RECENTS_CAP = 50;

const detailKey      = (id)     => `audio:detail:${id}`;
const recentListKey  = (userId) => `user:recent:${userId || 'anon'}`;
const recentMetaKey  = (userId) => `user:recent:meta:${userId || 'anon'}`;

let _client = null;

function client() {
    if (!ENABLED) return null;
    if (_client) return _client;

    _client = new Redis(URL, {
        // Fail fast — we'd rather fall through to SQLite than queue requests
        // when Redis is sick.
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        // ioredis logs connection errors at the noisy default; capture them
        // ourselves so a redis outage doesn't spam stderr.
        retryStrategy(times) {
            // Cap reconnect backoff at ~3s; ioredis will keep trying.
            return Math.min(times * 200, 3000);
        },
    });

    _client.on('error', (err) => {
        // ECONNREFUSED / ETIMEDOUT etc. are expected when Redis is down.
        // Log once per error class, then stay quiet to avoid log floods.
        if (!_client._lastErrorCode || _client._lastErrorCode !== err.code) {
            console.warn('[cache] redis error:', err.code || err.message);
            _client._lastErrorCode = err.code;
        }
    });

    return _client;
}

// Test hook — clears the singleton so vitest can swap in a mock between
// test cases without process restart.
export function _resetClientForTests() {
    if (_client) {
        try { _client.disconnect(); } catch { /* ignore */ }
    }
    _client = null;
}

// Read-through wrapper. Returns the parsed payload on hit, null on miss /
// disabled / error.
export async function getCachedDetail(id) {
    const r = client();
    if (!r) return null;
    try {
        const raw = await r.get(detailKey(id));
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.warn('[cache] getCachedDetail miss:', err.message);
        return null;
    }
}

export async function setCachedDetail(id, payload) {
    const r = client();
    if (!r || !payload) return;
    try {
        await r.set(detailKey(id), JSON.stringify(payload), 'EX', DETAIL_TTL_SEC);
    } catch (err) {
        console.warn('[cache] setCachedDetail failed:', err.message);
    }
}

export async function invalidateDetail(id) {
    const r = client();
    if (!r) return;
    try {
        await r.del(detailKey(id));
    } catch (err) {
        console.warn('[cache] invalidateDetail failed:', err.message);
    }
}

export async function recordRecent(userId, fileId) {
    const r = client();
    if (!r || !fileId) return;
    const list = recentListKey(userId);
    const meta = recentMetaKey(userId);
    const ts = new Date().toISOString();
    try {
        const pipe = r.pipeline();
        pipe.lrem(list, 0, String(fileId));        // dedupe older occurrences
        pipe.lpush(list, String(fileId));
        pipe.ltrim(list, 0, RECENTS_CAP - 1);
        pipe.hset(meta, String(fileId), ts);
        await pipe.exec();

        // Prune meta hash entries that fell off the list. Cheap because
        // there are at most RECENTS_CAP+small kept items in practice.
        const keep = new Set(await r.lrange(list, 0, -1));
        const all = await r.hkeys(meta);
        const stale = all.filter((k) => !keep.has(k));
        if (stale.length) await r.hdel(meta, ...stale);
    } catch (err) {
        console.warn('[cache] recordRecent failed:', err.message);
    }
}

export async function listRecents(userId) {
    const r = client();
    if (!r) return [];
    try {
        const ids = await r.lrange(recentListKey(userId), 0, -1);
        if (!ids.length) return [];
        const meta = await r.hgetall(recentMetaKey(userId));
        return ids.map((id) => ({ id, accessedAt: meta[id] || null }));
    } catch (err) {
        console.warn('[cache] listRecents failed:', err.message);
        return [];
    }
}

// Convenience export for tests + diagnostics — not consumed by the route layer.
export const _internals = { detailKey, recentListKey, recentMetaKey, DETAIL_TTL_SEC, RECENTS_CAP };
