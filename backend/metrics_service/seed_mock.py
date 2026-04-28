"""Seed metrics.db with the 14 dashboard metrics from the FE mock.

Mirrors `frontend/src/services/mock_data-dashboard.js` so the dashboard
renders before any real training run has populated the store. Idempotent:
re-running first deletes everything tagged with notes='seed:mock', then
re-inserts.

Usage:
    METRICS_DB_PATH=/app/data/metrics.db python seed_mock.py

When running locally outside docker, point METRICS_DB_PATH at a writable
file path.

Module reference: docs/06 server/metrics-service-module.md §5.
"""

from __future__ import annotations

import argparse
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Sequence

from storage import MetricsStore
from strategies.base import StrategyResult


log = logging.getLogger(__name__)

SEED_NOTE = "seed:mock"
DEFAULT_BASE_MODEL = "openai/whisper-large-v3-turbo"
DEFAULT_ADAPTER_NAME = "fypaudio-W-lv3t"
DEFAULT_ADAPTER_VERSION = "seed"
DEFAULT_DATASET_NAME = "default_eval"
DEFAULT_SAMPLE_COUNT = 500

# Series mirror the `series.{baseModel, fineTuned}` arrays in
# frontend/src/services/mock_data-dashboard.js. Each strategy has a 5-day
# trajectory for both the base and the fine-tuned model. Values are stored
# in the same units the FE renders (percentage 0-100, ms, k/hr); the FE
# knows the per-metric unit via mock_data-metrics-metadata.js.
SERIES: Dict[str, Dict[str, Sequence[float]]] = {
    "overall_accuracy":       {"base": [89.2, 89.4, 89.6, 89.8, 90.0], "ft": [94.9, 95.2, 95.4, 95.7, 95.8]},
    "english_accuracy":       {"base": [92.5, 92.7, 92.9, 93.1, 93.3], "ft": [96.4, 96.6, 96.8, 97.0, 97.2]},
    "mandarin_accuracy":      {"base": [82.1, 82.4, 82.7, 83.0, 83.2], "ft": [92.8, 93.0, 93.3, 93.6, 93.9]},
    "financial_term_accuracy":{"base": [88.9, 89.1, 89.3, 89.5, 89.7], "ft": [97.5, 97.7, 97.9, 98.2, 98.4]},
    "speaker_diarization":    {"base": [85.1, 85.3, 85.5, 85.7, 85.9], "ft": [90.1, 90.4, 90.7, 91.0, 91.2]},
    "punctuation_accuracy":   {"base": [90.3, 90.5, 90.7, 90.8, 91.0], "ft": [95.9, 96.1, 96.3, 96.5, 96.7]},
    "latency_p95":            {"base": [520, 510, 505, 498, 492],       "ft": [450, 438, 428, 418, 412]},
    "throughput":             {"base": [1.8, 1.85, 1.9, 1.95, 2.0],     "ft": [2.2, 2.25, 2.3, 2.35, 2.4]},
    "weighted_wer":           {"base": [9.8, 9.1, 8.4, 7.6, 7.1],       "ft": [6.2, 5.5, 5.0, 4.7, 4.3]},
    "language_cer":           {"base": [5.9, 5.6, 5.2, 4.8, 4.4],       "ft": [3.8, 3.5, 3.2, 2.9, 2.7]},
    "code_switch_pier":       {"base": [22.4, 21.1, 19.8, 18.9, 18.2],  "ft": [16.9, 15.6, 14.6, 13.7, 12.8]},
    "word_diarization_error": {"base": [14.8, 14.1, 13.5, 12.9, 12.4],  "ft": [11.2, 10.4, 9.6, 8.9, 8.4]},
    "entity_f1":              {"base": [86.1, 86.4, 86.8, 87.1, 87.4], "ft": [91.4, 92.0, 92.6, 93.1, 93.6]},
    "sequence_match_rate":    {"base": [93.8, 94.1, 94.4, 94.7, 95.0], "ft": [97.8, 98.1, 98.3, 98.5, 98.7]},
}

DAYS_PER_SERIES = 5


def _timestamps(end: datetime) -> List[str]:
    # Newest at the end of the array, mirroring the mock's left-to-right
    # "older → newer" series ordering. UTC, second-precision ISO 8601.
    return [
        (end - timedelta(days=DAYS_PER_SERIES - 1 - i)).strftime("%Y-%m-%dT%H:%M:%SZ")
        for i in range(DAYS_PER_SERIES)
    ]


def _results_for_day(day_index: int, role: str) -> List[StrategyResult]:
    out: List[StrategyResult] = []
    for strategy_name, series in SERIES.items():
        out.append(
            StrategyResult(
                strategy_name=strategy_name,
                value=float(series[role][day_index]),
                breakdown={"source": "seed:mock", "day_index": day_index},
                sample_count=DEFAULT_SAMPLE_COUNT,
            )
        )
    return out


def seed(
    store: MetricsStore,
    *,
    base_model: str = DEFAULT_BASE_MODEL,
    adapter_name: str = DEFAULT_ADAPTER_NAME,
    adapter_version: str = DEFAULT_ADAPTER_VERSION,
    dataset_name: str = DEFAULT_DATASET_NAME,
    end: datetime | None = None,
) -> int:
    """Seed the store. Returns the total number of evaluations created."""
    end = end or datetime.now(timezone.utc).replace(microsecond=0, tzinfo=timezone.utc)

    removed = store.delete_evaluations_with_notes(SEED_NOTE)
    if removed:
        log.info("seed: cleared %s previously seeded evaluation(s)", removed)

    timestamps = _timestamps(end)
    created = 0
    for day_index, ts in enumerate(timestamps):
        # Baseline row (adapter_name = NULL).
        store.record_evaluation(
            base_model=base_model,
            adapter_name=None,
            adapter_version=None,
            dataset_name=dataset_name,
            sample_count=DEFAULT_SAMPLE_COUNT,
            results=_results_for_day(day_index, "base"),
            evaluated_at=ts,
            notes=SEED_NOTE,
        )
        created += 1

        # Fine-tuned row (the same adapter for all 5 days, so the dashboard
        # has a coherent "this adapter's trajectory" line — not five
        # versions of the same adapter).
        store.record_evaluation(
            base_model=base_model,
            adapter_name=adapter_name,
            adapter_version=adapter_version,
            dataset_name=dataset_name,
            sample_count=DEFAULT_SAMPLE_COUNT,
            results=_results_for_day(day_index, "ft"),
            evaluated_at=ts,
            notes=SEED_NOTE,
        )
        created += 1

    log.info(
        "seed: wrote %s evaluations (%s strategies × %s days × 2 roles)",
        created,
        len(SERIES),
        DAYS_PER_SERIES,
    )
    return created


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Seed metrics.db with mock dashboard data.")
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--adapter-name", default=DEFAULT_ADAPTER_NAME)
    parser.add_argument("--adapter-version", default=DEFAULT_ADAPTER_VERSION)
    parser.add_argument("--dataset-name", default=DEFAULT_DATASET_NAME)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    store = MetricsStore()
    seed(
        store,
        base_model=args.base_model,
        adapter_name=args.adapter_name,
        adapter_version=args.adapter_version,
        dataset_name=args.dataset_name,
    )


if __name__ == "__main__":
    main()
