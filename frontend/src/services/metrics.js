// Client for the metrics FastAPI service (backend/metrics_service, :8006).
// Direct-to-service pattern matching pseudonymisation.js — caller handles
// failure. Response shapes mirror backend/metrics_service/{main,calculator}.py
// exactly; transformation into page-specific shapes happens at the call site.

const METRICS_URL =
    process.env.NEXT_PUBLIC_METRICS_SERVICE_URL || 'http://localhost:8006';

const REQUEST_TIMEOUT_MS = 15000;

async function request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(`${METRICS_URL}${path}`, {
            method,
            headers: body
                ? { 'Accept': 'application/json', 'Content-Type': 'application/json' }
                : { 'Accept': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`metrics service failed: HTTP ${res.status} ${text}`);
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
    return request('/metrics/dashboard');
}

// GET /metrics/accuracy/:id → either
//   { file_id, wer: null, status: 'pending_edit', message } when not yet edited, or
//   { file_id, wer: number, raw_text_preview, edited_text_preview }
export function fetchFileAccuracy(fileId) {
    return request(`/metrics/accuracy/${encodeURIComponent(fileId)}`);
}

// POST /metrics/refresh → { message }. Clears the service's 60s in-memory cache.
export function refreshMetricsCache() {
    return request('/metrics/refresh', { method: 'POST' });
}
