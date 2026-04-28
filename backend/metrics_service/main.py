from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import time
from typing import Any, Dict, List, Optional, Tuple
from dotenv import load_dotenv
from pydantic import BaseModel, Field

from db_consumer import fetch_bulk_context, fetch_file_context
from calculator import aggregate_metrics, calculate_wer
from inference_client import (
    InferenceFanoutError,
    fan_out as run_inference_fanout,
    split_samples_needing_inference,
)
from storage import MetricsStore
from strategies import MetricsRunner, list_strategies
from strategies.base import Sample
from manifest_loader import load_manifest, ManifestError
from adapter_meta import default_adapters_dir, get_base_model
from seed_mock import seed as seed_mock_data

load_dotenv()

app = FastAPI(title="AUSTIN-Lang Metrics Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In prod, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple In-Memory Cache for the operational dashboard endpoint.
cache = {
    "dashboard_data": None,
    "last_updated": 0
}
CACHE_TTL = 60 # Seconds

# Singletons. ADAPTERS_DIR is read once at boot — the post-train hook in
# train.py writes adapters to a path that's mounted into both this service
# and transcription-service-2 (see docs/06 server/metrics-service-module.md §7).
store = MetricsStore()
ADAPTERS_DIR = default_adapters_dir()


@app.on_event("startup")
def _maybe_seed_on_boot() -> None:
    """Seed metrics.db with the FE dashboard mock when the DB is empty.

    Controlled by SEED_ON_BOOT (default "true"). The empty-DB check means
    re-running compose against a populated `metrics_data` volume is a no-op
    — only a fresh volume gets seeded. See
    docs/06 server/metrics-service-module.md §5.3.
    """
    if os.getenv("SEED_ON_BOOT", "true").lower() not in ("1", "true", "yes"):
        return
    if store.list_evaluations(limit=1):
        return
    try:
        created = seed_mock_data(store)
        print(f"metrics-service: seeded {created} mock evaluations on first boot")
    except Exception as err:
        print(f"metrics-service: seed-on-boot failed (non-fatal): {err}")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class RunEvaluationRequest(BaseModel):
    adapter_name: str
    dataset_name: str
    manifest_path: str
    strategies: List[str] = Field(default_factory=lambda: ["f1"])
    base_model: Optional[str] = None
    adapter_version: Optional[str] = None
    notes: Optional[str] = None


class RunBaselineRequest(BaseModel):
    base_model: str
    dataset_name: str
    manifest_path: str
    strategies: List[str] = Field(default_factory=lambda: ["f1"])
    notes: Optional[str] = None
    # When True, skip the freshness short-circuit and always run the
    # baseline. Use sparingly — the whole point of the freshness check
    # is that base-model evaluations are slow (full inference pass on
    # the dataset) and the value rarely shifts day-to-day. Default
    # False so the post-train hook can call us unconditionally and
    # we'll do the right thing.
    force: bool = False


class BaselineFreshnessResponse(BaseModel):
    """Returned when `/evaluations/baseline` short-circuits because a
    fresh baseline already exists. The `evaluation_id` of the existing
    row is returned so the caller can link to it; `skipped=True` is the
    discriminator (a real run returns the standard EvaluationResponse).
    """
    skipped: bool = True
    reason: str
    evaluation_id: int
    base_model: str
    dataset_name: str
    age_days: float


class MetricResultResponse(BaseModel):
    strategy_name: str
    value: float
    breakdown: Dict[str, Any]
    sample_count: int


class EvaluationResponse(BaseModel):
    id: int
    base_model: str
    adapter_name: Optional[str]
    adapter_version: Optional[str]
    dataset_name: str
    evaluated_at: str
    sample_count: int
    status: str
    notes: Optional[str]
    metrics: List[MetricResultResponse]


class EvaluationListItem(BaseModel):
    id: int
    base_model: str
    adapter_name: Optional[str]
    adapter_version: Optional[str]
    dataset_name: str
    evaluated_at: str
    sample_count: int
    status: str


class SeriesPoint(BaseModel):
    evaluated_at: str
    value: float


class MetricPairResponse(BaseModel):
    strategy_name: str
    base_value: Optional[float]
    base_evaluated_at: Optional[str]
    finetuned_value: Optional[float]
    finetuned_evaluated_at: Optional[str]
    finetuned_adapter_name: Optional[str]
    finetuned_adapter_version: Optional[str]
    delta: Optional[float]
    base_series: List[SeriesPoint] = Field(default_factory=list)
    finetuned_series: List[SeriesPoint] = Field(default_factory=list)


class ByDatasetResponse(BaseModel):
    base_model: str
    dataset_name: str
    metrics: List[MetricPairResponse]


class LeaderboardRowResponse(BaseModel):
    rank: int
    base_model: str
    base_family: Optional[str]
    adapter_name: Optional[str]
    adapter_version: Optional[str]
    model_name: str
    submitted_by: Optional[str]
    training_job_id: Optional[str]
    evaluation_id: int
    evaluated_at: str
    wer: Optional[float]
    cer: Optional[float]
    rtf: Optional[float]


class LeaderboardResponse(BaseModel):
    dataset_id: str
    base_family: Optional[str]
    rows: List[LeaderboardRowResponse]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_evaluation_response(evaluation_id: int) -> EvaluationResponse:
    record = store.get_evaluation(evaluation_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"evaluation {evaluation_id} not found")
    metrics = store.list_metrics_for_evaluation(evaluation_id)
    return EvaluationResponse(
        id=record.id,
        base_model=record.base_model,
        adapter_name=record.adapter_name,
        adapter_version=record.adapter_version,
        dataset_name=record.dataset_name,
        evaluated_at=record.evaluated_at,
        sample_count=record.sample_count,
        status=record.status,
        notes=record.notes,
        metrics=[
            MetricResultResponse(
                strategy_name=m.strategy_name,
                value=m.value,
                breakdown=m.breakdown,
                sample_count=m.sample_count,
            )
            for m in metrics
        ],
    )


def _run_strategies(strategy_names: List[str], samples):
    if not strategy_names:
        raise HTTPException(status_code=400, detail="strategies must not be empty")
    try:
        runner = MetricsRunner(strategy_names)
    except KeyError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return runner.run(samples)


def _load_samples(manifest_path: str):
    try:
        return load_manifest(manifest_path)
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except ManifestError as err:
        raise HTTPException(status_code=400, detail=str(err))


def _fill_in_hypotheses(
    samples: List[Sample],
    *,
    adapter_name: Optional[str],
) -> Tuple[List[Sample], int, int]:
    """Walk `samples`, identify those without a hypothesis, fan out to
    transcription-service-2, and return a new list with the predictions
    stitched in. Returns `(samples, fanout_attempted, fanout_failed)`
    so the caller can stash the counters in the evaluation `notes`.

    Raises `HTTPException(400)` when a sample without a hypothesis also
    lacks `audio_path` — the manifest is then ill-formed.
    """
    try:
        have_hyp, need = split_samples_needing_inference(samples)
    except InferenceFanoutError as err:
        raise HTTPException(status_code=err.status_code, detail=str(err))
    if not need:
        return list(samples), 0, 0

    audio_paths = [s.audio_path for s in need]
    predictions = run_inference_fanout(
        audio_paths, adapter_name=adapter_name,
    )
    failed = 0
    out: List[Sample] = list(have_hyp)
    for s in need:
        text = predictions.get(s.audio_path)
        if text is None:
            failed += 1
        # Reconstruct the dataclass with the new hypothesis. `Sample`
        # is frozen so we round-trip via dataclasses.replace.
        out.append(_replace_hypothesis(s, text))
    # Preserve original order so test fixtures compare cleanly.
    audio_to_index = {s.audio_path: i for i, s in enumerate(samples)}
    out.sort(key=lambda s: audio_to_index.get(s.audio_path, 0))
    return out, len(need), failed


def _replace_hypothesis(sample: Sample, hypothesis: Optional[str]) -> Sample:
    """`Sample` is a frozen dataclass so we can't mutate in place.
    Manual rebuild keeps the field set explicit — when Sample grows a
    new optional field it has to be added here too. Trade-off vs.
    `dataclasses.replace`: this surfaces the field list at review time
    instead of letting an unaware reader skip past a `replace()` call."""
    return Sample(
        reference=sample.reference,
        hypothesis=hypothesis,
        audio_path=sample.audio_path,
        critical_terms=sample.critical_terms,
        info_values=sample.info_values,
        language=sample.language,
        entity_spans=sample.entity_spans,
        speakers=sample.speakers,
        hypothesis_speakers=sample.hypothesis_speakers,
        language_spans=sample.language_spans,
        tags=sample.tags,
    )


# ---------------------------------------------------------------------------
# Operational endpoints (existing — unchanged behaviour)
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "strategies": list_strategies(),
    }

