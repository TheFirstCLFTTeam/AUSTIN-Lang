// Shared training jobs source. Consumed by the Training Jobs page, the per-
// job detail page, and downstream flows (e.g. dataset export dialog) that
// need to let the user pick a model tied to an in-flight or queued
// experiment.
//
// The MOCK list below stays as the demo data. The real-mode submission +
// listing functions at the bottom of the file talk to the
// training-orchestrator via /api/training-jobs (see
// docs/07 Integration CAA 27APR2026/training-job-pipeline.md §4.1).

import { readCsrfToken } from './http';

export const TRAINING_JOBS = [
    {
        id: 'TRANS-LARGE-V3-FIN',
        status: 'running',
        progress: 67,
        gpu: 94,
        startTime: 'OCT 24, 08:00 GMT',
        startedAtIso: '2026-04-16T08:00:00Z',
        submittedBy: 'u2',
        submittedAtIso: '2026-04-16T07:52:00Z',
        description: 'Full fine-tune of Whisper Large-v3 on the financial call-centre code-switch set. Target is WER < 7% on the mixed held-out split.',
        baseModel: 'Whisper Large-v3',
        useLora: true,
        rank: 16,
        loraAlpha: 32,
        lr: '3e-4',
        epochs: 3,
        currentEpoch: 2,
        batchSize: 8,
        datasetRef: 'engineer@example.com/20260401T120000',
        datasetName: 'Cantonese Telephony Edge Cases',
        currentStep: 4020,
        totalSteps: 6000,
        metrics: {
            trainLoss: 0.612,
            valLoss: 0.754,
            learningRate: 2.1e-4,
            tokensPerSec: 18420,
            gradNorm: 0.83,
        },
        // Down-sampled history for a sparkline. Paired with currentStep.
        lossHistory: [
            { step: 200, loss: 2.14 },
            { step: 500, loss: 1.67 },
            { step: 900, loss: 1.31 },
            { step: 1400, loss: 1.04 },
            { step: 1900, loss: 0.89 },
            { step: 2400, loss: 0.78 },
            { step: 2900, loss: 0.71 },
            { step: 3400, loss: 0.66 },
            { step: 3900, loss: 0.62 },
        ],
        elapsedMin: 208,
        etaMin: 102,
        infra: { cluster: 'INTERNAL-SERVER-3', gpuType: 'H100 \u00d7 4', region: 'APAC-SG' },
    },
    {
        id: 'MAND-RETRAIN-A2',
        status: 'paused',
        progress: 31,
        gpu: 0,
        startTime: 'OCT 24, 02:15 GMT',
        startedAtIso: '2026-04-16T02:15:00Z',
        submittedBy: 'u2',
        submittedAtIso: '2026-04-16T02:10:00Z',
        description: 'MERaLiON adaptation for Mandarin retrain. Paused pending tokenizer fix on dataset vintage.',
        baseModel: 'MERaLiON',
        useLora: true,
        rank: 32,
        loraAlpha: 64,
        lr: '1e-4',
        epochs: 5,
        currentEpoch: 2,
        batchSize: 4,
        datasetRef: 'engineer@example.com/20260402T154000',
        datasetName: 'Earnings Calls Q1 2026',
        currentStep: 1860,
        totalSteps: 6000,
        metrics: {
            trainLoss: 0.981,
            valLoss: 1.124,
            learningRate: 9.4e-5,
            tokensPerSec: 0,
            gradNorm: 1.21,
        },
        lossHistory: [
            { step: 200, loss: 2.48 },
            { step: 500, loss: 1.92 },
            { step: 900, loss: 1.46 },
            { step: 1300, loss: 1.18 },
            { step: 1700, loss: 0.98 },
        ],
        elapsedMin: 94,
        etaMin: null,
        infra: { cluster: 'INTERNAL-SERVER-3', gpuType: 'A100 \u00d7 2', region: 'APAC-SG' },
        pauseReason: 'Tokenizer vocabulary hash mismatch between training checkpoint and dataset manifest. Resume blocked until manifest is re-baselined.',
    },
    {
        id: 'LLM-FINE-TUNE-CREDIT',
        status: 'queued',
        progress: 0,
        gpu: 0,
        startTime: '\u2014',
        startedAtIso: null,
        submittedBy: 'u2',
        submittedAtIso: '2026-04-17T01:10:00Z',
        description: 'LoRA fine-tune of Whisper Tiny on the credit-risk call subset. Queued behind TRANS-LARGE-V3-FIN for H100 allocation.',
        baseModel: 'Whisper Tiny',
        useLora: true,
        rank: 8,
        loraAlpha: 16,
        lr: '5e-5',
        epochs: 2,
        currentEpoch: 0,
        batchSize: 16,
        datasetRef: 'engineer@example.com/20260409T111500',
        datasetName: 'Multispeaker Overlap (Hard)',
        currentStep: 0,
        totalSteps: 2400,
        metrics: {
            trainLoss: null,
            valLoss: null,
            learningRate: null,
            tokensPerSec: 0,
            gradNorm: null,
        },
        lossHistory: [],
        elapsedMin: 0,
        etaMin: null,
        infra: { cluster: 'INTERNAL-SERVER-3', gpuType: 'H100 \u00d7 1 (pending)', region: 'APAC-SG' },
        queuePosition: 1,
    },
];

