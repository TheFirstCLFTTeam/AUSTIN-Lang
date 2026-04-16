// Mock data for the metrics dashboard. All metrics are accuracy-style (higher
// is better), so positive deltas always indicate improvement.

// Each entry here carries the runtime display data for a metric: its latest
// value, headline sublabel, and 5-day `series` used by the chart. Descriptive
// metadata (name, description, source script) lives in
// `mock_data-metrics-metadata.js` and is joined by `id`.
export const AVAILABLE_METRICS = [
  {
    id: "overall_accuracy",
    value: "95.8%",
    sublabel: "+0.3% difference",
    accent: true,
    series: {
      baseModel: [89.2, 89.4, 89.6, 89.8, 90.0],
      fineTuned: [94.9, 95.2, 95.4, 95.7, 95.8],
      yMin: 85,
      yMax: 100,
      unit: "%",
      target: 97.5,
      currentValue: 95.8,
      difference: "+18.4%",
    },
  },
  {
    id: "english_accuracy",
    value: "97.2%",
    sublabel: "+0.8% difference",
    series: {
      baseModel: [92.5, 92.7, 92.9, 93.1, 93.3],
      fineTuned: [96.4, 96.6, 96.8, 97.0, 97.2],
      yMin: 90,
      yMax: 100,
      unit: "%",
      target: 98.5,
      currentValue: 97.2,
      difference: "+3.9%",
    },
  },
  {
    id: "mandarin_accuracy",
    value: "93.9%",
    sublabel: "+0.2% difference",
    series: {
      baseModel: [82.1, 82.4, 82.7, 83.0, 83.2],
      fineTuned: [92.8, 93.0, 93.3, 93.6, 93.9],
      yMin: 78,
      yMax: 100,
      unit: "%",
      target: 96.0,
      currentValue: 93.9,
      difference: "+10.7%",
    },
  },
  {
    id: "financial_term_accuracy",
    value: "98.4%",
    sublabel: "+1.2% since last retrain",
    series: {
      baseModel: [88.9, 89.1, 89.3, 89.5, 89.7],
      fineTuned: [97.5, 97.7, 97.9, 98.2, 98.4],
      yMin: 85,
      yMax: 100,
      unit: "%",
      target: 99.0,
      currentValue: 98.4,
      difference: "+8.7%",
    },
  },
  {
    id: "speaker_diarization",
    value: "91.2%",
    sublabel: "+0.5% difference",
    series: {
      baseModel: [85.1, 85.3, 85.5, 85.7, 85.9],
      fineTuned: [90.1, 90.4, 90.7, 91.0, 91.2],
      yMin: 80,
      yMax: 100,
      unit: "%",
      target: 94.0,
      currentValue: 91.2,
      difference: "+5.3%",
    },
  },
  {
    id: "punctuation_accuracy",
    value: "96.7%",
    sublabel: "+0.4% difference",
    series: {
      baseModel: [90.3, 90.5, 90.7, 90.8, 91.0],
      fineTuned: [95.9, 96.1, 96.3, 96.5, 96.7],
      yMin: 85,
      yMax: 100,
      unit: "%",
      target: 98.0,
      currentValue: 96.7,
      difference: "+5.7%",
    },
  },
  {
    id: "latency_p95",
    value: "412ms",
    sublabel: "-18ms difference",
    series: {
      baseModel: [520, 510, 505, 498, 492],
      fineTuned: [450, 438, 428, 418, 412],
      yMin: 350,
      yMax: 600,
      unit: "ms",
      target: 400,
      currentValue: 412,
      difference: "-108ms",
    },
  },
  {
    id: "throughput",
    value: "2.4k/hr",
    sublabel: "+120 difference",
    series: {
      baseModel: [1.8, 1.85, 1.9, 1.95, 2.0],
      fineTuned: [2.2, 2.25, 2.3, 2.35, 2.4],
      yMin: 1.5,
      yMax: 3.0,
      unit: "k/hr",
      target: 3.0,
      currentValue: 2.4,
      difference: "+0.4k/hr",
    },
  },
];

export const DEFAULT_SELECTED_METRIC_IDS = [
  "overall_accuracy",
  "english_accuracy",
  "mandarin_accuracy",
  "financial_term_accuracy",
];

export const MAX_SELECTED_METRICS = 4;

export const MOCK_CRITICAL_TERM_FAILURES = [
  { term: "Amortization", edits: 412 },
  { term: "Liquidity Trap", edits: 208 },
  { term: "Fiduciary Duty", edits: 194 },
];

export const MOCK_ACCURACY_LOGS = [
  { id: "TRN-9403-B", title: "Q3 Earnings Boardroom", dur: "634 hrs", editor: "J. Chen", accuracy: "87.6", change: -1.2 },
  { id: "TRN-7718-A", title: "Risk Assessment Alpha", dur: "198 hrs", editor: "M. Wisse", accuracy: "91.1", change: 0.8 },
  { id: "TRN-4603-D", title: "Compliance Policy Update", dur: "848 hrs", editor: "E. Kim", accuracy: "84.9", change: -2.4 },
];
