import { describe, it, expect } from 'vitest';

import {
    formatMetricValue,
    mergeMetricWithLive,
    mergeMetricsWithLive,
} from '../services/live-dashboard-metrics';


describe('formatMetricValue', () => {
    it('formats percentages with one decimal + suffix', () => {
        // Note: JS toFixed uses banker's rounding for .x5 — 95.85 → "95.8".
        expect(formatMetricValue(95.8, '%')).toBe('95.8%');
        expect(formatMetricValue(95.83, '%')).toBe('95.8%');
        expect(formatMetricValue(95.86, '%')).toBe('95.9%');
    });
    it('formats milliseconds as integer', () => {
        expect(formatMetricValue(412.4, 'ms')).toBe('412ms');
    });
    it('formats k/hr with one decimal', () => {
        expect(formatMetricValue(2.4, 'k/hr')).toBe('2.4k/hr');
    });
    it('returns em-dash for null / nonfinite', () => {
        expect(formatMetricValue(null, '%')).toBe('—');
        expect(formatMetricValue(undefined, '%')).toBe('—');
        expect(formatMetricValue(NaN, '%')).toBe('—');
    });
});


const mockMetric = {
    id: 'overall_accuracy',
    name: 'Overall Accuracy',
    value: '94.0%',
    sublabel: '+0.0% difference',
    accent: true,
    series: {
        baseModel: [89.2, 89.4, 89.6, 89.8, 90.0],
        fineTuned: [94.0, 94.0, 94.0, 94.0, 94.0],
        unit: '%',
        yMin: 85,
        yMax: 100,
        currentValue: 94.0,
        difference: '+0.0%',
    },
};


describe('mergeMetricWithLive', () => {
    it('returns the mock unchanged when no live metric exists', () => {
        expect(mergeMetricWithLive(mockMetric, undefined)).toBe(mockMetric);
    });

    it('overlays live finetuned value, sublabel and series arrays', () => {
        const live = {
            strategy_name: 'overall_accuracy',
            base_value: 90.0,
            finetuned_value: 95.8,
            delta: 5.8,
            base_series: [
                { evaluated_at: 't1', value: 89.2 },
                { evaluated_at: 't2', value: 90.0 },
            ],
            finetuned_series: [
                { evaluated_at: 't1', value: 94.9 },
                { evaluated_at: 't2', value: 95.8 },
            ],
        };
        const merged = mergeMetricWithLive(mockMetric, live);
        expect(merged.value).toBe('95.8%');
        expect(merged.sublabel).toBe('+5.8% difference');
        expect(merged.series.baseModel).toEqual([89.2, 90.0]);
        expect(merged.series.fineTuned).toEqual([94.9, 95.8]);
        expect(merged.series.currentValue).toBe(95.8);
        // Bounds + unit preserved from mock metadata.
        expect(merged.series.yMin).toBe(85);
        expect(merged.series.unit).toBe('%');
    });

    it('keeps mock series array when live series is empty', () => {
        const live = {
            strategy_name: 'overall_accuracy',
            base_value: 90.0,
            finetuned_value: 95.8,
            delta: 5.8,
            base_series: [],
            finetuned_series: [],
        };
        const merged = mergeMetricWithLive(mockMetric, live);
        expect(merged.series.baseModel).toEqual([89.2, 89.4, 89.6, 89.8, 90.0]);
        expect(merged.series.fineTuned).toEqual([94.0, 94.0, 94.0, 94.0, 94.0]);
    });

    it('handles negative deltas (lower-is-better metrics)', () => {
        const merged = mergeMetricWithLive(
            { ...mockMetric, series: { ...mockMetric.series, unit: 'ms' } },
            {
                strategy_name: 'latency_p95',
                base_value: 520,
                finetuned_value: 412,
                delta: -108,
                base_series: [],
                finetuned_series: [],
            },
        );
        expect(merged.value).toBe('412ms');
        expect(merged.sublabel).toBe('-108ms difference');
    });
});


describe('mergeMetricsWithLive', () => {
    it('matches by id and leaves unmatched mock metrics untouched', () => {
        const mocks = [mockMetric, { id: 'unmatched', value: 'mock', series: { unit: '%' } }];
        const api = {
            metrics: [
                {
                    strategy_name: 'overall_accuracy',
                    base_value: 90, finetuned_value: 95.8, delta: 5.8,
                    base_series: [], finetuned_series: [],
                },
            ],
        };
        const merged = mergeMetricsWithLive(mocks, api);
        expect(merged[0].value).toBe('95.8%');
        expect(merged[1]).toEqual({ id: 'unmatched', value: 'mock', series: { unit: '%' } });
    });

    it('passes through the mock list when api response is null', () => {
        const mocks = [mockMetric];
        expect(mergeMetricsWithLive(mocks, null)).toBe(mocks);
    });
});