export function getTrainingJobs() {
    return [...TRAINING_JOBS];
}

export function getTrainingJobById(id) {
    return TRAINING_JOBS.find((j) => j.id === id) || null;
}

// Deterministic log tail per job id. Running jobs get a mix of info + warn
// lines interleaved with periodic metric snapshots. Paused jobs end on the
// pause reason. Queued jobs show scheduler messages. Used by the detail
// page to fill the black log panel.
const LOG_TEMPLATES = {
    running: [
        { level: 'info', msg: 'step {step} | loss={trainLoss} | lr={lr} | tokens/s={tps}' },
        { level: 'info', msg: 'eval step {evalStep} | val_loss={valLoss} | wer={wer}' },
        { level: 'info', msg: 'checkpoint written: ckpt-{ckpt}.safetensors (sha256 verified)' },
        { level: 'warn', msg: 'gradient norm spike {gradNorm} at step {step} — clipped' },
        { level: 'info', msg: 'dataloader refilled shard {shard}/{shards} in {ms}ms' },
        { level: 'info', msg: 'GPU util={gpu}% memory={mem}/80 GiB temp={temp}\u00b0C' },
        { level: 'info', msg: 'LoRA adapters saved: rank={rank} alpha={alpha}' },
    ],
    paused: [
        { level: 'info', msg: 'pause signal received from austin-cli' },
        { level: 'warn', msg: 'tokenizer hash mismatch detected \u2014 halting before next backward pass' },
        { level: 'info', msg: 'state dumped to /mnt/ckpt/{job}/pause-{step}.tar' },
        { level: 'info', msg: 'waiting for resume command' },
    ],
    queued: [
        { level: 'info', msg: 'job submitted to scheduler \u2014 priority=normal' },
        { level: 'info', msg: 'awaiting resource lease: {gpuType} on {cluster}' },
        { level: 'info', msg: 'queue position: {pos}' },
    ],
};

function fmt(template, ctx) {
    return template.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] != null ? String(ctx[k]) : k));
}

// Automatic performance-metric detection.
//
// The idea: rather than hard-coding which log fields represent model
// performance, we infer them from the log stream itself. Any `key=value` or
// `key: value` token whose numeric value keeps *changing* across repeated
// log lines is, by convention, a performance-reporting metric (e.g. `loss`,
// `lr`, `val_loss`, `wer`, `gpu`, `tokens/s`). Tokens whose value barely
// varies are labels or static markers and get classified as such.
//
// This deliberately ignores any metric data stored elsewhere on the job —
// the input is the log stream ONLY, so anything surfaced here can be traced
// back to an actual line the training container emitted.
const METRIC_TOKEN = /([A-Za-z_][A-Za-z0-9_\/]*)\s*[:=]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?%?)/g;