@app.get("/metrics/dashboard")
async def get_dashboard():
    """Returns aggregated metrics with 60s caching."""
    now = time.time()
    if cache["dashboard_data"] and (now - cache["last_updated"] < CACHE_TTL):
        return cache["dashboard_data"]

    try:
        data = await fetch_bulk_context()
        metrics = aggregate_metrics(data)

        if metrics["latest_wer"] is not None:
            metrics["needs_attention"] = metrics["latest_wer"] > 0.20
        else:
            metrics["needs_attention"] = False

        cache["dashboard_data"] = metrics
        cache["last_updated"] = now
        return metrics
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch metrics: {str(e)}")

@app.get("/metrics/accuracy/{file_id}")
async def get_file_accuracy(file_id: int):
    """Calculates detailed WER for a specific file."""
    try:
        item = await fetch_file_context(file_id)
        raw = item.get("raw_text") or ""
        edited = item.get("edited_text") or ""

        if not item.get("is_user_edited"):
             return {
                "file_id": file_id,
                "wer": None,
                "status": "pending_edit",
                "message": "File has not been edited yet."
            }

        wer = calculate_wer(edited, raw)
        return {
            "file_id": file_id,
            "wer": wer,
            "raw_text_preview": raw[:100] + "..." if len(raw) > 100 else raw,
            "edited_text_preview": edited[:100] + "..." if len(edited) > 100 else edited
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Database fetch failed: {str(e)}")

@app.post("/metrics/refresh")
async def refresh_cache():
    """Clears the in-memory cache."""
    cache["dashboard_data"] = None
    cache["last_updated"] = 0
    return {"message": "Cache cleared"}


# ---------------------------------------------------------------------------
# Evaluation endpoints (new)
# ---------------------------------------------------------------------------

@app.post("/evaluations/run", response_model=EvaluationResponse)
async def run_evaluation(req: RunEvaluationRequest):
    if req.base_model:
        base_model = req.base_model
    else:
        try:
            base_model = get_base_model(req.adapter_name, ADAPTERS_DIR)
        except FileNotFoundError as err:
            raise HTTPException(status_code=404, detail=str(err))
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))

    samples = _load_samples(req.manifest_path)
    samples, fanout_attempted, fanout_failed = _fill_in_hypotheses(
        samples, adapter_name=req.adapter_name,
    )
    results = _run_strategies(req.strategies, samples)

    notes = req.notes
    if fanout_attempted > 0:
        suffix = (
            f"[fanout: {fanout_attempted} clips inferred, "
            f"{fanout_failed} failed]"
        )
        notes = f"{notes} {suffix}".strip() if notes else suffix

    evaluation_id = store.record_evaluation(
        base_model=base_model,
        adapter_name=req.adapter_name,
        adapter_version=req.adapter_version,
        dataset_name=req.dataset_name,
        sample_count=len(samples),
        results=results.values(),
        notes=notes,
    )
    return _build_evaluation_response(evaluation_id)


