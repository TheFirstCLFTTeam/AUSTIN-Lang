import 'server-only';

// Server-side cache for the financial-terms dictionary snapshot.
//
// Used by the auto-trail hook in audio-files.js to look up edit `before`
// text against the approved-terms list without hitting the dictionary
// service on every save. 5-minute TTL — the dictionary doesn't churn
// often, and a fresh edit-tag arriving 5 minutes late is fine.
//
// Fail-quiet: when the dictionary service is unreachable, return the
// last-good cache (or null on cold start). Never raise — auto-trail is
// a "nice-to-have" instrumentation, not a blocker on transcript saves.

const SVC_URL =
    process.env.FINANCIAL_TERMS_URL || 'http://financial-terms-dictionary:8009';

const TTL_MS = 5 * 60 * 1000;

let _cache = {
    fetchedAt: 0,
    snapshot: null,        // { version, term_count, terms: [...] }
    termsByNorm: new Map(), // term_normalized → term row, for O(1) lookup
};


function buildLookup(snapshot) {
    const map = new Map();
    if (!snapshot || !Array.isArray(snapshot.terms)) return map;
    for (const t of snapshot.terms) {
        if (t.term_normalized) map.set(t.term_normalized, t);
    }
    return map;
}


async function fetchFresh() {
    const res = await fetch(`${SVC_URL}/dictionary/snapshot`, {
        headers: {
            Accept: 'application/json',
            // Service-internal call. The microservice still wants
            // X-User-Id; supply a synthetic id since this is a server-
            // initiated call, not a user-initiated one.
            'X-User-Id': 'system:auto-trail',
            'X-User-Role': 'system',
        },
    });
    if (!res.ok) {
        throw new Error(`dictionary snapshot ${res.status}`);
    }
    return res.json();
}


// Returns { snapshot, termsByNorm } — both kept in sync. termsByNorm is
// keyed by `casefold(strip(term))` matching the microservice's
// term_normalized column, so callers can do `lookup(text.toLowerCase().trim())`.
//
// Returns { snapshot: null, termsByNorm: empty } when the cache is cold
// AND the upstream is unreachable — the caller treats that as "no
// dictionary, skip auto-trail."
export async function getCachedSnapshot() {
    const now = Date.now();
    if (_cache.snapshot && (now - _cache.fetchedAt) < TTL_MS) {
        return { snapshot: _cache.snapshot, termsByNorm: _cache.termsByNorm };
    }
    try {
        const fresh = await fetchFresh();
        _cache = {
            fetchedAt: now,
            snapshot: fresh,
            termsByNorm: buildLookup(fresh),
        };
    } catch (err) {
        // Serve stale on error if we have anything; otherwise empty.
        if (process.env.NODE_ENV !== 'test') {
            console.warn('[financial-terms-cache] snapshot refresh failed:', err.message);
        }
    }
    return { snapshot: _cache.snapshot, termsByNorm: _cache.termsByNorm };
}


// Test hook — clears the cache so tests can simulate cold start.
export function _resetForTests() {
    _cache = { fetchedAt: 0, snapshot: null, termsByNorm: new Map() };
}


// Look up a candidate token against the cached approved list. Returns
// the matching term row or null. Casefold + strip on the way in to match
// the microservice's normalisation rule.
export function lookupTerm(termsByNorm, text) {
    if (!termsByNorm || !text) return null;
    const key = String(text).trim().toLowerCase();
    if (!key) return null;
    return termsByNorm.get(key) || null;
}