export function detectMetricsFromLogs(logs) {
    if (!logs || logs.length === 0) return [];

    const hits = new Map();
    for (const line of logs) {
        if (!line?.msg) continue;
        METRIC_TOKEN.lastIndex = 0;
        let m;
        while ((m = METRIC_TOKEN.exec(line.msg)) !== null) {
            const key = m[1];
            const value = m[2];
            if (!hits.has(key)) {
                hits.set(key, { count: 0, values: new Set(), lastValue: null, lastTs: null });
            }
            const h = hits.get(key);
            h.count += 1;
            h.values.add(value);
            h.lastValue = value;
            h.lastTs = line.ts;
        }
    }

    const OCCURRENCE_THRESHOLD = 2;
    const result = [];
    for (const [key, data] of hits.entries()) {
        if (data.count < OCCURRENCE_THRESHOLD) continue;
        const variability = data.values.size / data.count;
        // Classify: high variability = the value is actively updated, i.e. a
        // performance signal. Low variability = static label / constant.
        const classification = variability >= 0.5 ? 'performance' : 'label';
        result.push({
            key,
            occurrences: data.count,
            distinctValues: data.values.size,
            lastValue: data.lastValue,
            lastTs: data.lastTs,
            variability,
            classification,
        });
    }

    // Performance signals first, then by how often they appeared.
    result.sort((a, b) => {
        if (a.classification !== b.classification) {
            return a.classification === 'performance' ? -1 : 1;
        }
        return b.occurrences - a.occurrences || b.variability - a.variability;
    });

    return result;
}

// ---------------------------------------------------------------------------
// JobResponse → table-row adapter
// ---------------------------------------------------------------------------
//
// The orchestrator's JobResponse shape is documented in
// backend/training_orchestrator/main.py::JobResponse. The /training table
// rows below this comment have a richer shape (gpu, lossHistory, infra,
// metrics) — those fields aren't reportable from the orchestrator yet
// (heartbeat + log SSE is for the detail page; aggregate worker metrics
// roll up later, see training-job-pipeline.md §4.6). The adapter
// produces a lossy projection that's enough for the list-page render
// and leaves the rich fields null/empty so unaware consumers fall back
// to safe defaults.

// HF id → display label. Mirrors BASE_MODEL_HF_IDS in training/page.jsx
// but inverted; kept here so both pages share one source.
const HF_ID_TO_DISPLAY = {
    'openai/whisper-large-v3-turbo': 'Whisper Large-v3',
    'openai/whisper-tiny': 'Whisper Tiny',
    'MERaLiON/MERaLiON-AudioLLM-Whisper-SEA-LION': 'MERaLiON',
    'Qwen/Qwen3-ASR': 'Qwen3-ASR',
};

// Status mapping. Orchestrator's state machine (queued → preparing →
// running → evaluating → published / cancelled / failed / paused)
// projects onto the four states the existing StatusBadge renders.
// `evaluating` displays as `running` because the bar is still moving;
// `preparing` displays as `queued` because no GPU work has started.
const STATUS_PROJECTION = {
    queued: 'queued',
    preparing: 'queued',
    running: 'running',
    evaluating: 'running',
    paused: 'paused',
    published: 'completed',
    cancelled: 'cancelled',
    failed: 'failed',
};

function _baseModelDisplay(hfId) {
    if (!hfId) return '—';
    if (HF_ID_TO_DISPLAY[hfId]) return HF_ID_TO_DISPLAY[hfId];
    // Unknown id — strip vendor prefix, keep the family name.
    const tail = hfId.includes('/') ? hfId.split('/').pop() : hfId;
    return tail || hfId;
}

