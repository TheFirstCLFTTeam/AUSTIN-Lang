'use client';

import { AVAILABLE_METRICS, DEFAULT_SELECTED_METRIC_IDS, MAX_SELECTED_METRICS } from './mock_data-dashboard';
import { METRICS_METADATA } from './mock_data-metrics-metadata';

const SELECTED_KEY = 'metrics:selectedIds';
const CUSTOM_KEY = 'metrics:custom';
const OVERRIDES_KEY = 'metrics:overrides';

function safeParse(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function readLS(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return safeParse(raw, fallback);
}

function writeLS(key, value) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

const METADATA_BY_ID = new Map(METRICS_METADATA.map((m) => [m.id, m]));

// Control-member edits to built-in metrics are stored as per-id overrides in
// localStorage so the baked-in METRICS_METADATA stays immutable. Currently
// only `target` can be edited manually — `dateRevised` is set automatically
// whenever an override is written.
function getOverrides() {
  return readLS(OVERRIDES_KEY, {});
}

function writeOverrides(next) {
  writeLS(OVERRIDES_KEY, next);
}

// Merge a display-data entry with its metadata entry, then layer any
// localStorage override on top. Custom metrics store the merged shape
// directly and pass through unchanged.
function joinWithMetadata(entry, overrides) {
  if (entry.custom) {
    const ov = overrides[entry.id];
    return ov ? { ...entry, ...ov } : entry;
  }
  const meta = METADATA_BY_ID.get(entry.id);
  if (!meta) return entry;
  const base = { ...meta, ...entry };
  const ov = overrides[entry.id];
  return ov ? { ...base, ...ov } : base;
}

export function getCustomMetrics() {
  return readLS(CUSTOM_KEY, []);
}

export function addCustomMetric(metric) {
  const current = getCustomMetrics();
  const withDate = { ...metric, dateRevised: metric.dateRevised || new Date().toISOString().slice(0, 10) };
  const next = [...current, withDate];
  writeLS(CUSTOM_KEY, next);
  return next;
}

export function getAllMetrics() {
  const overrides = getOverrides();
  const builtIn = AVAILABLE_METRICS.map((e) => joinWithMetadata(e, overrides));
  const custom = getCustomMetrics().map((e) => joinWithMetadata(e, overrides));
  return [...builtIn, ...custom];
}

export function getMetricById(id) {
  return getAllMetrics().find((m) => m.id === id) || null;
}

// Write a control-member edit. `patch` may include `target` (number),
// `name`, `shortDescription`, `description`, `pythonScript` (all strings).
// `dateRevised` is stamped automatically.
export function updateMetricMetadata(id, patch) {
  const today = new Date().toISOString().slice(0, 10);
  const sanitized = { dateRevised: today };
  if (patch.target !== undefined && patch.target !== null && !Number.isNaN(patch.target)) {
    sanitized.target = patch.target;
  }
  if (typeof patch.name === 'string' && patch.name.trim()) {
    sanitized.name = patch.name.trim();
  }
  if (typeof patch.shortDescription === 'string') {
    sanitized.shortDescription = patch.shortDescription.trim();
  }
  if (typeof patch.description === 'string') {
    sanitized.description = patch.description.trim();
  }
  if (typeof patch.pythonScript === 'string') {
    sanitized.pythonScript = patch.pythonScript;
  }

  // Custom metrics live in the custom list; patch in place so the source of
  // truth for user-added metrics stays in one spot.
  const custom = getCustomMetrics();
  const customIdx = custom.findIndex((m) => m.id === id);
  if (customIdx !== -1) {
    const next = [...custom];
    next[customIdx] = { ...next[customIdx], ...sanitized };
    writeLS(CUSTOM_KEY, next);
    return next[customIdx];
  }

  const overrides = getOverrides();
  overrides[id] = { ...(overrides[id] || {}), ...sanitized };
  writeOverrides(overrides);
  return getMetricById(id);
}

export function getSelectedMetricIds() {
  const stored = readLS(SELECTED_KEY, null);
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_SELECTED_METRIC_IDS;
  return stored.slice(0, MAX_SELECTED_METRICS);
}

export function setSelectedMetricIds(ids) {
  const trimmed = ids.slice(0, MAX_SELECTED_METRICS);
  writeLS(SELECTED_KEY, trimmed);
  return trimmed;
}

export function getSelectedMetrics() {
  const all = getAllMetrics();
  const byId = new Map(all.map((m) => [m.id, m]));
  return getSelectedMetricIds()
    .map((id) => byId.get(id))
    .filter(Boolean);
}

// Extract the first triple-quoted docstring from Python source. Handles both
// """ and ''' styles. Returns the trimmed content, or an empty string if
// nothing looks like a docstring in the leading portion of the file.
export function extractPythonDocstring(source) {
  if (!source) return '';
  const match = source.match(/(?:"""|''')([\s\S]*?)(?:"""|''')/);
  if (!match) return '';
  return match[1].trim();
}

// Turn a filename like `edit_density_v2.py` into `Edit Density V2`.
export function inferMetricNameFromFilename(filename) {
  const base = filename.replace(/\.py$/i, '').replace(/[-_]+/g, ' ').trim();
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}
