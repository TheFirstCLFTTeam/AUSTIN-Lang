// Client for the metrics endpoints. Every call goes through a same-origin
// /api/metrics/* proxy route — never directly to the metrics service — so
// the cookie session and CSRF/Origin guarantees apply uniformly. Response
// shapes mirror backend/metrics_service/main.py exactly; transformation
// into page-specific shapes happens at the call site.
//
// See docs/06 server/metrics-service-module.md §6 for the upstream API.

import { readCsrfToken } from './http';

const REQUEST_TIMEOUT_MS = 15000;
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const headers = body
        ? { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        : { 'Accept': 'application/json' };
    if (STATE_CHANGING.has(method)) {
        const csrf = readCsrfToken();
        if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    let res;
    try {
        res = await fetch(path, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
            credentials: 'same-origin',
        });
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`metrics request failed: HTTP ${res.status} ${text}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

// GET /metrics/dashboard → {
//   average_wer: number|null,
//   latest_wer: number|null,
//   average_queue_latency: number|null,    // seconds
//   average_transcription_time: number|null, // seconds
//   total_files: number,
//   files_with_edits: number,
//   needs_attention: boolean,
// }
export function fetchDashboardMetrics() {
    return request('/api/metrics');
}

// GET /api/audio-files/:id/accuracy → either
//   { file_id, wer: null, status: 'pending_edit', message } when not yet edited, or
//   { file_id, wer: number, raw_text_preview, edited_text_preview }
export function fetchFileAccuracy(fileId) {
    return request(`/api/audio-files/${encodeURIComponent(fileId)}/accuracy`);
}

// POST /api/metrics/refresh → { message }. Busts the metrics service's
// 60s in-memory cache. Used after an edit/approve to keep the dashboard
// honest without waiting for the TTL.
export function refreshMetricsCache() {
    return request('/api/metrics/refresh', { method: 'POST' });
}

// GET /metrics/by-dataset → {
//   base_model, dataset_name,
//   metrics: [{
//     strategy_name,
//     base_value, base_evaluated_at,
//     finetuned_value, finetuned_evaluated_at,
//     finetuned_adapter_name, finetuned_adapter_version,
//     delta,
//     base_series: [{evaluated_at, value}, ...],     // empty unless seriesPoints > 0
//     finetuned_series: [{evaluated_at, value}, ...], // chronological, oldest first
//   }],
// }
//
// `strategies` is optional; omit it to receive every strategy recorded
// in the DB for the (base_model, dataset) pair (so seeded metrics that
// don't yet have a runnable MetricStrategy still surface).
//
// `seriesPoints` (default 0): when > 0, each metric also includes the N
// most recent (evaluated_at, value) points per role for chart rendering.
export function fetchMetricsByDataset({ dataset, baseModel, strategies, seriesPoints } = {}) {
    if (!dataset || !baseModel) {
        return Promise.reject(new Error('fetchMetricsByDataset: dataset and baseModel are required'));
    }
    const params = new URLSearchParams({ dataset, base_model: baseModel });
    if (strategies?.length) {
        params.set('strategies', strategies.join(','));
    }
    if (Number.isFinite(seriesPoints) && seriesPoints > 0) {
        params.set('series_points', String(Math.floor(seriesPoints)));
    }
    return request(`/api/metrics/by-dataset?${params.toString()}`);
}