function _formatStartTime(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '—';
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const mm = months[d.getUTCMonth()];
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mi = String(d.getUTCMinutes()).padStart(2, '0');
        return `${mm} ${dd}, ${hh}:${mi} GMT`;
    } catch {
        return '—';
    }
}

// Public for tests + the page.
export function adaptOrchestratorJob(job) {
    if (!job || typeof job !== 'object') return null;
    const env = job.env || {};
    const rank = env.LORA_RANK != null ? Number(env.LORA_RANK) : null;
    const loraAlpha = env.LORA_ALPHA != null ? Number(env.LORA_ALPHA) : null;
    const epochs = env.EPOCHS != null ? Number(env.EPOCHS) : null;
    const batchSize = env.BATCH_SIZE != null ? Number(env.BATCH_SIZE) : null;
    const lr = env.LEARNING_RATE != null ? String(env.LEARNING_RATE) : '—';
    const useLora = env.LORA === '1' || env.LORA === 1 || env.LORA === true;

    return {
        id: job.id,
        status: STATUS_PROJECTION[job.status] || 'queued',
        // Carry the unmapped status forward so the detail page (or a
        // future tooltip) can show "evaluating" / "published" verbatim.
        rawStatus: job.status,
        progress: job.progress_pct != null ? Math.round(job.progress_pct) : 0,
        // GPU util isn't yet reported by either worker — heartbeat hook
        // will fill this in (training-job-pipeline.md §4.1, /heartbeat
        // endpoint). Until then, 0 just paints the bars empty.
        gpu: 0,
        startTime: _formatStartTime(job.started_at || job.submitted_at),
        startedAtIso: job.started_at || null,
        submittedBy: job.submitted_by || null,
        submittedAtIso: job.submitted_at || null,
        description: job.name || job.id,
        baseModel: _baseModelDisplay(job.base_model),
        baseModelHfId: job.base_model || null,
        useLora,
        rank,
        loraAlpha,
        lr,
        epochs,
        batchSize,
        currentEpoch: 0,
        datasetRef: job.dataset_ref || null,
        datasetName: job.dataset_ref || null,
        currentStep: 0,
        totalSteps: 0,
        // Empty-but-shaped placeholders so the detail page render doesn't
        // need to special-case live-mode rows.
        metrics: {
            trainLoss: null, valLoss: null, learningRate: null,
            tokensPerSec: 0, gradNorm: null,
        },
        lossHistory: [],
        elapsedMin: 0,
        etaMin: null,
        infra: { cluster: '—', gpuType: '—', region: '—' },
        failureReason: job.failure_reason || null,
        live: true,
    };
}

// ---------------------------------------------------------------------------
// Real-mode orchestrator client (POST /jobs, GET /jobs, cancel)
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 15000;

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function _request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const headers = body
        ? { Accept: 'application/json', 'Content-Type': 'application/json' }
        : { Accept: 'application/json' };
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
    let data = null;
    const text = await res.text();
    if (text) {
        try { data = JSON.parse(text); } catch { /* leave null */ }
    }
    if (!res.ok) {
        const detail = data?.detail || `HTTP ${res.status}`;
        const err = new Error(`training jobs request failed: ${detail}`);
        err.status = res.status;
        err.detail = data?.detail;
        throw err;
    }
    return data;
}

// POST /api/training-jobs — submit a new job.
// Body shape mirrors the orchestrator's SubmitJobRequest minus
// submitted_by, which the proxy stamps from the session cookie.
export function submitTrainingJob({
    name,
    target,
    base_model,
    dataset_ref,
    env = {},
    data_zone = 'green',
    fl_enabled = false,
    dp_enabled = false,
}) {
    return _request('/api/training-jobs', {
        method: 'POST',
        body: { name, target, base_model, dataset_ref, env, data_zone, fl_enabled, dp_enabled },
    });
}

