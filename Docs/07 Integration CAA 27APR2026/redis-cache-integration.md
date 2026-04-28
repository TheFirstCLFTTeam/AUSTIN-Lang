# Redis Cache Integration — Recently-Viewed Recording Details

_Last updated: 2026-04-27 (branch `ui_enhancement`)_

Implementation spec for adding a Redis cache as middleware between the Next.js API routes and `getAudioFileDetail()`, with a server-side per-user "recently viewed" list. This is a pre-build reference — when we actually build it, we follow this doc.

Sibling reading: `file_viewing_pipeline.md` (current cold path), `backend_integration_status.md` (env-var conventions).

---

## 1. Goals & non-goals

### Goals

1. Cut p50/p95 latency on `GET /api/audio-files/{id}` for files a user has touched recently — the read joins five tables (`audio_file`, `raw_transcript`, `raw_transcript_segment`, `transcript_edit`, plus owner lookup) and runs on every mount of `/files/[id]`.
2. Maintain a **server-side per-user recents list** that survives device switches and incognito sessions (today's `src/lib/recents.js` is `localStorage`-only, so a user on a phone can't see what they opened on their laptop).
3. Pre-warm the cache on access — opening a file populates Redis so the next viewer (often the same user, sometimes a reviewer) gets a hot read.

### Non-goals

- Not a transcript editing buffer. Edits still go straight to SQLite + the backend co-write; Redis is read-only cache.
- Not a session/auth store. Auth is owned by `8004`; this Redis instance is application-level cache only.
- No multi-region replication, no persistence guarantees. Treat Redis data as **fully reconstructible from `platform.db`** — if it dies, the app degrades to today's behaviour.
- Not replacing `localStorage` recents — the client-side list stays for instant render before the network round-trip; Redis is the durable mirror.

---

## 2. Architecture

```
                              ┌──────────────────────────────┐
GET /api/audio-files/{id} ───▶│ route.js                     │
                              │   ① cache.getDetail(id)      │
                              └──────────────┬───────────────┘
                                             │ miss
                                             ▼
                              ┌──────────────────────────────┐
                              │ getAudioFileDetail(id)       │
                              │ (existing SQLite read)       │
                              └──────────────┬───────────────┘
                                             │
                                ② cache.setDetail(id, detail)
                                ③ cache.recordRecent(userId, id)
                                             │
                                             ▼
                                          response

GET /api/recents       ───▶ cache.listRecents(userId)
                            (returns last N file IDs + accessedAt)

PUT /api/audio-files/{id}/edits         ─┐
POST /api/audio-files/{id}/approve      ─┤
POST /api/audio-files/{id}/submit-…     ─┼─▶ cache.invalidate(id)
POST /api/pseudonymisation/{id}/…       ─┘
```

Redis sits behind a thin module (`src/server/cache.js`) so route handlers don't talk to `ioredis` directly. That module is the only place that knows the key format.

---

## 3. What gets cached (and what doesn't)

| Data | Cache? | Key | TTL | Notes |
|---|---|---|---|---|
| `getAudioFileDetail(id)` full payload | ✅ | `audio:detail:{fileId}` | **120 s** soft TTL + explicit invalidation | The hot path. Stored as JSON string. |
| Per-user recents list | ✅ | `user:recent:{userId}` | none (capped via `LTRIM`) | Redis list, push-front. |
| Per-file recents accessedAt | ✅ | hash field on `user:recent:meta:{userId}` | none | Hash → `{ fileId: ISO timestamp }`, mirrors `recents.js` shape. |
| Audio bytes / `audioUrl` content | ❌ | — | — | Already served by `audio_submission`; let CDN/browser cache do this. |
| Pseudonymisation spans | ❌ for now | — | — | Mutates often via reviewer decisions. Add later if read pressure shows up. |
| Adapter list (`/api/adapters`) | ✅ (optional, phase 2) | `adapters:list` | 60 s | Not in scope of this spec. |
| Auth / session | ❌ | — | — | Out of scope. |

### Cache-key prefix convention

`<entity>:<sub>:{id}`. All keys live in the default DB (0). Prefix everything with `austin:` if we ever share the cluster.

---

## 4. Recently-viewed list semantics

Per user:

