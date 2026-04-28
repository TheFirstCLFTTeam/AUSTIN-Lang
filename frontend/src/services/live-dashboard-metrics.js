'use client';

// Live dashboard merge layer.
//
// The dashboard page used to render purely from mock_data-dashboard.js
// (AVAILABLE_METRICS). Now the metrics service supplies the same shape
// of data — but we keep the mock as the **schema definition** (what
// metrics exist, their display units, chart bounds) and overlay live
// values from the API on top.
//
// In mock mode (NEXT_PUBLIC_MOCK_API=true) the hook is a no-op and the
// dashboard renders pure mock — same behaviour as before. In real mode
// the hook fetches /api/metrics/by-dataset?series_points=5 and merges.
// On any backend failure we fall back to mock so the page never breaks.

import { useEffect, useState } from 'react';

import { fetchMetricsByDataset } from './metrics';

const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_API === 'true';

export const DEFAULT_DATASET_NAME = 'default_eval';
export const DEFAULT_BASE_MODEL = 'openai/whisper-large-v3-turbo';
export const DEFAULT_SERIES_POINTS = 5;

// Format a raw metric value for the KPI card. The unit determines display:
// %, ms, k/hr fall through to the existing mock conventions.
//
// Percentage scale convention: the dashboard mock uses 0-100 (e.g. 97.2)
// for any card with `unit: "%"`, but the strategies in
// metrics_service/strategies/ follow the ML-literature convention of
// returning fractions (0.0–1.0) for WER/CER/F1/accuracy. We bridge here:
// when the unit is "%" and the value is in [0, 1.0001], scale by 100
// before formatting. The 1.0001 epsilon keeps a strategy that
// genuinely hits 1.0 from being misclassified as a "this is already
// 0-100" value sitting at 100 (still scales correctly to "100.0%").
// Anything > 1.0001 is assumed already-scaled (e.g. RTF, latency
// ratios mistakenly given a "%" unit).
export function formatMetricValue(value, unit) {
    if (value == null || !Number.isFinite(value)) return '—';
    if (unit === '%') {
        const scaled = (value >= 0 && value <= 1.0001) ? value * 100 : value;
        return `${scaled.toFixed(1)}%`;
    }
    if (unit === 'ms') return `${Math.round(value)}ms`;
    if (unit === 'k/hr') return `${value.toFixed(1)}k/hr`;
    return String(value);
}

// "+0.3% difference" / "-18ms difference" / "+0.4k/hr difference".
function formatSublabel(delta, unit, lowerIsBetter) {
    if (delta == null || !Number.isFinite(delta)) return null;
    // Same fraction → percentage scaling as formatMetricValue. The
    // 1.0001 ceiling is symmetric on the negative side so a delta of
    // -0.005 (improvement of 0.5 percentage points) renders as
    // "-0.5% difference", not "-0.0% difference".
    let scaledDelta = delta;
    if (unit === '%' && Math.abs(delta) <= 1.0001) {
        scaledDelta = delta * 100;
    }
    const sign = scaledDelta > 0 ? '+' : '';
    if (unit === '%') return `${sign}${scaledDelta.toFixed(1)}% difference`;
    if (unit === 'ms') return `${sign}${Math.round(scaledDelta)}ms difference`;
    if (unit === 'k/hr') return `${sign}${scaledDelta.toFixed(2)}k/hr difference`;
    return `${sign}${scaledDelta.toFixed(2)} difference`;
    // lowerIsBetter is intentionally not used in the label text — the sign
    // already encodes direction; the renderer's accent colour can flip
    // based on that field if/when we want red-for-up.
}

// Build a strategy_name -> live-metric map from the API response.
function indexLiveMetrics(apiResponse) {
    const out = new Map();
    for (const m of apiResponse?.metrics || []) {
        out.set(m.strategy_name, m);
    }
    return out;
}

// Merge a single mock metric with its live counterpart. When the live
// row exists, override `value`, `sublabel`, `series.{baseModel,fineTuned,
// currentValue,difference}`. Other fields (id, name, description, unit,
// yMin, yMax, target) are preserved from the mock/metadata join.
export function mergeMetricWithLive(mockMetric, liveMetric) {
    if (!liveMetric) return mockMetric;
    const unit = mockMetric?.series?.unit ?? '%';
    const baseSeries = (liveMetric.base_series || []).map((p) => p.value);
    const ftSeries = (liveMetric.finetuned_series || []).map((p) => p.value);

    const finetunedValue = liveMetric.finetuned_value;
    const delta = liveMetric.delta;

    const merged = {
        ...mockMetric,
        value: formatMetricValue(finetunedValue, unit),
        sublabel: formatSublabel(delta, unit) ?? mockMetric.sublabel,
    };
    if (mockMetric.series) {
        merged.series = {
            ...mockMetric.series,
            baseModel: baseSeries.length ? baseSeries : mockMetric.series.baseModel,
            fineTuned: ftSeries.length ? ftSeries : mockMetric.series.fineTuned,
            currentValue: finetunedValue ?? mockMetric.series.currentValue,
            difference: formatSublabel(delta, unit) ?? mockMetric.series.difference,
        };
    }
    return merged;
}

export function mergeMetricsWithLive(mockMetrics, apiResponse) {
    if (!apiResponse) return mockMetrics;
    const live = indexLiveMetrics(apiResponse);
    return mockMetrics.map((m) => mergeMetricWithLive(m, live.get(m.id)));
}

// React hook: returns { liveData, isLoading, error }. liveData is the
// raw API response (or null). The caller then runs mergeMetricsWithLive.
//
// In mock mode, no fetch happens — { liveData: null, isLoading: false }.
export function useDashboardSeries({
    dataset = DEFAULT_DATASET_NAME,
    baseModel = DEFAULT_BASE_MODEL,
    seriesPoints = DEFAULT_SERIES_POINTS,
} = {}) {
    const [liveData, setLiveData] = useState(null);
    const [isLoading, setIsLoading] = useState(!MOCK_MODE);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (MOCK_MODE) return;
        let cancelled = false;
        setIsLoading(true);
        fetchMetricsByDataset({ dataset, baseModel, seriesPoints })
            .then((data) => {
                if (cancelled) return;
                setLiveData(data);
                setError(null);
            })
            .catch((err) => {
                if (cancelled) return;
                // 404 = no metrics recorded yet; treat as "no live data"
                // rather than an error so the dashboard renders mock.
                if (err?.status === 404) {
                    setLiveData(null);
                } else {
                    console.warn('useDashboardSeries: fetch failed, falling back to mock', err);
                    setError(err);
                }
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [dataset, baseModel, seriesPoints]);

    return { liveData, isLoading, error };
}