@app.post("/evaluations/baseline")
async def run_baseline(req: RunBaselineRequest):
    """Run a base-model (no-adapter) evaluation for the given dataset.

    Honours `METRICS_BASELINE_FRESHNESS_DAYS` (default 30): if the
    latest base-only row for `(base_model, dataset_name)` is younger
    than the threshold, the request short-circuits with
    `BaselineFreshnessResponse` instead of re-running the (expensive)
    inference pass. Pass `force=true` to override.

    Response shape is one of:
      - `EvaluationResponse` (a real run happened — same as
        `/evaluations/run`)
      - `BaselineFreshnessResponse` (skipped — discriminate via the
        `skipped: true` field)
    """
    if not req.force:
        freshness_days = float(os.getenv("METRICS_BASELINE_FRESHNESS_DAYS", 30))
        age = store.latest_baseline_age_days(
            base_model=req.base_model, dataset_name=req.dataset_name,
        )
        if age is not None and age <= freshness_days:
            # Pull the row id so the caller can deep-link it. Cheap —
            # one indexed read.
            existing = store.list_evaluations(
                base_model=req.base_model,
                adapter_name="__base__",
                dataset_name=req.dataset_name,
                limit=1,
            )
            if existing:
                return BaselineFreshnessResponse(
                    skipped=True,
                    reason=(
                        f"latest baseline is {age:.1f} days old "
                        f"(within {freshness_days}-day freshness window)"
                    ),
                    evaluation_id=existing[0].id,
                    base_model=req.base_model,
                    dataset_name=req.dataset_name,
                    age_days=age,
                )

    samples = _load_samples(req.manifest_path)
    # Baseline fan-out passes `adapter_name=None` so transcription-
    # service-2's `domain` field falls through to "base" (no LoRA).
    samples, fanout_attempted, fanout_failed = _fill_in_hypotheses(
        samples, adapter_name=None,
    )
    results = _run_strategies(req.strategies, samples)

    notes = req.notes
    if fanout_attempted > 0:
        suffix = (
            f"[fanout: {fanout_attempted} clips inferred, "
            f"{fanout_failed} failed]"
        )
        notes = f"{notes} {suffix}".strip() if notes else suffix

    evaluation_id = store.record_evaluation(
        base_model=req.base_model,
        adapter_name=None,
        adapter_version=None,
        dataset_name=req.dataset_name,
        sample_count=len(samples),
        results=results.values(),
        notes=notes,
    )
    return _build_evaluation_response(evaluation_id)


