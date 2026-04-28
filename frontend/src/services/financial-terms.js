// Client for the financial-terms-dictionary microservice. All calls go
// through same-origin /api/financial-terms/* proxy routes — never directly
// to the service — so cookie-session auth + the F8 CSRF token apply
// uniformly.
//
// Mock-mode: when NEXT_PUBLIC_MOCK_API=true, all writes no-op gracefully
// and reads return small fixture payloads. The real admin page renders
// against the fixtures so dev mode shows something useful.

import { http, readCsrfToken } from './http';

// Read at use-time, not module-load: lets vitest swap the env without
// having to reset modules between tests.
function isMockMode() {
    return process.env.NEXT_PUBLIC_MOCK_API === 'true';
}

// ── Tiny mock fixture so dev mode renders the admin page populated ────

const MOCK_TERMS = [
    {
        id: 1, term: 'EBITDA', term_normalized: 'ebitda', category: 'ratio',
        definition: 'https://www.investopedia.com/terms/e/ebitda.asp',
        status: 'approved', submitted_by: 'system', submitted_at: '2026-04-20T09:00:00Z',
        approved_by: 'admin', approved_at: '2026-04-20T09:00:01Z',
        source_file_id: null, notes: 'seed CSV (clean)',
    },
    {
        id: 2, term: 'Q1', term_normalized: 'q1', category: null, definition: null,
        status: 'approved', submitted_by: 'system', submitted_at: '2026-04-20T09:00:00Z',
        approved_by: 'admin', approved_at: '2026-04-20T09:00:02Z',
        source_file_id: null, notes: 'seed CSV (clean)',
    },
    {
        id: 3, term: 'Hedge Fund', term_normalized: 'hedge fund', category: 'instrument',
        definition: null,
        status: 'pending', submitted_by: 'u-larry', submitted_at: '2026-04-25T10:00:00Z',
        approved_by: null, approved_at: null,
        source_file_id: 'ext-1', notes: 'submitted via transcript editor',
    },
    {
        id: 4, term: '10-K Wrap: What It Is, How It Works, Elements',
        term_normalized: '10-k wrap: what it is, how it works, elements',
        category: null, definition: null,
        status: 'pending', submitted_by: 'system', submitted_at: '2026-04-20T09:00:00Z',
        approved_by: null, approved_at: null,
        source_file_id: null, notes: "seed CSV (telltale phrase: 'how it works')",
    },
];
const MOCK_STATS_TOP_WRONG = [
    { id: 1, term: 'EBITDA',     category: 'ratio',      status: 'approved', occurrences: 14, wrong_count: 9, right_count: 5 },
    { id: 2, term: 'Q1',         category: null,         status: 'approved', occurrences: 22, wrong_count: 4, right_count: 18 },
    { id: 6, term: 'Amortisation', category: null,        status: 'approved', occurrences: 7,  wrong_count: 4, right_count: 3 },
];

// ── Real-mode helpers ────────────────────────────────────────────────────

export async function fetchTerms({ status, category, q, limit = 100, offset = 0 } = {}) {
    if (isMockMode()) {
        await new Promise((r) => setTimeout(r, 80));
        let rows = [...MOCK_TERMS];
        if (status) rows = rows.filter((t) => t.status === status);
        if (category) rows = rows.filter((t) => t.category === category);
        if (q) {
            const ql = q.toLowerCase();
            rows = rows.filter((t) => t.term_normalized.includes(ql));
        }
        return rows.slice(offset, offset + limit);
    }
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return http.get(`/api/financial-terms?${params.toString()}`);
}

export async function fetchTerm(id) {
    if (isMockMode()) return MOCK_TERMS.find((t) => t.id === Number(id)) || null;
    return http.get(`/api/financial-terms/${encodeURIComponent(id)}`);
}

export async function submitTerm({ term, category, definition, source_file_id, notes }) {
    if (isMockMode()) {
        const id = MOCK_TERMS.reduce((m, t) => Math.max(m, t.id), 0) + 1;
        const row = {
            id, term, term_normalized: term.toLowerCase().trim(),
            category: category || null, definition: definition || null,
            status: 'pending', submitted_by: 'mock-user',
            submitted_at: new Date().toISOString(),
            approved_by: null, approved_at: null,
            source_file_id: source_file_id || null,
            notes: notes || null,
        };
        MOCK_TERMS.push(row);
        return row;
    }
    return http.post('/api/financial-terms', { term, category, definition, source_file_id, notes });
}

