// Server-side cache + auto-trail hook tests. Mocks fetch globally so the
// cache + writeEditsForFile flow can be exercised without a live
// dictionary microservice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    _resetForTests,
    getCachedSnapshot,
    lookupTerm,
} from '../server/financial-terms-cache';


function snapshotResponse(terms) {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            version: '2026-04-28T10:00:00Z',
            term_count: terms.length,
            terms,
        }),
    };
}

beforeEach(() => {
    _resetForTests();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});


describe('financial-terms-cache', () => {
    it('first call fetches from upstream + populates the lookup', async () => {
        const fetchSpy = vi.fn(async () => snapshotResponse([
            { id: 1, term: 'EBITDA', term_normalized: 'ebitda', category: 'ratio', definition: null },
            { id: 2, term: 'Q1', term_normalized: 'q1', category: null, definition: null },
        ]));
        vi.stubGlobal('fetch', fetchSpy);

        const { snapshot, termsByNorm } = await getCachedSnapshot();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(snapshot.term_count).toBe(2);
        expect(termsByNorm.get('ebitda')?.id).toBe(1);
        expect(termsByNorm.get('q1')?.id).toBe(2);
    });

    it('second call within TTL serves from cache (no network)', async () => {
        const fetchSpy = vi.fn(async () => snapshotResponse([
            { id: 1, term: 'EBITDA', term_normalized: 'ebitda', category: null, definition: null },
        ]));
        vi.stubGlobal('fetch', fetchSpy);

        await getCachedSnapshot();
        await getCachedSnapshot();
        await getCachedSnapshot();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('after TTL expires, refetches', async () => {
        const fetchSpy = vi.fn(async () => snapshotResponse([
            { id: 1, term: 'EBITDA', term_normalized: 'ebitda', category: null, definition: null },
        ]));
        vi.stubGlobal('fetch', fetchSpy);

        await getCachedSnapshot();
        // Advance past the 5-min TTL.
        vi.advanceTimersByTime(6 * 60 * 1000);
        await getCachedSnapshot();
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('upstream failure on cold cache returns empty lookup, no throw', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('econnrefused'); }));

        const { snapshot, termsByNorm } = await getCachedSnapshot();
        expect(snapshot).toBeNull();
        expect(termsByNorm.size).toBe(0);
    });

    it('upstream failure with warm cache serves stale', async () => {
        let calls = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            calls += 1;
            if (calls === 1) {
                return snapshotResponse([
                    { id: 7, term: 'Greenshoe', term_normalized: 'greenshoe', category: null, definition: null },
                ]);
            }
            throw new Error('boom');
        }));

        await getCachedSnapshot();
        vi.advanceTimersByTime(6 * 60 * 1000);
        const { snapshot, termsByNorm } = await getCachedSnapshot();
        // Stale served — Greenshoe still present, no throw.
        expect(snapshot.term_count).toBe(1);
        expect(termsByNorm.get('greenshoe')?.id).toBe(7);
    });

    it('non-OK response (e.g. 500) treated as failure', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
        const { snapshot } = await getCachedSnapshot();
        expect(snapshot).toBeNull();
    });
});


describe('lookupTerm', () => {
    const map = new Map([
        ['ebitda', { id: 1, term: 'EBITDA', term_normalized: 'ebitda' }],
        ['hedge fund', { id: 2, term: 'Hedge Fund', term_normalized: 'hedge fund' }],
    ]);

    it('matches case-insensitively', () => {
        expect(lookupTerm(map, 'EBITDA')?.id).toBe(1);
        expect(lookupTerm(map, 'ebitda')?.id).toBe(1);
        expect(lookupTerm(map, 'Ebitda')?.id).toBe(1);
    });

    it('strips whitespace', () => {
        expect(lookupTerm(map, '  EBITDA  ')?.id).toBe(1);
    });

    it('matches multi-word terms', () => {
        expect(lookupTerm(map, 'Hedge Fund')?.id).toBe(2);
    });

    it('returns null for non-matches', () => {
        expect(lookupTerm(map, 'random word')).toBeNull();
    });

    it('null-safe inputs', () => {
        expect(lookupTerm(map, null)).toBeNull();
        expect(lookupTerm(null, 'EBITDA')).toBeNull();
        expect(lookupTerm(map, '')).toBeNull();
        expect(lookupTerm(map, '   ')).toBeNull();
    });
});
