// Cache module — read-through, invalidation, recents.
// Spec: docs/07 Integration CAA 27APR2026/redis-cache-integration.md.
//
// These tests exercise the public API of src/server/cache.js with a tiny
// in-memory ioredis fake so they don't need a running Redis. The fail-open
// case (no REDIS_URL) is exercised separately and asserts that every public
// function returns the documented "no cache" sentinel without throwing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory fake. Only implements the surface area cache.js uses.
class FakeRedis {
    constructor() {
        this.kv = new Map();
        this.lists = new Map();
        this.hashes = new Map();
        this.calls = [];
        this.handlers = new Map();
    }
    on(_event, _fn) { /* no-op for tests */ }
    disconnect() { /* no-op */ }

    async get(key) { this.calls.push(['get', key]); return this.kv.get(key) ?? null; }
    async set(key, val /*, 'EX', ttl */) { this.calls.push(['set', key]); this.kv.set(key, val); return 'OK'; }
    async del(key) { this.calls.push(['del', key]); return this.kv.delete(key) ? 1 : 0; }

    _list(k) { if (!this.lists.has(k)) this.lists.set(k, []); return this.lists.get(k); }
    _hash(k) { if (!this.hashes.has(k)) this.hashes.set(k, new Map()); return this.hashes.get(k); }

    async lrem(key, _count, value) {
        const list = this._list(key);
        const before = list.length;
        this.lists.set(key, list.filter((v) => v !== value));
        return before - this.lists.get(key).length;
    }
    async lpush(key, value) {
        this._list(key).unshift(value);
        return this.lists.get(key).length;
    }
    async ltrim(key, start, stop) {
        const list = this._list(key);
        // Redis: stop is inclusive. ltrim list 0 49 keeps 50 entries.
        this.lists.set(key, list.slice(start, stop + 1));
        return 'OK';
    }
    async lrange(key, start, stop) {
        const list = this._list(key);
        const end = stop === -1 ? list.length : stop + 1;
        return list.slice(start, end);
    }
    async hset(key, field, value) {
        this._hash(key).set(field, value);
        return 1;
    }
    async hdel(key, ...fields) {
        const h = this._hash(key);
        let n = 0;
        for (const f of fields) if (h.delete(f)) n++;
        return n;
    }
    async hkeys(key) { return [...this._hash(key).keys()]; }
    async hgetall(key) { return Object.fromEntries(this._hash(key)); }

    pipeline() {
        const ops = [];
        const self = this;
        const proxy = {
            lrem(...a) { ops.push(['lrem', ...a]); return proxy; },
            lpush(...a) { ops.push(['lpush', ...a]); return proxy; },
            ltrim(...a) { ops.push(['ltrim', ...a]); return proxy; },
            hset(...a) { ops.push(['hset', ...a]); return proxy; },
            async exec() {
                for (const [m, ...args] of ops) await self[m](...args);
                return ops.map(() => [null, 'OK']);
            },
        };
        return proxy;
    }
}

let fake;
vi.mock('ioredis', () => {
    return {
        default: class { constructor() { return fake; } },
    };
});

describe('cache module', () => {
    beforeEach(async () => {
        fake = new FakeRedis();
        process.env.REDIS_URL = 'redis://test:6379';
        process.env.NEXT_PUBLIC_MOCK_API = 'false';
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('getCachedDetail returns null on miss; setCachedDetail then get returns the payload', async () => {
        const cache = await import('@/server/cache');
        expect(await cache.getCachedDetail('ext-1')).toBeNull();
        await cache.setCachedDetail('ext-1', { id: 'ext-1', name: 'a.wav' });
        expect(await cache.getCachedDetail('ext-1')).toEqual({ id: 'ext-1', name: 'a.wav' });
    });

    it('invalidateDetail removes the cached payload', async () => {
        const cache = await import('@/server/cache');
        await cache.setCachedDetail('ext-1', { x: 1 });
        await cache.invalidateDetail('ext-1');
        expect(await cache.getCachedDetail('ext-1')).toBeNull();
    });

    it('recordRecent dedupes, caps at 50, and tracks accessedAt', async () => {
        const cache = await import('@/server/cache');
        const userId = 'u-larry';

        // Push 60 entries — list should be capped to 50, newest first.
        for (let i = 1; i <= 60; i++) {
            await cache.recordRecent(userId, `f-${i}`);
        }
        const recents = await cache.listRecents(userId);
        expect(recents).toHaveLength(50);
        expect(recents[0].id).toBe('f-60');
        expect(recents[49].id).toBe('f-11');

        // Re-push an existing id; it should jump to the front, not duplicate.
        await cache.recordRecent(userId, 'f-30');
        const after = await cache.listRecents(userId);
        expect(after[0].id).toBe('f-30');
        // No duplicates: f-30 appears exactly once.
        expect(after.filter((r) => r.id === 'f-30')).toHaveLength(1);
        // Each entry has an accessedAt timestamp.
        expect(after[0].accessedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('recordRecent prunes meta hash entries that fell off the list', async () => {
        const cache = await import('@/server/cache');
        const userId = 'u-larry';
        // Push past the cap.
        for (let i = 1; i <= 55; i++) {
            await cache.recordRecent(userId, `f-${i}`);
        }
        // Files 1..5 should have been trimmed from the list AND their meta
        // hash entries removed by the prune step.
        const meta = await fake.hgetall(`user:recent:meta:${userId}`);
        expect(Object.keys(meta).sort()).toEqual(
            Array.from({ length: 50 }, (_, i) => `f-${i + 6}`).sort(),
        );
    });

    it('listRecents returns [] when no list exists', async () => {
        const cache = await import('@/server/cache');
        expect(await cache.listRecents('u-nobody')).toEqual([]);
    });
});

describe('cache module — disabled paths', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns no-cache sentinels when REDIS_URL is unset (everything fail-open)', async () => {
        delete process.env.REDIS_URL;
        process.env.NEXT_PUBLIC_MOCK_API = 'false';
        vi.resetModules();
        const cache = await import('@/server/cache');

        await expect(cache.getCachedDetail('x')).resolves.toBeNull();
        await expect(cache.setCachedDetail('x', { y: 1 })).resolves.toBeUndefined();
        await expect(cache.invalidateDetail('x')).resolves.toBeUndefined();
        await expect(cache.recordRecent('u', 'x')).resolves.toBeUndefined();
        await expect(cache.listRecents('u')).resolves.toEqual([]);
    });

    it('returns no-cache sentinels when NEXT_PUBLIC_MOCK_API=true', async () => {
        process.env.REDIS_URL = 'redis://anything';
        process.env.NEXT_PUBLIC_MOCK_API = 'true';
        vi.resetModules();
        const cache = await import('@/server/cache');

        await expect(cache.getCachedDetail('x')).resolves.toBeNull();
        await expect(cache.listRecents('u')).resolves.toEqual([]);
    });
});
