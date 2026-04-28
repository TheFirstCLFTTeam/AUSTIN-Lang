// Mock leaderboard data for *engineer-curated* datasets. These are the
// "custom sets" shape from services/datasets.js (id, name, description,
// createdBy, createdAt, fileCount) — pre-seeded here so the leaderboard has
// something to show for custom-dataset competitions even when the user
// hasn't curated a real one yet via the file browser.
//
// Real user-curated datasets from localStorage are still surfaced in the
// dropdown by the leaderboard page; they just won't have submissions until
// the backend evaluation pipeline is wired up.

export const MOCK_CUSTOM_DATASETS = [
  {
    id: 'custom-earnings-q1',
    name: 'Earnings Calls Q1 2026',
    description: 'Hand-curated Q1 earnings call excerpts with dense financial NER. Stress-tests jargon recall.',
    createdBy: 'Andreas Keller',
    createdAt: '2026-03-28T09:00:00Z',
    fileCount: 84,
    tags: ['earnings', 'financial-ner', 'en-us'],
  },
  {
    id: 'custom-canto-telephony',
    name: 'Cantonese Telephony Edge Cases',
    description: 'Low-bandwidth telephony audio with heavy code-switching and background noise. Failure-mining set.',
    createdBy: 'Priya Rangan',
    createdAt: '2026-04-02T15:40:00Z',
    fileCount: 47,
    tags: ['telephony', 'code-switch', 'noisy'],
  },
  {
    id: 'custom-multispeaker-hard',
    name: 'Multispeaker Overlap (Hard)',
    description: '3+ speaker meetings with ≥20% overlap. Targets diarization/WDER regressions.',
    createdBy: 'Engineer User',
    createdAt: '2026-04-09T11:15:00Z',
    fileCount: 31,
    tags: ['multispeaker', 'overlap', 'diarization'],
  },
];

// Shared identity for the reference baseline — same "Competition Baseline"
// used on the source datasets. Each dataset stamps its own error metrics so
// the baseline always trails every engineer submission.
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

const CUSTOM_SUBMISSIONS_BY_DATASET = {
  'custom-earnings-q1': [
    {
      id: 'csub-eq-01',
      engineerId: 'eng-andreas',
      engineerName: 'Andreas Keller',
      modelName: 'meralion v2 + finance glossary bias',
      baseFamily: 'meralion',
      wer: 0.059,
      cer: 0.031,
      rtf: 0.37,
      submissionCount: 4,
      submittedAt: '2026-04-16T14:02:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: true },
      worstExamples: [
        { id: 'wx-eq-1', refText: 'diluted EPS came in at 2.14 versus consensus of 2.08', predText: 'diluted E P S came in at 2.14 versus consensus of 2.08', utteranceWer: 0.14 },
      ],
    },
    {
      id: 'csub-eq-02',
      engineerId: 'u2',
      engineerName: 'Engineer User',
      modelName: 'whisper-lg-v3 + lora r16',
      baseFamily: 'whisper',
      wer: 0.068,
      cer: 0.036,
      rtf: 0.44,
      submissionCount: 2,
      submittedAt: '2026-04-17T03:14:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: false },
      worstExamples: [
        { id: 'wx-eq-2', refText: 'free cash flow conversion of ninety two percent', predText: 'free cashflow conversion of ninety two percent', utteranceWer: 0.20 },
      ],
    },
    {
      id: 'csub-eq-03',
      engineerId: 'eng-priya',
      engineerName: 'Priya Rangan',
      modelName: 'whisper-lg-v3 + lora r32',
      baseFamily: 'whisper',
      wer: 0.063,
      cer: 0.033,
      rtf: 0.41,
      submissionCount: 3,
      submittedAt: '2026-04-16T20:45:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: true },
      worstExamples: [],
    },
    {
      ...BASELINE_COMMON,
      id: 'csub-eq-baseline',
      wer: 0.094,
      cer: 0.053,
      rtf: 0.57,
    },
  ],
  'custom-canto-telephony': [
    {
      id: 'csub-ct-01',
      engineerId: 'eng-priya',
      engineerName: 'Priya Rangan',
      modelName: 'meralion v2 + telephony augment',
      baseFamily: 'meralion',
      wer: 0.141,
      cer: 0.076,
      rtf: 0.36,
      submissionCount: 5,
      submittedAt: '2026-04-17T05:50:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: true },
      worstExamples: [
        { id: 'wx-ct-1', refText: '喂 can you confirm the order 啊', predText: '喂 can you call from the order 啊', utteranceWer: 0.33 },
      ],
    },
    {
      id: 'csub-ct-02',
      engineerId: 'u2',
      engineerName: 'Engineer User',
      modelName: 'whisper-lg-v3 + lora r16',
      baseFamily: 'whisper',
      wer: 0.168,
      cer: 0.089,
      rtf: 0.45,
      submissionCount: 1,
      submittedAt: '2026-04-15T12:10:00Z',
      reproducibility: { config: true, checkpoint: false, notebook: false },
      worstExamples: [],
    },
    {
      id: 'csub-ct-03',
      engineerId: 'eng-andreas',
      engineerName: 'Andreas Keller',
      modelName: 'meralion v2 baseline',
      baseFamily: 'meralion',
      wer: 0.152,
      cer: 0.081,
      rtf: 0.38,
      submissionCount: 2,
      submittedAt: '2026-04-14T17:32:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: false },
      worstExamples: [],
    },
    {
      ...BASELINE_COMMON,
      id: 'csub-ct-baseline',
      wer: 0.211,
      cer: 0.118,
      rtf: 0.59,
    },
  ],
  'custom-multispeaker-hard': [
    {
      id: 'csub-ms-01',
      engineerId: 'u2',
      engineerName: 'Engineer User',
      modelName: 'whisper-lg-v3 + lora r16 + pyannote',
      baseFamily: 'whisper',
      wer: 0.127,
      cer: 0.068,
      rtf: 0.52,
      submissionCount: 3,
      submittedAt: '2026-04-16T22:55:00Z',
      reproducibility: { config: true, checkpoint: true, notebook: true },
      worstExamples: [
        { id: 'wx-ms-1', refText: 'okay so the action item is — wait, can you repeat that', predText: 'okay so the action item is wait can you repeat that', utteranceWer: 0.18 },
      ],
    },
    {
      id: 'csub-ms-02',
      engineerId: 'eng-james',
      engineerName: 'James Whitmore',
      modelName: 'wav2vec2-xls-r + diarize',
      baseFamily: 'wav2vec2',
      wer: 0.134,
      cer: 0.071,
      rtf: 0.34,
      submissionCount: 2,
      submittedAt: '2026-04-15T08:18:00Z',
      reproducibility: { config: true, checkpoint: false, notebook: false },
      worstExamples: [],
    },
    {
      ...BASELINE_COMMON,
      id: 'csub-ms-baseline',
      wer: 0.179,
      cer: 0.097,
      rtf: 0.63,
    },
  ],
};

export function getCustomMockLeaderboardDatasets() {
  return MOCK_CUSTOM_DATASETS;
}

export function getCustomMockLeaderboard(datasetId) {
  const rows = CUSTOM_SUBMISSIONS_BY_DATASET[datasetId] || [];
  const sorted = [...rows].sort((a, b) => a.wer - b.wer);
  return sorted.map((row, idx) => ({ ...row, rank: idx + 1 }));
}

export function hasCustomMockLeaderboard(datasetId) {
  return Object.prototype.hasOwnProperty.call(CUSTOM_SUBMISSIONS_BY_DATASET, datasetId);
}
