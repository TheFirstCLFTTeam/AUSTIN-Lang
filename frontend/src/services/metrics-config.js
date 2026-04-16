'use client';

import { AVAILABLE_METRICS, DEFAULT_SELECTED_METRIC_IDS, MAX_SELECTED_METRICS } from './mock_data-dashboard';
import { METRICS_METADATA } from './mock_data-metrics-metadata';

const SELECTED_KEY = 'metrics:selectedIds';
const CUSTOM_KEY = 'metrics:custom';

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

// Merge a display-data entry with its metadata entry. `name` comes from
// metadata; `value`/`sublabel`/`series` come from display. Custom metrics
// store the merged shape directly and pass through unchanged.
function joinWithMetadata(entry) {
  if (entry.custom) return entry;
  const meta = METADATA_BY_ID.get(entry.id);
  if (!meta) return entry;
  return { ...meta, ...entry };
}

export function getCustomMetrics() {
  return readLS(CUSTOM_KEY, []);
}

export function addCustomMetric(metric) {
  const current = getCustomMetrics();
  const next = [...current, metric];
  writeLS(CUSTOM_KEY, next);
  return next;
}

export function getAllMetrics() {
  const builtIn = AVAILABLE_METRICS.map(joinWithMetadata);
  return [...builtIn, ...getCustomMetrics()];
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
