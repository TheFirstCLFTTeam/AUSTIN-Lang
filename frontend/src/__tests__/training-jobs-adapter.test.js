// Tests for adaptOrchestratorJob — the projection from the
// training-orchestrator's JobResponse shape onto the row shape the
// /training table consumes. Pure function; no env or HTTP mocking
// needed.

import { describe, expect, it } from 'vitest';

import { adaptOrchestratorJob } from '../services/training-jobs';


function _baseJob(overrides = {}) {
    return {
        id: 'job-abc',
        name: 'whisper-fin-q2',
        submitted_by: 'u2',
        submitted_at: '2026-04-28T08:15:00.000Z',
        status: 'queued',
        target: 'cloud',
        base_model: 'openai/whisper-large-v3-turbo',
        dataset_ref: 'u2@example.com/20260401T120000',
        data_zone: 'green',
        env: {
            LORA: '1',
            LORA_RANK: '16',
            LORA_ALPHA: '32',
            LEARNING_RATE: '3e-4',
            EPOCHS: '3',
            BATCH_SIZE: '8',
        },
        fl_enabled: false,
        dp_enabled: false,
        progress_pct: null,
        started_at: null,
        finished_at: null,
        failure_reason: null,
        ...overrides,
    };
}


describe('adaptOrchestratorJob', () => {
    it('returns null on falsy / non-object input', () => {
        expect(adaptOrchestratorJob(null)).toBeNull();
        expect(adaptOrchestratorJob(undefined)).toBeNull();
        expect(adaptOrchestratorJob('not a job')).toBeNull();
    });

    it('maps queued jobs straight through', () => {
        const row = adaptOrchestratorJob(_baseJob({ status: 'queued' }));
        expect(row.status).toBe('queued');
        expect(row.rawStatus).toBe('queued');
        expect(row.progress).toBe(0);
    });

    it('projects preparing → queued (no GPU work yet)', () => {
        const row = adaptOrchestratorJob(_baseJob({ status: 'preparing' }));
        expect(row.status).toBe('queued');
        expect(row.rawStatus).toBe('preparing');
    });

    it('projects evaluating → running (bar still moving)', () => {
        const row = adaptOrchestratorJob(_baseJob({
            status: 'evaluating',
            progress_pct: 92.5,
        }));
        expect(row.status).toBe('running');
        expect(row.rawStatus).toBe('evaluating');
        expect(row.progress).toBe(93);  // rounded
    });

    it('projects published → completed', () => {
        const row = adaptOrchestratorJob(_baseJob({
            status: 'published',
            progress_pct: 100,
            finished_at: '2026-04-28T08:45:00.000Z',
        }));
        expect(row.status).toBe('completed');
        expect(row.rawStatus).toBe('published');
        expect(row.progress).toBe(100);
    });

    it('keeps cancelled and failed as their own status terms', () => {
        const cancelled = adaptOrchestratorJob(_baseJob({ status: 'cancelled' }));
        const failed = adaptOrchestratorJob(_baseJob({
            status: 'failed',
            failure_reason: 'OOM during step 200',
        }));
        expect(cancelled.status).toBe('cancelled');
        expect(failed.status).toBe('failed');
        expect(failed.failureReason).toBe('OOM during step 200');
    });

    it('parses LoRA + epoch + LR fields from env_json', () => {
        const row = adaptOrchestratorJob(_baseJob());
        expect(row.useLora).toBe(true);
        expect(row.rank).toBe(16);
        expect(row.loraAlpha).toBe(32);
        expect(row.epochs).toBe(3);
        expect(row.batchSize).toBe(8);
        expect(row.lr).toBe('3e-4');
    });

    it('treats LORA="0" as a full-finetune (useLora=false)', () => {
        const row = adaptOrchestratorJob(_baseJob({
            env: { LORA: '0', LEARNING_RATE: '1e-5' },
        }));
        expect(row.useLora).toBe(false);
        expect(row.rank).toBeNull();
    });

    it('reverse-maps known HF ids to display labels', () => {
        const w = adaptOrchestratorJob(_baseJob({ base_model: 'openai/whisper-large-v3-turbo' }));
        const m = adaptOrchestratorJob(_baseJob({ base_model: 'MERaLiON/MERaLiON-AudioLLM-Whisper-SEA-LION' }));
        expect(w.baseModel).toBe('Whisper Large-v3');
        expect(m.baseModel).toBe('MERaLiON');
        // Round-trip the original HF id stays available.
        expect(w.baseModelHfId).toBe('openai/whisper-large-v3-turbo');
    });

    it('falls back to the family tail for unknown HF ids', () => {
        const row = adaptOrchestratorJob(_baseJob({ base_model: 'meta-llama/foo-bar' }));
        expect(row.baseModel).toBe('foo-bar');
    });

    it('formats start time in MMM DD, HH:MM GMT', () => {
        const row = adaptOrchestratorJob(_baseJob({
            started_at: '2026-04-28T03:07:00.000Z',
        }));
        expect(row.startTime).toBe('APR 28, 03:07 GMT');
    });

    it('falls back to submitted_at for queued jobs that have not started', () => {
        const row = adaptOrchestratorJob(_baseJob({
            started_at: null,
            submitted_at: '2026-04-28T08:15:00.000Z',
        }));
        expect(row.startTime).toBe('APR 28, 08:15 GMT');
    });

    it('handles missing env gracefully', () => {
        const row = adaptOrchestratorJob(_baseJob({ env: {} }));
        expect(row.useLora).toBe(false);
        expect(row.rank).toBeNull();
        expect(row.lr).toBe('—');
        expect(row.epochs).toBeNull();
    });

    it('rounds progress_pct on the way out', () => {
        const row = adaptOrchestratorJob(_baseJob({ progress_pct: 67.8 }));
        expect(row.progress).toBe(68);
    });

    it('null progress_pct becomes 0 (queued / un-stamped)', () => {
        const row = adaptOrchestratorJob(_baseJob({ progress_pct: null }));
        expect(row.progress).toBe(0);
    });

    it('flags every adapted row as live so the UI can disambiguate from mock', () => {
        const row = adaptOrchestratorJob(_baseJob());
        expect(row.live).toBe(true);
    });

    it('supplies empty placeholders for fields the orchestrator does not yet report', () => {
        const row = adaptOrchestratorJob(_baseJob());
        // Heartbeat hook (training-job-pipeline.md §4.1 /heartbeat) will
        // populate these later. For now they're zero/empty so the
        // existing render code doesn't crash on undefined.
        expect(row.gpu).toBe(0);
        expect(row.metrics).toEqual({
            trainLoss: null, valLoss: null, learningRate: null,
            tokensPerSec: 0, gradNorm: null,
        });
        expect(row.lossHistory).toEqual([]);
        expect(row.infra).toEqual({ cluster: '—', gpuType: '—', region: '—' });
    });
});
