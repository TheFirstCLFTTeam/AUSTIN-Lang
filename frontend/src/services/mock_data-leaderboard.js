// Mock leaderboard submissions for the SOURCE (sampled) datasets. One row per
// engineer per dataset — the leaderboard shows only that engineer's best
// submission. Worst-error utterances are inlined onto the submission object so
// the drawer can render them without a secondary lookup.
//
// Custom engineer-curated datasets live in mock_data-leaderboard-custom.js.

const BASE_FAMILIES = {
  whisper: { label: 'whisper', color: '#1c1b1b' },
  meralion: { label: 'meralion', color: '#b20100' },
  wav2vec2: { label: 'wav2vec2', color: '#7a7574' },
  custom: { label: 'custom', color: '#e9bcb5' },
  baseline: { label: 'baseline', color: '#9e6a00' },
};

// Shared identity for the reference baseline row. Each dataset pins a copy
// with its own error metrics so the baseline always ranks last on that
// dataset's held-out split — engineers are trying to beat it.
const BASELINE_COMMON = {
  engineerId: 'system-baseline',
  engineerName: 'Competition Baseline',
  modelName: 'whisper-lg-v3 \u00b7 zero-shot (no fine-tune)',
  baseFamily: 'baseline',
  submissionCount: 1,
  submittedAt: '2026-04-01T00:00:00Z',
  reproducibility: { config: true, checkpoint: true, notebook: true },
  worstExamples: [],
};

export function getBaseFamilyMeta(id) {
  return BASE_FAMILIES[id] || BASE_FAMILIES.custom;
}

