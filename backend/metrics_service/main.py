from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import time
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
from pydantic import BaseModel, Field

from db_consumer import fetch_bulk_context, fetch_file_context
from calculator import aggregate_metrics, calculate_wer
from storage import MetricsStore
from strategies import MetricsRunner, list_strategies
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
    results = _run_strategies(req.strategies, samples)

    evaluation_id = store.record_evaluation(
        base_model=base_model,
        adapter_name=req.adapter_name,
        adapter_version=req.adapter_version,
        dataset_name=req.dataset_name,
        sample_count=len(samples),
        results=results.values(),
        notes=req.notes,
    )
    return _build_evaluation_response(evaluation_id)


@app.post("/evaluations/baseline", response_model=EvaluationResponse)
async def run_baseline(req: RunBaselineRequest):
    samples = _load_samples(req.manifest_path)
    results = _run_strategies(req.strategies, samples)

    evaluation_id = store.record_evaluation(
        base_model=req.base_model,
        adapter_name=None,
        adapter_version=None,
        dataset_name=req.dataset_name,
        sample_count=len(samples),
        results=results.values(),
        notes=req.notes,
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


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("METRICS_SERVICE_PORT", 8006))
    uvicorn.run(app, host="0.0.0.0", port=port)