@app.get("/evaluations", response_model=List[EvaluationListItem])
async def list_evaluations(
    base_model: Optional[str] = None,
    adapter: Optional[str] = None,
    dataset: Optional[str] = None,
    limit: int = 100,
):
    records = store.list_evaluations(
        base_model=base_model,
        adapter_name=adapter,
        dataset_name=dataset,
        limit=limit,
    )
    return [
        EvaluationListItem(
            id=r.id,
            base_model=r.base_model,
            adapter_name=r.adapter_name,
            adapter_version=r.adapter_version,
            dataset_name=r.dataset_name,
            evaluated_at=r.evaluated_at,
            sample_count=r.sample_count,
            status=r.status,
        )
        for r in records
    ]


@app.get("/evaluations/{evaluation_id}", response_model=EvaluationResponse)
async def get_evaluation(evaluation_id: int):
    return _build_evaluation_response(evaluation_id)


@app.get("/metrics/by-dataset", response_model=ByDatasetResponse)
async def metrics_by_dataset(
    dataset: str,
    base_model: str,
    strategies: Optional[str] = None,
    series_points: int = 0,
):
    """Side-by-side base/finetuned for each requested strategy.

    `strategies` is a comma-separated list. When omitted, defaults to every
    strategy *recorded in the DB* for the (base_model, dataset) pair — not
    just the in-process registry — so seeded metrics that don't yet have a
    runnable MetricStrategy still surface for the dashboard.

    `series_points` (default 0): when > 0, each metric also includes
    `base_series` and `finetuned_series` of up to N most recent points,
    chronologically ordered (oldest first), suitable for chart rendering.
    """
    if strategies:
        requested = [s.strip() for s in strategies.split(",") if s.strip()]
    else:
        requested = store.list_strategy_names(
            base_model=base_model, dataset_name=dataset
        )
    if not requested:
        raise HTTPException(
            status_code=404,
            detail=f"no metrics recorded for dataset {dataset!r} on {base_model!r}",
        )

    series_n = max(0, int(series_points))

    pairs: List[MetricPairResponse] = []
    for name in requested:
        pair = store.latest_metric_pair(
            base_model=base_model,
            dataset_name=dataset,
            strategy_name=name,
        )
        base_series: List[SeriesPoint] = []
        finetuned_series: List[SeriesPoint] = []
        if series_n > 0:
            base_series = [
                SeriesPoint(**p)
                for p in store.latest_metric_series(
                    base_model=base_model, dataset_name=dataset,
                    strategy_name=name, role="base", limit=series_n,
                )
            ]
            finetuned_series = [
                SeriesPoint(**p)
                for p in store.latest_metric_series(
                    base_model=base_model, dataset_name=dataset,
                    strategy_name=name, role="finetuned", limit=series_n,
                )
            ]
        pairs.append(
            MetricPairResponse(
                strategy_name=name,
                base_value=pair.base_value,
                base_evaluated_at=pair.base_evaluated_at,
                finetuned_value=pair.finetuned_value,
                finetuned_evaluated_at=pair.finetuned_evaluated_at,
                finetuned_adapter_name=pair.finetuned_adapter_name,
                finetuned_adapter_version=pair.finetuned_adapter_version,
                delta=pair.delta,
                base_series=base_series,
                finetuned_series=finetuned_series,
            )
        )
    return ByDatasetResponse(base_model=base_model, dataset_name=dataset, metrics=pairs)


