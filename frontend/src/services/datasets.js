// Persistent dataset store.
// Datasets are collections of file IDs created by engineers.
// Persisted via localStorage so they survive page reloads.

import { setHoldoutForDataset } from './holdouts';

const STORAGE_KEY = 'austin.datasets';

let _datasets = loadFromStorage();
const _listeners = new Set();

function loadFromStorage() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_datasets));
    _listeners.forEach((fn) => fn([..._datasets]));
}

export function getDatasets() {
    return [..._datasets];
}

export function getDatasetById(id) {
    return _datasets.find((d) => d.id === id) || null;
}

export function createDataset({ name, description, fileIds, tags, createdBy }) {
    const dataset = {
        id: `dataset-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        name,
        description: description || '',
        fileIds: [...fileIds],
        tags: Array.isArray(tags) ? [...tags] : [],
        createdBy,
        createdAt: new Date().toISOString(),
    };
    _datasets.push(dataset);
    persist();
    return dataset;
}

export function deleteDataset(id) {
    _datasets = _datasets.filter((d) => d.id !== id);
    persist();
}

// Deprecated alias kept for any caller that still passes through this module.
// New code should call setHoldoutForDataset() directly. The clamp to
// dataset.fileIds is preserved so stale ids don't leak through; the
// authoritative storage now lives in the holdouts service.
export function updateDatasetUnseen(id, unseenFileIds) {
    const ds = _datasets.find((d) => d.id === id);
    if (!ds) return null;
    const allowed = new Set(ds.fileIds || []);
    const clean = [...new Set(unseenFileIds)].filter((fid) => allowed.has(fid));
    setHoldoutForDataset(id, clean);
    ds.unseenFileIds = clean;
    persist();
    return ds;
}

export function subscribeDatasets(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}