export async function moderateTerm(id, { status, category, definition, notes } = {}) {
    if (isMockMode()) {
        const row = MOCK_TERMS.find((t) => t.id === Number(id));
        if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
        if (status) row.status = status;
        if (status === 'approved' && !row.approved_at) {
            row.approved_at = new Date().toISOString();
            row.approved_by = 'mock-admin';
        }
        if (category !== undefined) row.category = category;
        if (definition !== undefined) row.definition = definition;
        if (notes !== undefined) row.notes = notes;
        return row;
    }
    return http.put(
        `/api/financial-terms/${encodeURIComponent(id)}`,
        { status, category, definition, notes },
    ).catch(async (err) => {
        // PATCH isn't on the http helper; fall through to fetch.
        if (err && err.code !== 'METHOD_NOT_SUPPORTED') throw err;
        return null;
    }) ?? _patch(`/api/financial-terms/${encodeURIComponent(id)}`, { status, category, definition, notes });
}

// http helper exposes get/post/put/del but not patch, so do it directly.
async function _patch(path, body) {
    const csrf = readCsrfToken();
    const res = await fetch(path, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
        const err = new Error((data && data.detail) || `HTTP ${res.status}`);
        err.status = res.status;
        err.body = data;
        throw err;
    }
    return data;
}

function safeJson(text) {
    try { return JSON.parse(text); } catch { return text; }
}

// Re-export the patch helper directly for the moderation flow — the
// http wrapper above tries put first which always 405s; cleaner to
// just go through the dedicated path.
export async function moderateTermPatch(id, body) {
    if (isMockMode()) return moderateTerm(id, body);
    return _patch(`/api/financial-terms/${encodeURIComponent(id)}`, body);
}

export async function fetchStats({ kind = 'top_wrong', limit = 50, since } = {}) {
    if (isMockMode()) {
        await new Promise((r) => setTimeout(r, 80));
        return {
            kind, limit, since: since || null,
            rows: kind === 'top_wrong'
                ? MOCK_STATS_TOP_WRONG.slice(0, limit)
                : MOCK_STATS_TOP_WRONG.map((r) => ({ ...r, wrong_count: undefined, right_count: undefined })),
        };
    }
    const params = new URLSearchParams();
    params.set('kind', kind);
    params.set('limit', String(limit));
    if (since) params.set('since', since);
    return http.get(`/api/financial-terms/occurrences/stats?${params.toString()}`);
}

export async function recordOccurrence({ term_id, audio_file_external_id, correctly_transcribed }) {
    if (isMockMode()) {
        return {
            id: Math.floor(Math.random() * 100000),
            term_id, audio_file_external_id,
            correctly_transcribed: correctly_transcribed ? 1 : 0,
            appeared_at: new Date().toISOString(),
        };
    }
    return http.post('/api/financial-terms/occurrences', {
        term_id, audio_file_external_id, correctly_transcribed,
    });
}

export async function fetchSnapshot() {
    if (isMockMode()) {
        const approved = MOCK_TERMS.filter((t) => t.status === 'approved');
        return {
            version: approved.reduce((m, t) => (t.approved_at && (!m || t.approved_at > m)) ? t.approved_at : m, null),
            term_count: approved.length,
            terms: approved.map(({ id, term, term_normalized, category, definition }) => ({
                id, term, term_normalized, category, definition,
            })),
        };
    }
    return http.get('/api/financial-terms/snapshot');
}

export async function runBulkImport({ csv_path } = {}) {
    if (isMockMode()) {
        return {
            csv_path: csv_path || '/app/financialTerms.csv',
            counts: { rows_total: 6318, imported_clean: 6013, imported_pending: 303,
                      skipped_duplicate: 2, skipped_empty: 0 },
        };
    }
    return http.post('/api/financial-terms/bulk-import', { csv_path });
}

// ── Snapshot caching for the auto-trail hook (slice 5) ──────────────────

let _snapshotCache = { value: null, fetchedAt: 0 };
const SNAPSHOT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getCachedSnapshot() {
    const now = Date.now();
    if (_snapshotCache.value && (now - _snapshotCache.fetchedAt) < SNAPSHOT_TTL_MS) {
        return _snapshotCache.value;
    }
    try {
        const fresh = await fetchSnapshot();
        _snapshotCache = { value: fresh, fetchedAt: now };
        return fresh;
    } catch {
        return _snapshotCache.value; // serve stale on error
    }
}

export function _resetSnapshotCacheForTests() {
    _snapshotCache = { value: null, fetchedAt: 0 };
}