# ---------------------------------------------------------------------------
# Leaderboard endpoint (training-job-pipeline.md §4.7)
# ---------------------------------------------------------------------------

# Heuristic family extraction for HF-id-shaped base_models. The family
# is whatever sits before the first dash or slash on the slash-tail —
# 'openai/whisper-large-v3-turbo' → 'whisper'. Not cryptographic; just
# a display tag for the FE chip + an optional WHERE filter on the
# leaderboard query. When the base-model registry on the orchestrator
# becomes the canonical source, this gets replaced by a registry lookup.
def _family_from_base_model(base_model: str) -> Optional[str]:
    if not base_model:
        return None
    tail = base_model.split("/", 1)[-1]
    head = tail.split("-", 1)[0].lower()
    return head or None


def _model_name_from_row(base_model: str, adapter_name: Optional[str]) -> str:
    """Display label — e.g. 'whisper-lg-v3 + lora.cantonese'. Falls
    back to the base-model id when no adapter is attached."""
    tail = base_model.split("/", 1)[-1] if base_model else "model"
    if adapter_name:
        return f"{tail} + {adapter_name}"
    return tail


@app.get("/leaderboard", response_model=LeaderboardResponse)
async def leaderboard(
    dataset_id: str,
    base_family: Optional[str] = None,
    only_finetuned: bool = True,
    limit: int = 100,
):
    """Ranked submissions for a dataset.

    The orchestrator's `training_job_id` + `submitted_by` are stamped
    on `model_evaluation` rows when the post-train hook fires (the
    seeded mock rows have NULLs there — that's fine, they just show up
    without an engineer attribution). `base_family` is a substring
    filter on `base_model` (case-insensitive); the empty-string case
    is treated as "no filter" so the FE can pass `?base_family=` when
    the user clears the chip.

    Returns rows sorted by WER ascending; rows without WER recorded
    sink to the bottom. `rank` is server-stamped 1-based.
    """
    family_filter = (base_family or "").strip() or None
    rows = store.list_leaderboard(
        dataset_name=dataset_id,
        base_family=family_filter,
        only_finetuned=only_finetuned,
        limit=limit,
    )
    out: List[LeaderboardRowResponse] = []
    for idx, r in enumerate(rows):
        out.append(LeaderboardRowResponse(
            rank=idx + 1,
            base_model=r.base_model,
            base_family=_family_from_base_model(r.base_model),
            adapter_name=r.adapter_name,
            adapter_version=r.adapter_version,
            model_name=_model_name_from_row(r.base_model, r.adapter_name),
            submitted_by=r.submitted_by,
            training_job_id=r.training_job_id,
            evaluation_id=r.evaluation_id,
            evaluated_at=r.evaluated_at,
            wer=r.wer,
            cer=r.cer,
            rtf=r.rtf,
        ))
    return LeaderboardResponse(
        dataset_id=dataset_id,
        base_family=family_filter,
        rows=out,
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("METRICS_SERVICE_PORT", 8006))
    uvicorn.run(app, host="0.0.0.0", port=port)