const SUBMISSIONS_BY_DATASET = {
  mixed: [
    {
      id: 'sub-mx-01',
      engineerId: 'u2',
      engineerName: 'Engineer User',
      modelName: 'whisper-lg-v3 + lora r16',
      baseFamily: 'whisper',
      wer: 0.081,
      cer: 0.042,
      rtf: 0.44,
      submissionCount: 3,
      submittedAt: '2026-04-17T04:30:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: false },
      worstExamples: [],
    },
    {
      id: 'sub-mx-02',
      engineerId: 'eng-priya',
      engineerName: 'Priya Rangan',
      modelName: 'whisper-lg-v3 + lora r32',
      baseFamily: 'whisper',
      wer: 0.074,
      cer: 0.039,
      rtf: 0.41,
      submissionCount: 5,
      submittedAt: '2026-04-17T06:12:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: true },
      worstExamples: [
        { id: 'wx-1', refText: '佢話 the deal is challa gaya 先', predText: '佢話 the deal is challenger 先', utteranceWer: 0.33 },
        { id: 'wx-2', refText: 'EBITDA 點計啊 actually', predText: 'E B T D 點計啊 actually', utteranceWer: 0.40 },
      ],
    },
    {
      id: 'sub-mx-03',
      engineerId: 'eng-andreas',
      engineerName: 'Andreas Keller',
      modelName: 'meralion v2 + EWC',
      baseFamily: 'meralion',
      wer: 0.079,
      cer: 0.041,
      rtf: 0.38,
      submissionCount: 4,
      submittedAt: '2026-04-16T09:11:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: true },
      worstExamples: [
        { id: 'wx-3', refText: '我 short 咗 Tencent 兩個點', predText: '我 short 咗 ten cent 兩個點', utteranceWer: 0.14 },
      ],
    },
    {
      id: 'sub-mx-04',
      engineerId: 'eng-james',
      engineerName: 'James Whitmore',
      modelName: 'wav2vec2-xls-r-300m + adapter',
      baseFamily: 'wav2vec2',
      wer: 0.093,
      cer: 0.050,
      rtf: 0.29,
      submissionCount: 2,
      submittedAt: '2026-04-13T15:04:00Z',
      reproducibility: { config: true, checkpoint: false, notebook: false },
      worstExamples: [],
    },
    {
      ...BASELINE_COMMON,
      id: 'sub-mx-baseline',
      wer: 0.128,
      cer: 0.072,
      rtf: 0.58,
    },
  ],
  wordshk: [
    {
      id: 'sub-wh-01',
      engineerId: 'u2',
      engineerName: 'Engineer User',
      modelName: 'whisper-lg-v3 + lora r16',
      baseFamily: 'whisper',
      wer: 0.054,
      cer: 0.028,
      rtf: 0.43,
      submissionCount: 2,
      submittedAt: '2026-04-16T11:20:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: false },
      worstExamples: [],
    },
    {
      id: 'sub-wh-02',
      engineerId: 'eng-priya',
      engineerName: 'Priya Rangan',
      modelName: 'meralion v2',
      baseFamily: 'meralion',
      wer: 0.048,
      cer: 0.025,
      rtf: 0.39,
      submissionCount: 3,
      submittedAt: '2026-04-17T02:05:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: true },
      worstExamples: [],
    },
    {
      id: 'sub-wh-03',
      engineerId: 'eng-andreas',
      engineerName: 'Andreas Keller',
      modelName: 'whisper-lg-v3 baseline',
      baseFamily: 'whisper',
      wer: 0.061,
      cer: 0.033,
      rtf: 0.42,
      submissionCount: 1,
      submittedAt: '2026-04-11T10:30:00Z',
      reproducibility: { config: true, checkpoint: false, notebook: false },
      worstExamples: [],
    },
    {
      ...BASELINE_COMMON,
      id: 'sub-wh-baseline',
      wer: 0.089,
      cer: 0.051,
      rtf: 0.57,
    },
  ],
  alvanlii: [
    {
      id: 'sub-al-01',
      engineerId: 'u2',
      engineerName: 'Engineer User',
      modelName: 'whisper-lg-v3 + lora r16',
      baseFamily: 'whisper',
      wer: 0.118,
      cer: 0.063,
      rtf: 0.45,
      submissionCount: 1,
      submittedAt: '2026-04-14T08:00:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: false },
      worstExamples: [],
    },
    {
      id: 'sub-al-02',
      engineerId: 'eng-andreas',
      engineerName: 'Andreas Keller',
      modelName: 'meralion v2 + EWC',
      baseFamily: 'meralion',
      wer: 0.102,
      cer: 0.055,
      rtf: 0.38,
      submissionCount: 3,
      submittedAt: '2026-04-15T14:22:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: true },
      worstExamples: [],
    },
    {
      id: 'sub-al-03',
      engineerId: 'eng-priya',
      engineerName: 'Priya Rangan',
      modelName: 'whisper-lg-v3 + lora r32',
      baseFamily: 'whisper',
      wer: 0.097,
      cer: 0.051,
      rtf: 0.41,
      submissionCount: 4,
      submittedAt: '2026-04-17T01:48:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: true },
      worstExamples: [],
    },
    {
      ...BASELINE_COMMON,
      id: 'sub-al-baseline',
      wer: 0.156,
      cer: 0.089,
      rtf: 0.61,
    },
  ],
  edmund: [
    {
      id: 'sub-ed-01',
      engineerId: 'u2',
      engineerName: 'Engineer User',
      modelName: 'whisper-lg-v3 + lora r16',
      baseFamily: 'whisper',
      wer: 0.067,
      cer: 0.035,
      rtf: 0.44,
      submissionCount: 2,
      submittedAt: '2026-04-15T18:12:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: false },
      worstExamples: [],
    },
    {
      id: 'sub-ed-02',
      engineerId: 'eng-priya',
      engineerName: 'Priya Rangan',
      modelName: 'meralion v2',
      baseFamily: 'meralion',
      wer: 0.063,
      cer: 0.032,
      rtf: 0.39,
      submissionCount: 3,
      submittedAt: '2026-04-16T21:30:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: true },
      worstExamples: [],
    },
    {
      ...BASELINE_COMMON,
      id: 'sub-ed-baseline',
      wer: 0.101,
      cer: 0.058,
      rtf: 0.55,
    },
  ],
};

export function getLeaderboardDatasets() {
  return Object.keys(SUBMISSIONS_BY_DATASET);
}

export function getLeaderboard(datasetId) {
  const rows = SUBMISSIONS_BY_DATASET[datasetId] || [];
  const sorted = [...rows].sort((a, b) => a.wer - b.wer);
  return sorted.map((row, idx) => ({ ...row, rank: idx + 1 }));
}

export function formatRelative(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.round(diffMs / day)}d ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatAbsolute(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatPercent(v, digits = 1) {
  if (typeof v !== 'number') return '—';
  return `${(v * 100).toFixed(digits)}%`;
}