- **Push** on every detail fetch: `LPUSH user:recent:{userId} {fileId}` followed by `LREM` to dedupe older occurrences, then `LTRIM user:recent:{userId} 0 49` to cap at 50 entries.
- **Mirror timestamp** in a hash: `HSET user:recent:meta:{userId} {fileId} {ISO}`. Used by the dashboard's "Recently viewed" widget for date-bucket grouping (matches `groupByDateBucket()` in `recents.js:57`).
- **Read** via `GET /api/recents` → `LRANGE user:recent:{userId} 0 -1` + `HGETALL user:recent:meta:{userId}`, returns `[{ id, accessedAt }, …]` already in the shape `recents.js` uses.

**Why both a list and a hash?** The list gives ordered LRU-style traversal cheaply; the hash gives O(1) timestamp lookup for any given file without scanning the list. The hash entries are pruned in lockstep when the list is trimmed (see implementation in §6).

---

## 5. Invalidation rules

Single rule: **anything that mutates a file's detail payload must `DEL audio:detail:{fileId}`**. Concretely:

| Mutation site | File:Line | Action |
|---|---|---|
| `writeEditsForFile()` | `src/server/audio-files.js:281` | `DEL audio:detail:{fileId}` after the SQLite tx commits, before the backend co-write. |
| `setAudioFileStatus()` | `src/server/audio-files.js:349` | `DEL audio:detail:{fileId}`. |
| `registerUploadedFile()` | `src/server/audio-files.js:169` | No-op (new entry, nothing to invalidate yet). |
| `recordSpanDecision()` (pseudonymisation orchestrator → frontend cache) | wherever the API route persists the decision | `DEL audio:detail:{fileId}` because `pseudonymisationApplied` / `pseudonymisationWarning` flags can flip. |
| `coWriteEditedTranscriptToBackend()` failure | `src/server/audio-files.js:243` | Already non-fatal; cache stays invalidated either way. |

Recents list invalidation is **not** needed on mutation — the entries are pointers, not content.

### Stampede / dogpile

Two-layer defence:

1. Soft TTL (120 s) bounds blast radius if invalidation is missed.
2. Single-flight: when a key is missing, set a short `audio:detail:lock:{fileId}` (`SET NX PX 2000`). If another request finds the lock, it sleeps 50 ms and re-reads the key. Skip this layer for v1; add only if logs show concurrent cold reads.

---

## 6. Implementation steps

### Step 1 — Add Redis to `compose.yaml`

```yaml
redis:
  image: redis:7-alpine
  command: ["redis-server", "--appendonly", "no", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
  ports:
    - "${REDIS_PORT:-6379}:6379"
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 2s
    retries: 5
```

`allkeys-lru` makes Redis itself act as a bounded LRU — even if we forget to TTL something, oldest gets evicted under memory pressure. No persistence (`appendonly no`) because the cache is reconstructible.

Add `redis` to the `frontend` service's `depends_on` (with `condition: service_healthy`) and inject:

```yaml
environment:
  - REDIS_URL=redis://redis:6379
```

### Step 2 — Add `ioredis` to the frontend

```
cd frontend && npm install ioredis
```

Pin to `^5.x`. Reasoning: we already use Node 20; `ioredis` has the most ergonomic typings for the list/hash ops we need, and it auto-reconnects without ceremony.

### Step 3 — Create the cache module

**New file:** `frontend/src/server/cache.js`

