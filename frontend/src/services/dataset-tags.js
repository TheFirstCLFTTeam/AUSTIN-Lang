// Fuzzy-search helpers for dataset label selection.
// The tag catalogue itself lives in mock_data-dataset.js so it sits with the
// rest of the dataset mock data. This module is behaviour-only.

import { DATASET_TAG_CATALOGUE } from './mock_data-dataset';

export { DATASET_TAG_CATALOGUE };

// Cheap fuzzy match: prefix > substring > subsequence. Returns null if the
// query can't be embedded in the candidate at all, otherwise a positive
// number where higher = better match.
export function fuzzyScore(query, candidate) {
    if (!query) return 1; // everything matches an empty query equally
    const q = query.toLowerCase();
    const c = candidate.toLowerCase();
    if (c === q) return 1000;
    if (c.startsWith(q)) return 500 - (c.length - q.length);
    const idx = c.indexOf(q);
    if (idx !== -1) return 200 - idx - (c.length - q.length);

    // Subsequence — every query char appears in order.
    let ci = 0;
    let hits = 0;
    for (const ch of q) {
        while (ci < c.length && c[ci] !== ch) ci++;
        if (ci >= c.length) return null;
        ci++;
        hits++;
    }
    return hits >= q.length ? 50 - (c.length - q.length) : null;
}

// Returns filtered + ranked catalogue entries for a given query, skipping
// anything already selected by the user.
export function searchTags(query, selected = []) {
    const seen = new Set(selected.map((s) => s.toLowerCase()));
    const scored = [];
    for (const entry of DATASET_TAG_CATALOGUE) {
        if (seen.has(entry.value.toLowerCase())) continue;
        const s = fuzzyScore(query, entry.value);
        if (s != null) scored.push({ ...entry, score: s });
    }
    scored.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value));
    return scored;
}

// Engineers can type anything, not just catalogue entries. Normalise the
// free-form input into a canonical tag string.
export function normaliseTag(raw) {
    return raw
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-]/g, '');
}