export function listTrainingJobs({ submitter, status, limit } = {}) {
    const params = new URLSearchParams();
    if (submitter) params.set('submitter', submitter);
    if (status) params.set('status', status);
    if (limit != null) params.set('limit', String(limit));
    const q = params.toString();
    return _request(`/api/training-jobs${q ? `?${q}` : ''}`);
}

export function getTrainingJobDetail(jobId) {
    return _request(`/api/training-jobs/${encodeURIComponent(jobId)}`);
}

export function cancelTrainingJob(jobId) {
    return _request(`/api/training-jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
    });
}

// Multipart upload of a Python training script onto a queued job. The
// upstream guard (orchestrator) does the size cap + MIME + magic-byte
// sniff — we only need to package the file and propagate any error.
//
// Returns the orchestrator's ScriptUploadResponse on success
// ({job_id, filename, sha256, size_bytes, uploaded_at}).
// Throws an Error with .status + .detail on any non-2xx response so the
// caller can branch on 413/415/409/etc and show a useful message.
export async function uploadTrainingScript(jobId, file) {
    if (!jobId) throw new Error('jobId is required');
    if (!file) throw new Error('file is required');

    const form = new FormData();
    form.append('file', file, file.name);

    const headers = { Accept: 'application/json' };
    const csrf = readCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(
            `/api/training-jobs/${encodeURIComponent(jobId)}/script`,
            {
                method: 'POST',
                headers,
                body: form,
                signal: controller.signal,
                credentials: 'same-origin',
            },
        );
    } finally {
        clearTimeout(timer);
    }
    let data = null;
    const text = await res.text();
    if (text) {
        try { data = JSON.parse(text); } catch { /* leave null */ }
    }
    if (!res.ok) {
        const detail = data?.detail || `HTTP ${res.status}`;
        const err = new Error(`script upload failed: ${detail}`);
        err.status = res.status;
        err.detail = data?.detail;
        throw err;
    }
    return data;
}

export function getTrainingLogs(job) {
    if (!job) return [];
    const templates = LOG_TEMPLATES[job.status] || [];
    const ctx = {
        step: job.currentStep,
        trainLoss: job.metrics?.trainLoss?.toFixed(3) ?? '-',
        valLoss: job.metrics?.valLoss?.toFixed(3) ?? '-',
        lr: typeof job.metrics?.learningRate === 'number' ? job.metrics.learningRate.toExponential(1) : '-',
        tps: job.metrics?.tokensPerSec?.toLocaleString() ?? '0',
        gradNorm: job.metrics?.gradNorm?.toFixed(2) ?? '-',
        evalStep: Math.max(0, (job.currentStep || 0) - 200),
        wer: '0.094',
        ckpt: Math.floor((job.currentStep || 0) / 400),
        shard: 12,
        shards: 20,
        ms: 240,
        gpu: job.gpu,
        mem: 68,
        temp: 71,
        rank: job.rank,
        alpha: job.loraAlpha,
        gpuType: job.infra?.gpuType,
        cluster: job.infra?.cluster,
        pos: job.queuePosition,
        job: job.id,
    };

    // Build a deterministic interleaved tail. Seed off the job id.
    let h = 2166136261;
    for (let i = 0; i < job.id.length; i++) {
        h ^= job.id.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }

    const lines = [];
    const baseTime = job.startedAtIso ? new Date(job.startedAtIso).getTime() : Date.now();
    const count = job.status === 'running' ? 18 : job.status === 'paused' ? 8 : templates.length;
    for (let i = 0; i < count; i++) {
        const t = templates[(h + i) % templates.length];
        h = (Math.imul(h, 16777619) + 0xdeadbeef) >>> 0;
        lines.push({
            level: t.level,
            ts: new Date(baseTime + i * 42 * 1000).toISOString(),
            msg: fmt(t.msg, { ...ctx, step: (ctx.step || 0) - (count - i) * 20 }),
        });
    }
    return lines;
}