```js
import Redis from 'ioredis';

const URL = process.env.REDIS_URL;
const ENABLED = !!URL && process.env.NEXT_PUBLIC_MOCK_API !== 'true';

let client = null;
function redis() {
    if (!ENABLED) return null;
    if (!client) {
        client = new Redis(URL, {
            lazyConnect: false,
            maxRetriesPerRequest: 1,        // fail fast → fall through to SQLite
            enableOfflineQueue: false,
        });
        client.on('error', (err) => {
            console.warn('[cache] redis error:', err.message);
        });
    }
    return client;
}

const DETAIL_TTL_SEC = 120;
const RECENTS_CAP = 50;

const detailKey = (id) => `audio:detail:${id}`;
const recentListKey = (userId) => `user:recent:${userId || 'anon'}`;
const recentMetaKey = (userId) => `user:recent:meta:${userId || 'anon'}`;

// Read-through wrapper. Returns the payload or null on miss/disabled.
export async function getCachedDetail(id) {
    const r = redis();
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
    const r = redis();
    if (!r || !payload) return;
    try {
        await r.set(detailKey(id), JSON.stringify(payload), 'EX', DETAIL_TTL_SEC);
    } catch (err) {
        console.warn('[cache] setCachedDetail failed:', err.message);
    }
}

export async function invalidateDetail(id) {
    const r = redis();
    if (!r) return;
    try {
        await r.del(detailKey(id));
    } catch (err) {
        console.warn('[cache] invalidateDetail failed:', err.message);
    }
}

export async function recordRecent(userId, fileId) {
    const r = redis();
    if (!r || !fileId) return;
    const list = recentListKey(userId);
    const meta = recentMetaKey(userId);
    const ts = new Date().toISOString();
    try {
        const pipe = r.pipeline();
        pipe.lrem(list, 0, String(fileId));         // dedupe
        pipe.lpush(list, String(fileId));
        pipe.ltrim(list, 0, RECENTS_CAP - 1);
        pipe.hset(meta, String(fileId), ts);
        await pipe.exec();
        // Prune meta hash entries that fell off the list.
        const keep = new Set(await r.lrange(list, 0, -1));
        const all = await r.hkeys(meta);
        const stale = all.filter((k) => !keep.has(k));
        if (stale.length) await r.hdel(meta, ...stale);
    } catch (err) {
        console.warn('[cache] recordRecent failed:', err.message);
    }
}

export async function listRecents(userId) {
    const r = redis();
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
```

Every function is **fail-open**: cache errors degrade to no-cache behaviour, never to an error response.

### Step 4 — Wire the route handler

**Edit:** `frontend/src/app/api/audio-files/[id]/route.js`

```js
import { NextResponse } from 'next/server';
import { requireUser } from '@/server/route-helpers';
import { getAudioFileDetail } from '@/server/audio-files';
import { getCachedDetail, setCachedDetail, recordRecent } from '@/server/cache';

export const GET = requireUser(async (_request, { params }, { user }) => {
    const { id } = await params;

    let detail = await getCachedDetail(id);
    if (!detail) {
        detail = getAudioFileDetail(id);
        if (detail) await setCachedDetail(id, detail);
    }
    if (!detail) {
        return NextResponse.json({ detail: 'File not found' }, { status: 404 });
    }

    // Fire-and-forget recents update — never blocks the response.
    recordRecent(user?.id, id).catch(() => {});

    return NextResponse.json(detail);
});
```

**Note:** confirm that `requireUser` exposes the `user` object on the third argument; if not, pull it out via the helper's existing pattern.

### Step 5 — Add invalidation hooks

In `frontend/src/server/audio-files.js`:

