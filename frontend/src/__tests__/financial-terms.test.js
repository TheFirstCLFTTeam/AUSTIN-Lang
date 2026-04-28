// Service-layer tests for the financial-terms client. Mock-mode is the
// supported path here — real-mode goes through the FE proxy + the
// microservice (already covered by 47 stdlib unittest cases on the BE).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    fetchTerms,
    fetchTerm,
    submitTerm,
    moderateTerm,
    fetchStats,
    fetchSnapshot,
    recordOccurrence,
    runBulkImport,
    getCachedSnapshot,
    _resetSnapshotCacheForTests,
} from '../services/financial-terms';


// All these tests run in mock mode — the service layer's mock-mode
// branches are what dev-mode renders against.
beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MOCK_API', 'true');
    _resetSnapshotCacheForTests();
});

afterEach(() => {
    vi.unstubAllEnvs();
});


describe('financial-terms service (mock mode)', () => {
    it('fetchTerms returns approved terms by default filter', async () => {
        const rows = await fetchTerms({ status: 'approved' });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((t) => t.status === 'approved')).toBe(true);
    });

    it('fetchTerms filters by status=pending', async () => {
        const rows = await fetchTerms({ status: 'pending' });
        expect(rows.every((t) => t.status === 'pending')).toBe(true);
    });

    it('fetchTerms search query matches term_normalized', async () => {
        const rows = await fetchTerms({ q: 'EBITDA' });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].term_normalized).toContain('ebitda');
    });

    it('fetchTerm returns the matching row by id', async () => {
        const row = await fetchTerm(1);
        expect(row).not.toBeNull();
        expect(row.id).toBe(1);
    });

    it('submitTerm appends a new pending row', async () => {
        const before = await fetchTerms({ status: 'pending' });
        const fresh = await submitTerm({
            term: 'Greenshoe Option',
            category: 'instrument',
            source_file_id: 'ext-42',
        });
        expect(fresh.status).toBe('pending');
        expect(fresh.term).toBe('Greenshoe Option');
        const after = await fetchTerms({ status: 'pending' });
        expect(after.length).toBe(before.length + 1);
    });

    it('moderateTerm flips status and stamps approver on first approval', async () => {
        // Find a pending row.
        const pending = await fetchTerms({ status: 'pending' });
        const id = pending[0].id;
        const row = await moderateTerm(id, { status: 'approved' });
        expect(row.status).toBe('approved');
        expect(row.approved_at).not.toBeNull();
        expect(row.approved_by).toBeTruthy();
    });

    it('recordOccurrence returns a record with the right correctness flag', async () => {
        const occ = await recordOccurrence({
            term_id: 1,
            audio_file_external_id: 'ext-1',
            correctly_transcribed: false,
        });
        expect(occ.correctly_transcribed).toBe(0);
        expect(occ.term_id).toBe(1);
    });

    it('fetchStats top_wrong returns rows ranked by wrong_count', async () => {
        const result = await fetchStats({ kind: 'top_wrong', limit: 10 });
        expect(result.kind).toBe('top_wrong');
        expect(Array.isArray(result.rows)).toBe(true);
        // Verify monotonic non-increasing wrong_count (the mock fixture is
        // already in that order; the assertion locks the contract in).
        for (let i = 1; i < result.rows.length; i++) {
            expect(result.rows[i - 1].wrong_count).toBeGreaterThanOrEqual(result.rows[i].wrong_count);
        }
    });

    it('fetchSnapshot returns version + terms', async () => {
        const snap = await fetchSnapshot();
        expect(snap.term_count).toBeGreaterThan(0);
        expect(snap.terms.every((t) => typeof t.term === 'string')).toBe(true);
    });

    it('getCachedSnapshot serves from cache on second call', async () => {
        const first = await getCachedSnapshot();
        const second = await getCachedSnapshot();
        // Same object identity proves it came from cache (mock-mode
        // returns a fresh object each call when the cache is bypassed).
        expect(second).toBe(first);
    });

    it('runBulkImport reports counts shape', async () => {
        const result = await runBulkImport();
        expect(result.counts).toMatchObject({
            rows_total: expect.any(Number),
            imported_clean: expect.any(Number),
            imported_pending: expect.any(Number),
            skipped_duplicate: expect.any(Number),
        });
    });
});
