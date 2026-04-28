// Per-user last-access tracking for transcript files, stored in localStorage.
// Keyed by userId so different users on the same browser don't collide.

const MAX_ENTRIES = 100;
const STORAGE_PREFIX = "austin.recents.";
export const RECENTS_EVENT = "austin.recents:change";

function storageKey(userId) {
    return `${STORAGE_PREFIX}${userId || "anon"}`;
}

export function getAccessMap(userId) {
    if (typeof window === "undefined") return {};
    try {
        return JSON.parse(window.localStorage.getItem(storageKey(userId)) || "{}");
    } catch {
        return {};
    }
}

export function recordAccess(userId, fileId) {
    if (typeof window === "undefined" || !fileId) return;
    const key = storageKey(userId);
    let map;
    try {
        map = JSON.parse(window.localStorage.getItem(key) || "{}");
    } catch {
        map = {};
    }
    map[fileId] = new Date().toISOString();

    // Cap size: keep the most-recent MAX_ENTRIES.
    const entries = Object.entries(map);
    if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => new Date(b[1]) - new Date(a[1]));
        map = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    }
    try {
        window.localStorage.setItem(key, JSON.stringify(map));
        window.dispatchEvent(new CustomEvent(RECENTS_EVENT, { detail: { fileId } }));
    } catch {}
}

export function clearAccess(userId, fileId) {
    if (typeof window === "undefined") return;
    const key = storageKey(userId);
    try {
        const map = JSON.parse(window.localStorage.getItem(key) || "{}");
        delete map[fileId];
        window.localStorage.setItem(key, JSON.stringify(map));
        window.dispatchEvent(new CustomEvent(RECENTS_EVENT, { detail: { fileId } }));
    } catch {}
}

// Pull the server-side recents list (Redis-backed) and merge it into the
// per-user localStorage map. Server entries win on tie — they reflect
// cross-device truth. Fail-quiet: a fetch error or a Redis-down server
// just leaves the local map untouched.
//
// Suggested call site: dashboard layout mount (so it runs once per app load
// and lets every page that reads getAccessMap pick up the merged state).
export async function hydrateFromServer(userId) {
    if (typeof window === "undefined") return;
    try {
        const res = await fetch("/api/recents", { credentials: "include" });
        if (!res.ok) return;
        const { items } = await res.json();
        if (!Array.isArray(items) || items.length === 0) return;

        const key = storageKey(userId);
        let local;
        try {
            local = JSON.parse(window.localStorage.getItem(key) || "{}");
        } catch {
            local = {};
        }
        let changed = false;
        for (const { id, accessedAt } of items) {
            if (!id || !accessedAt) continue;
            if (!local[id] || new Date(accessedAt) > new Date(local[id])) {
                local[id] = accessedAt;
                changed = true;
            }
        }
        if (!changed) return;
        window.localStorage.setItem(key, JSON.stringify(local));
        window.dispatchEvent(new CustomEvent(RECENTS_EVENT, { detail: { hydrated: true } }));
    } catch {
        /* silent */
    }
}

// Group a list of { id, accessedAt } into Today / Yesterday / This week /
// month/year buckets, preserving within-bucket order.
export function groupByDateBucket(items, now = new Date()) {
    const startOfDay = (d) => {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        return x;
    };
    const today = startOfDay(now);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6); // last 7 days inclusive of today

    const buckets = new Map();
    const pushTo = (label, item) => {
        if (!buckets.has(label)) buckets.set(label, []);
        buckets.get(label).push(item);
    };

    for (const item of items) {
        const d = new Date(item.accessedAt);
        if (Number.isNaN(d.getTime())) {
            pushTo("Earlier", item);
            continue;
        }
        const ds = startOfDay(d);
        if (ds.getTime() === today.getTime()) {
            pushTo("Today", item);
        } else if (ds.getTime() === yesterday.getTime()) {
            pushTo("Yesterday", item);
        } else if (ds >= weekAgo) {
            pushTo("Earlier this week", item);
        } else if (d.getFullYear() === now.getFullYear()) {
            const label = d.toLocaleDateString("en-GB", { month: "long" });
            pushTo(label, item);
        } else {
            pushTo(String(d.getFullYear()), item);
        }
    }
    return [...buckets.entries()].map(([label, entries]) => ({ label, entries }));
}