- **End of `writeEditsForFile()` (around L344)** — `await invalidateDetail(externalId);` (use `external_id`, since that's the cache key the route handler uses).
- **End of `setAudioFileStatus()` (around L380, after the audit write)** — same.
- **Anywhere else that mutates the audio_file row, raw_transcript, or transcript_edit tables** — same.

`invalidateDetail` is fail-open, so this is safe to call before the SQLite tx if it makes the call site cleaner. But by convention call it *after* the write commits.

### Step 6 — Add the recents endpoint

**New file:** `frontend/src/app/api/recents/route.js`

```js
import { NextResponse } from 'next/server';
import { requireUser } from '@/server/route-helpers';
import { listRecents } from '@/server/cache';

export const GET = requireUser(async (_request, _ctx, { user }) => {
    const items = await listRecents(user?.id);
    return NextResponse.json({ items });
});
```

### Step 7 — Hydrate the existing client-side `recents.js`

`src/lib/recents.js` stays as-is (instant reads from `localStorage`). On mount of any page that uses `getAccessMap`, optionally call `/api/recents` and merge — server entries win on tie since they reflect cross-device truth.

Suggested merge function (new export in `recents.js`):

```js
export async function hydrateFromServer(userId) {
    if (typeof window === 'undefined') return;
    try {
        const res = await fetch('/api/recents', { credentials: 'include' });
        if (!res.ok) return;
        const { items } = await res.json();
        const local = getAccessMap(userId);
        for (const { id, accessedAt } of items) {
            if (!local[id] || new Date(accessedAt) > new Date(local[id])) {
                local[id] = accessedAt;
            }
        }
        window.localStorage.setItem(storageKey(userId), JSON.stringify(local));
        window.dispatchEvent(new CustomEvent(RECENTS_EVENT, { detail: { hydrated: true } }));
    } catch {}
}
```

Call this once on dashboard layout mount.

### Step 8 — Env wiring

Add to `frontend/.env.example` (and the matching real `.env`):

```
REDIS_URL=redis://redis:6379
REDIS_PORT=6379
```

Add `REDIS_URL` to the docs in `backend_integration_status.md` §Config / Env Wiring next to the existing entries.

---

## 7. Failure / fallback semantics

- Redis unreachable at request time → `getCachedDetail` returns `null`, route falls through to SQLite. User sees full latency, no error.
- Redis returns malformed JSON → `JSON.parse` throws inside the try/catch → treated as miss.
- `setCachedDetail` fails → response still sent; next request re-attempts.
- `recordRecent` fails → recents list temporarily out-of-date; reconciles on next successful access.

The hard rule: **a Redis outage must never produce a 5xx**. Keep the try/catch wrappers, keep `maxRetriesPerRequest: 1`, keep `enableOfflineQueue: false`.

---

## 8. Testing checklist

1. Start the stack with `docker compose up redis frontend`. Confirm `redis-cli ping` returns `PONG` from inside the network.
2. Open `/files/{some-id}` twice in quick succession. Second request should be visibly faster; `redis-cli MONITOR` should show `GET audio:detail:{id}` succeed on the second hit.
3. Edit a transcript and save. Confirm the cache key is `DEL`'d (`MONITOR` shows the DEL) and the next read repopulates with the new payload.
4. `redis-cli LRANGE user:recent:{yourUserId} 0 -1` after viewing 5 files in order — should return them in reverse-chronological order, deduped, capped at 50.
5. Stop the Redis container and reload `/files/{id}`. Page should still render (at SQLite latency); console should show one `[cache] redis error` warn.
6. Mock mode: set `NEXT_PUBLIC_MOCK_API=true`. The cache module short-circuits via `ENABLED = false`, no Redis traffic.

---

## 9. Open questions / decisions deferred

1. **Cache scoping by user role.** Today `getAudioFileDetail` returns the same shape regardless of caller. If we ever vary the payload by role (e.g. hide `pseudonymisationWarning` from generic users), the key must become `audio:detail:{fileId}:{role}`. Flag this when role-aware response shaping is introduced.
2. **Pseudonymisation span caching.** Out of scope for v1. If `/api/pseudonymisation/{fileId}/spans` becomes a hot path, add `pseudo:spans:{fileId}` with the same patterns.
3. **Cluster deployment.** When this hits Azure, Redis becomes Azure Cache for Redis (Standard tier minimum for HA). Connection string changes to `rediss://` (TLS); `ioredis` handles that with `tls: {}` in the constructor. The module should read `REDIS_TLS=true` and add the option.
4. **Eviction observability.** Consider scraping `INFO stats` (keyspace hits/misses, evicted_keys) into the existing metrics-service pipeline once §1 of `backend_integration_status.md` is wired.

---

## 10. Files that will change / be added

**New:**
- `frontend/src/server/cache.js`
- `frontend/src/app/api/recents/route.js`

**Modified:**
- `compose.yaml` — add `redis` service, wire into frontend.
- `frontend/package.json` — add `ioredis`.
- `frontend/.env.example` — add `REDIS_URL`, `REDIS_PORT`.
- `frontend/src/app/api/audio-files/[id]/route.js` — read-through wrap.
- `frontend/src/server/audio-files.js` — invalidate calls in `writeEditsForFile`, `setAudioFileStatus`.
- `frontend/src/lib/recents.js` — add `hydrateFromServer`.
- `docs/07 Integration CAA 27APR2026/backend_integration_status.md` — add `REDIS_URL` row to env-wiring table.

**Touched but not changed (reference only):**
- `frontend/src/app/(dashboard)/files/[id]/page.jsx` — keeps calling `recordAccess` client-side; no change needed.
