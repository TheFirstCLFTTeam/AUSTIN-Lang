// Shared training jobs source. Consumed by the Training Jobs page, the per-
// job detail page, and downstream flows (e.g. dataset export dialog) that
// need to let the user pick a model tied to an in-flight or queued
// experiment.

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
