// Per-dataset holdout selection. A "holdout" is the set of recordings the
// benching pipeline scores new model submissions against. One shared holdout
// per dataset (last edit wins; provenance lives in the audit trail).
//
// Persisted to localStorage today; the schema/API counterpart lives in
// platform.db.holdout_membership and will replace this when the backend
// lands. The localStorage shape is { [datasetId]: [audioFileExternalId, ...] }.

import { HOLDOUT_MEMBERSHIP_SEED } from './mock_data-holdouts';

const STORAGE_KEY = 'austin.holdouts.v1';

const _listeners = new Set();
let _byDataset = loadFromStorage();

function loadFromStorage() {
    try {
        if (typeof localStorage === 'undefined') return seed();
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return seed();
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return seed();
        return parsed;
    } catch {
        return seed();
    }
}

function seed() {
    const next = {};
    for (const row of HOLDOUT_MEMBERSHIP_SEED) {
        if (!next[row.datasetId]) next[row.datasetId] = [];
        next[row.datasetId].push(row.audioFileExternalId);
    }
    return next;
}

function persist() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_byDataset));
        }
    } catch {}
    const snapshot = snapshotState();
    _listeners.forEach((fn) => fn(snapshot));
}

function snapshotState() {
    const out = {};
    for (const [k, arr] of Object.entries(_byDataset)) out[k] = [...arr];
    return out;
}

export function getHoldoutForDataset(datasetId) {
    return new Set(_byDataset[datasetId] || []);
}

export function getHoldoutCountForDataset(datasetId) {
    return (_byDataset[datasetId] || []).length;
}

export function isInHoldout(datasetId, fileId) {
    const arr = _byDataset[datasetId];
    return Array.isArray(arr) && arr.includes(fileId);
}

// Replace the entire holdout set for a dataset. `fileIds` may be any iterable.
// `actorId` is captured for the audit trail (no-op when an audit hook is not
// wired; the static seed already populates audit_event rows for the initial
// selection).
export function setHoldoutForDataset(datasetId, fileIds, /* actorId */) {
    const clean = [...new Set(fileIds)].filter(Boolean);
    _byDataset = { ..._byDataset, [datasetId]: clean };
    persist();
    return clean;
}

export function toggleHoldoutMember(datasetId, fileId, actorId) {
    const current = new Set(_byDataset[datasetId] || []);
    if (current.has(fileId)) current.delete(fileId);
    else current.add(fileId);
    return setHoldoutForDataset(datasetId, [...current], actorId);
}

export function clearHoldoutForDataset(datasetId, actorId) {
    return setHoldoutForDataset(datasetId, [], actorId);
}

export function subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

// Test / demo reset — drops localStorage state and re-seeds from the mock.
export function resetHoldouts() {
    _byDataset = seed();
    persist();
}
