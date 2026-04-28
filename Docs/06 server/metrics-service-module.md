# Metrics Service — Module Reference

> Source-of-truth reference for `backend/metrics_service/`. Owns model evaluation: how a (base model + adapter + dataset) tuple gets scored, how scores are persisted, and how the dashboard reads the side-by-side base-vs-finetuned comparison the UI renders. Companion to [`upload-pipeline.md`](upload-pipeline.md) and [`pseudonymisation-module.md`](pseudonymisation-module.md).

---

## 1. What this service is for

The metrics service answers two distinct questions:

1. **Operational** — how is the system performing on the live transcript stream right now? (Same WER calculation that landed in the original `calculator.py`: `raw_text` from the model vs `edited_text` from the human reviewer, averaged across recently-uploaded files. Surfaced via `GET /metrics/dashboard`.)

2. **Evaluation** — how does a specific (base model, LoRA adapter, dataset) combination score against a held-out reference set? This is the new path. Each evaluation produces one row in `model_evaluation` and N rows in `evaluation_metric` (one per metric strategy). Results are persisted, queryable historically, and the **dashboard's base-vs-finetuned comparison** is just a join over the latest base row and the latest finetuned row for the same `(base_model, dataset_name)`.

Question 1 needs no DB — it's a pass-through over the existing `database:8002`. Question 2 owns the new SQLite store described below.

---

## 2. Module layout

```
backend/metrics_service/
├── main.py                     # FastAPI app, route handlers, startup
├── calculator.py               # legacy WER + aggregator for /metrics/dashboard
├── db_consumer.py              # httpx client into database:8002 (operational data)
├── schema.sql                  # DDL for the evaluation store
├── storage.py                  # MetricsStore — record_evaluation, latest_metric_pair, ...
├── strategies/                 # strategy pattern for metrics computation
│   ├── __init__.py             # registers strategies on import
│   ├── base.py                 # MetricStrategy ABC, Sample, StrategyResult
│   ├── registry.py             # @register_strategy, get_strategy, list_strategies
│   ├── runner.py               # MetricsRunner — single pass, N strategies
│   ├── _text.py                # shared normalisation + Levenshtein (private)
│   ├── f1.py                   # token-overlap F1
│   ├── wer.py                  # word error rate
│   ├── cer.py                  # character error rate (works on CJK)
│   └── smr.py                  # sequence match rate (all-or-nothing)
├── manifest_loader.py          # JSONL → list[Sample] for /evaluations/run
├── adapter_meta.py             # reads adapter_config.json for base_model
├── seed_mock.py                # populate metrics.db with the FE mock dashboard data
├── tests/
│   ├── test_calculator.py      # legacy WER tests
│   ├── test_strategies.py      # strategy + runner + registry coverage
│   └── test_storage.py         # MetricsStore roundtrip + latest-pair queries
├── requirements.txt
└── Dockerfile                  # python:3.10-slim, exposes 8006
```

---

## 3. Storage model

### 3.1 Schema

```sql
CREATE TABLE model_evaluation (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    base_model      TEXT NOT NULL,        -- e.g. "openai/whisper-large-v3-turbo"
    adapter_name    TEXT,                 -- NULL ⇒ baseline (no LoRA)
    adapter_version TEXT,                 -- adapter checkpoint id / commit
    dataset_name    TEXT NOT NULL,
    evaluated_at    TEXT NOT NULL,        -- ISO 8601, UTC
    sample_count    INTEGER NOT NULL,
    status          TEXT NOT NULL,        -- 'completed' | 'queued' | 'running' | 'failed'
    notes           TEXT
);
CREATE INDEX idx_model_evaluation_lookup
    ON model_evaluation(base_model, dataset_name, adapter_name, evaluated_at DESC);

CREATE TABLE evaluation_metric (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id   INTEGER NOT NULL REFERENCES model_evaluation(id) ON DELETE CASCADE,
    strategy_name   TEXT NOT NULL,
    value           REAL NOT NULL,        -- macro-averaged scalar across all samples
    breakdown_json  TEXT NOT NULL,        -- per-strategy detail (precision, per-lang, ...)
    sample_count    INTEGER NOT NULL,
    computed_at     TEXT NOT NULL
);
CREATE INDEX idx_evaluation_metric_evaluation ON evaluation_metric(evaluation_id);
CREATE INDEX idx_evaluation_metric_strategy   ON evaluation_metric(strategy_name);
```

### 3.2 Why `adapter_name IS NULL` for the baseline

PEFT's serving model in `transcription-service-2/main.py` treats the base model and any adapter as separable: `model.disable_adapter()` reverts to base, `model.set_adapter(name)` activates a specific LoRA. The same conceptual split is encoded here — `adapter_name = NULL` is *exactly* the row produced by evaluating the base weights with the adapter disabled. The `(base_model, adapter_name)` pair is the schema-level twin of PEFT's load semantics.

This is also why the post-train hook (§5) re-evaluates the base model on the same dataset whenever a fresh baseline is missing or stale: the dashboard's "+0.3% difference" labels rely on having both rows pinned to the same dataset.

### 3.3 Where the file lives

`METRICS_DB_PATH` env, default `/app/data/metrics.db`. The compose service mounts a `metrics_data` volume on `/app/data` so the DB survives container restarts.

---

## 4. Strategy pattern

### 4.1 Why this pattern

The full metric menu the FE wants to render — F1, W-WER, L-CER, CS-PIER, WDER, SMR, plus the stripped-down operational WER — all share the same input shape: a list of `(reference, hypothesis)` pairs walked once. They differ only in the algorithm applied to each pair and how results are aggregated.

That's textbook **Strategy**: hold the inputs constant, swap the algorithm. The runner walks the dataset once and dispatches every `(ref, hyp)` to every registered strategy in turn — adding a new metric is one new file plus an import line, never a `if metric_name == ...` branch.

### 4.2 The contracts

```python
# strategies/base.py
@dataclass(frozen=True)
class Sample:
    reference: str                      # human ground-truth
    hypothesis: str                     # model output
    audio_path: Optional[str] = None    # set when the eval manifest carries it
    tags: Dict[str, str] = ...          # for future per-language / per-speaker breakdowns

@dataclass(frozen=True)
class StrategyResult:
    strategy_name: str
    value: float                        # macro-averaged scalar (the dashboard headline)
    breakdown: Dict[str, float] = ...   # e.g. {"precision": 0.94, "recall": 0.92}
    sample_count: int = 0

class MetricStrategy(ABC):
    name: str
    @abstractmethod
    def compute(self, samples: Iterable[Sample]) -> StrategyResult: ...
```

### 4.3 Registry

```python
# strategies/f1.py
@register_strategy
class TokenF1(MetricStrategy):
    name = "f1"
    def compute(self, samples): ...
```

`@register_strategy` instantiates the class and stores it under `cls.name` in a module-level dict. Duplicate names raise at import time — that's deliberate, two strategies with the same name would silently shadow one another in the runner.

`get_strategy(name)` and `list_strategies()` are the read API. The `__init__.py` re-imports each strategy module so the registry is populated as soon as `from strategies import ...` is evaluated.

### 4.4 Runner

```python
runner = MetricsRunner(["f1", "wer", "smr"])      # validated at construction
results = runner.run(samples)                     # iter materialised once
# -> {"f1": StrategyResult, "wer": StrategyResult, "smr": StrategyResult}
```

Single materialisation matters because eval manifests typically arrive as iterators (JSONL stream, generator over inference output) and we don't want to re-read the source N times. The dataset is bounded by the manifest, so the memory cost is acceptable.

### 4.5 Adding a new metric — the whole checklist

1. Create `strategies/<name>.py` with a class decorated `@register_strategy`, `name = "<id>"`, `compute(samples) -> StrategyResult`. Reuse `_text.normalise/tokenise_words/tokenise_chars/levenshtein` if useful.
2. Add `from . import <name>` to `strategies/__init__.py`.
3. Add a unit test in `tests/test_text_strategies.py` (or a new `tests/test_<name>.py`) covering known values + edge cases (empty, mismatched lengths).

That's it. No schema migration, no endpoint change, no DB change. The new strategy name is immediately a valid value for `POST /evaluations/run`'s `strategies: [...]` field, and any row it produces lands in `evaluation_metric` like the others.

### 4.6 Strategy → dashboard card mapping

The seeder writes rows tagged with the dashboard's display IDs (`overall_accuracy`, `entity_f1`, `weighted_wer`, …) so the FE renders something on first boot. Real strategies use semantic names (`f1`, `wer`, `cer`, `sequence_match_rate`) that describe what they compute. They cohabit in the DB.

Today's overlap (real strategy auto-flows to dashboard card):

| Real strategy | Dashboard card it surfaces in | Notes |
|---|---|---|
| `sequence_match_rate` | `sequence_match_rate` | Direct match — name is a display ID |
| `financial_term_accuracy` | `financial_term_accuracy` | Direct match — slice 4 of the financial-terms-dictionary work |
| `weighted_wer` | `weighted_wer` | Direct match (2026-04-28) — consumes `Sample.info_values`; falls back to uniform weights when missing |
| `language_cer` | `language_cer` | Direct match (2026-04-28) — groups by `Sample.language`, macro-averages |
| `entity_f1` | `entity_f1` | Direct match (2026-04-28) — closed-set span recovery via `Sample.entity_spans` |
| `punctuation_accuracy` | `punctuation_accuracy` | Direct match (2026-04-28) — no manifest metadata required |
| `english_accuracy` | `english_accuracy` | Direct match (2026-04-28) — `(1 - WER)` on samples tagged `en` / `en-us` / `en-gb` / `en-sg` / etc. |
| `mandarin_accuracy` | `mandarin_accuracy` | Direct match (2026-04-28) — `(1 - WER)` on samples tagged `zh` / `zh-cn` / `zh-tw` / `cmn` (Cantonese excluded; `tokenisation_warning` flag in breakdown when avg tokens-per-sample < 3, signalling unsegmented CJK) |
| `code_switch_pier` | `code_switch_pier` | Direct match (2026-04-28) — fraction of intra-sentence language-tagged spans the model dropped. Consumes `Sample.language_spans`; per-language `recovered.<lang>` + `total.<lang>` in breakdown |
| `word_diarization_error` | `word_diarization_error` | Direct match (2026-04-28) — char-aligned ref ↔ hyp speaker disagreement. Consumes `Sample.speakers` + `Sample.hypothesis_speakers`. Today's pipeline doesn't produce hyp-side speakers → metric short-circuits with `samples_skipped_no_hypothesis_speakers` (auto-flows when WhisperX/pyannote lands) |
| `speaker_diarization` | `speaker_diarization` | Direct match (2026-04-28) — Jaccard distance over the speaker *sets* on each side (ref ∆ hyp / ref ∪ hyp). Proxy for full DER until time-aligned diarization output exists; same skip-on-no-hyp-speakers semantics as WDER |

The generic strategies (`f1`, `wer`, `cer`) keep their semantic names; the dashboard merge layer falls back to them when no specialised metric ran.

`Sample` was extended (2026-04-28) with three optional fields to feed the new strategies — see `strategies/base.py`:

- `info_values: Optional[List[float]]` — per-word weight aligned to `tokenise_words(reference)`
- `language: Optional[str]` — BCP-47 short form
- `entity_spans: Optional[List[Tuple[int, int, str]]]` — half-open char ranges + label

`manifest_loader.py` parses + validates the new fields; legacy manifests stay valid (`None` defaults).

**All 9 dashboard strategies have shipped as of 2026-04-28.** Three of them (`word_diarization_error`, `speaker_diarization`, `code_switch_pier`) consume manifest fields the current ASR pipeline doesn't yet populate on the hypothesis side — they ship correctly-shaped and short-circuit with explicit `samples_skipped_*` counters until a diarisation post-processor (e.g. WhisperX + pyannote) and language-id pass land. The metrics auto-flow the day those become available; no schema change required.

---

## 5. Evaluation flow

### 5.1 The two-row rule

Every dataset evaluation produces (or refreshes) **two rows in `model_evaluation`**:

| Row | `base_model` | `adapter_name` | What it represents |
|---|---|---|---|
| Baseline | `"openai/whisper-large-v3-turbo"` | `NULL` | Base model, no LoRA, on this dataset |
| Fine-tuned | `"openai/whisper-large-v3-turbo"` | `"fypaudio-W-lv3t"` | Base + the named adapter, on the same dataset |

The pair is what `latest_metric_pair(base_model, dataset_name, strategy_name)` joins on. The result drives the dashboard's `baseModel: [...]` vs `fineTuned: [...]` series — see [`metrics_research/metrics_dashboard.md`](../02%20frontend/metrics_research/metrics_dashboard.md) for the metric menu the UI ultimately surfaces.

The baseline row is **cached**: if a `completed` baseline for `(base_model, dataset_name)` exists within the freshness window (default 30 days, env-configurable), the post-train hook reuses it. Inference on the base model is the expensive half and there's no point repeating it for every adapter ship.

### 5.2 The eval manifest

Same shape as the training manifest in `backend/retraining-pipeline/data/`, with two extra fields:

```jsonl
{"audio_path": "data/eval/clip_001.wav", "reference": "the deal is closed", "hypothesis": "the deal is closing"}
{"audio_path": "data/eval/clip_002.wav", "reference": "EBITDA up 12 percent",  "hypothesis": "EBITDA up twelve percent"}
```

For step 1 (this PR series), the runner consumes the text fields directly — `hypothesis` is supplied by the caller. A follow-up PR will let `hypothesis` be omitted and have the metrics service fan out to `transcription-service-2:/transcribe?domain=<adapter>` to fill it in. The schema accepts `audio_path` today so that change requires no manifest reformatting.

### 5.3 Seeding the dashboard before any real run

`seed_mock.py` mirrors `frontend/src/services/mock_data-dashboard.js` — fourteen metrics, five days, two roles per day (base + fine-tuned), 140 metric rows total. Without this the dashboard is empty until the first training run completes; with it, the FE renders immediately on a fresh container.

```bash
# inside the metrics-service container
METRICS_DB_PATH=/app/data/metrics.db python seed_mock.py
```

Idempotent — every row carries `notes='seed:mock'`, and a re-run deletes those rows (cascading to `evaluation_metric` via the FK) before re-inserting. Real evaluations are tagged with their actual `notes` and survive re-seeding.

`GET /metrics/by-dataset` defaults to **strategies recorded in the DB** for the requested `(base_model, dataset)` pair, not just `list_strategies()`. That means seeded metrics like `entity_f1`, `latency_p95`, etc. surface for the dashboard even though only `f1` has a runnable `MetricStrategy` implementation today. Strategies get their concrete implementations one-by-one as engineering work; the dashboard never has to wait.

### 5.4 Post-training hook

At the end of `train_one_round()` in `backend/retraining-pipeline/train.py`, after `_strip_published_artifacts()`:

```python
post_train_evaluate(adapter_dir=OUTPUT_DIR, adapter_name=ADAPTER_NAME)
```

The hook lives in `backend/retraining-pipeline/post_train_hook.py` (extracted so it's testable without importing torch/transformers). Best-effort `POST` to `${METRICS_SERVICE_URL}/evaluations/run`. Failure is logged at WARNING and **never raised** — training success does not depend on metrics availability. The hook reads `adapter_config.json` from the saved adapter dir to fill in `base_model` (it's on `_PUBLISHED_ARTIFACT_ALLOWLIST`, so it always survives).

Resolution order for each input — explicit kwarg → env var → default → skip:

| Input | Kwarg | Env var | Fallback |
|---|---|---|---|
| Metrics URL | `metrics_service_url` | `METRICS_SERVICE_URL` | skip with INFO log |
| Manifest path | `manifest_path` | `EVAL_MANIFEST_PATH` | `data/{adapter_name}_eval_manifest.jsonl` → skip if missing |
| Dataset name | `dataset_name` | `EVAL_DATASET_NAME` | `"default_eval"` |
| Strategies | `strategies` | — | `["f1"]` |

---

## 6. HTTP API

### 6.1 Operational (existing)

| Endpoint | Returns |
|---|---|
| `GET  /health` | `{ status: "healthy" }` |
| `GET  /metrics/dashboard` | Aggregated WER/latency/transcription-time over `database:8002`. 60s in-memory cache. |
| `GET  /metrics/accuracy/{file_id}` | Per-file WER vs the human-edited transcript. |
| `POST /metrics/refresh` | Clears the in-memory cache. |

### 6.2 Evaluation (planned, step 3 of the metrics-service buildout)

| Endpoint | Body / Params | Returns |
|---|---|---|
| `POST /evaluations/run` | `{ adapter_name, dataset_name, manifest_path, strategies: ["f1", ...] }` | `{ evaluation_id, status, metrics: [...] }` |
| `POST /evaluations/baseline` | `{ base_model, dataset_name, manifest_path, strategies }` | Same shape; explicit baseline-only run |
| `GET  /evaluations` | `?adapter=&dataset=&base_model=` | List of `EvaluationRecord` |
| `GET  /evaluations/{id}` | — | One `EvaluationRecord` + its metrics |
| `GET  /metrics/by-dataset` | `?dataset=&base_model=` | Per-strategy `{base_series, finetuned_series, current_*, delta}` — exactly the shape `mock_data-dashboard.js` consumes |

`POST /evaluations/run` is the path the post-train hook calls. It looks up the adapter dir, reads `adapter_config.json` for `base_model`, materialises the manifest into `Sample` objects, runs the strategies via `MetricsRunner`, and persists via `MetricsStore.record_evaluation`. If no recent baseline row exists for `(base_model, dataset_name)`, it triggers a baseline run first.

---

## 7. Wiring

### 7.1 compose.yaml

Service block (already in `compose.yaml`):

```yaml
metrics-service:
  build: "./backend/metrics_service"
  ports:
    - "${METRICS_SERVICE_PORT}:${METRICS_SERVICE_PORT}"
  depends_on:
    - database
  volumes:
    - "./backend/metrics_service:/app"
    - "./backend/retraining-pipeline/adapters:/app/adapters:ro"  # for adapter_meta
    - metrics_data:/app/data                                     # persists metrics.db
  environment:
    - METRICS_SERVICE_PORT=${METRICS_SERVICE_PORT}
    - DATABASE_URL=http://database:${DATABASE_PORT}
    - METRICS_DB_PATH=/app/data/metrics.db
    - ADAPTERS_DIR=/app/adapters
    - SEED_ON_BOOT=${METRICS_SEED_ON_BOOT:-true}
```

The adapters mount is read-only — the metrics-service only reads `adapter_config.json`, never writes. The same host directory is mounted read-write into `transcription-service-2` (which loads the adapter weights for inference) and is the directory `train.py` writes new adapters into.

The frontend block adds:

```yaml
depends_on:
  - metrics-service
environment:
  - METRICS_SERVICE_URL=http://metrics-service:${METRICS_SERVICE_PORT}
```

The proxy route `frontend/src/app/api/metrics/route.js` (step 7) reads from there and forwards the user's role/owner headers per F3/F4 (see [`fix-implementation-log.md`](../07%20Integration%20CAA%2027APR2026/fix-implementation-log.md)).

### 7.2 Boot-time seeding

`main.py`'s startup hook calls `seed_mock.seed(store)` if (a) `SEED_ON_BOOT` is truthy (default `"true"`), and (b) the DB has zero evaluation rows. The empty-DB check means restarting compose against an existing `metrics_data` volume is a no-op — only a fresh volume gets seeded, so real evaluation runs are never overwritten by the seeder. Set `METRICS_SEED_ON_BOOT=false` in `.env` for prod-style runs.

### 7.3 Frontend client

`frontend/src/services/metrics.js` calls **same-origin proxy routes only** — never the metrics service URL directly. The cookie session and Origin/Referer CSRF guarantees apply uniformly because the browser only ever talks to its own origin.

| Client function | Proxy route | Upstream |
|---|---|---|
| `fetchDashboardMetrics()` | `GET /api/metrics` | `GET /metrics/dashboard` |
| `fetchFileAccuracy(fileId)` | `GET /api/audio-files/:id/accuracy` | `GET /metrics/accuracy/{backend_id}` |
| `fetchMetricsByDataset({dataset, baseModel, strategies?, seriesPoints?})` | `GET /api/metrics/by-dataset` | `GET /metrics/by-dataset` |
| `refreshMetricsCache()` | `POST /api/metrics/refresh` | `POST /metrics/refresh` |

Proxy routes:
- `frontend/src/app/api/metrics/route.js`
- `frontend/src/app/api/metrics/by-dataset/route.js`
- `frontend/src/app/api/metrics/refresh/route.js`
- `frontend/src/app/api/audio-files/[id]/accuracy/route.js`

All four:
- Wrap `requireUser` (or `requireOwnerOrRole` for the per-file accuracy route, per F4).
- 15-second AbortController timeout — upstream slowness can't hang the dashboard.
- Distinguish 404 (no metrics yet recorded for the dataset) from 502 (upstream down) so the UI can render an empty state instead of an error toast.
- The accuracy route resolves the FE's external `audio_file` id to the backend's integer `backend_audio_file_id` (stashed at upload time) before forwarding — the metrics service addresses files by the canonical backend id.

### 7.4 Live dashboard merge layer

`frontend/src/services/live-dashboard-metrics.js` is the bridge between the API and the existing mock-driven dashboard render. The mock (`AVAILABLE_METRICS`) stays as the **schema definition** — what metrics exist, their display units, chart bounds (`yMin`/`yMax`), descriptive metadata. The API supplies the **live values** — current finetuned value, delta, base/finetuned 5-day series.

| Export | Purpose |
|---|---|
| `useDashboardSeries({dataset, baseModel, seriesPoints})` | React hook. Fetches `/api/metrics/by-dataset?series_points=N` once on mount; in mock mode it's a no-op (returns `liveData: null`). |
| `mergeMetricsWithLive(mockMetrics, apiResponse)` | Pure function. Overlays each live metric onto its `id`-matched mock entry. Unmatched mocks pass through unchanged. |
| `mergeMetricWithLive(mockMetric, liveMetric)` | Single-metric variant — overrides `value`, `sublabel`, `series.{baseModel, fineTuned, currentValue, difference}`. |
| `formatMetricValue(value, unit)` | Per-unit formatting (`%`, `ms`, `k/hr`); returns `'—'` for null/NaN. |

The dashboard page (`frontend/src/app/(dashboard)/dashboard/page.jsx`) calls the hook then `mergeMetricsWithLive(selectedMetrics, liveData)` and renders the result. **On any backend failure (404, 502, timeout) the merge falls back to mock**, so the page never breaks regardless of what the metrics service is doing.

Defaults from the seeder land cleanly: `dataset = "default_eval"`, `base_model = "openai/whisper-large-v3-turbo"`. Override per-page when other datasets/models become user-selectable.

---

## 8. Testing

```bash
cd backend/metrics_service
python -m pytest tests/ -q
```

- `test_calculator.py` — legacy WER + aggregator (requires `jiwer`, runs in the container).
- `test_strategies.py` — 17 tests: tokenisation, F1 P/R/F edge cases (empty, no overlap, length mismatch, normalisation), registry duplicate/missing-name guards, runner single-pass guarantee.
- `test_storage.py` — 12 tests: roundtrip insert/read, baseline-row support, `__base__` adapter filter sentinel, ordering newest-first, multi-version pick-newest, missing-side handling, failed-run exclusion, idempotent re-init, nested `breakdown_json` roundtrip.

Strategy and storage tests have no external dependencies (stdlib `sqlite3`, in-process strategies) and run on a developer laptop without the container.

---

## 9. Cross-references

- [`metrics_research/metrics_dashboard.md`](../02%20frontend/metrics_research/metrics_dashboard.md) — the metric menu the FE renders. Each entry there maps to a `MetricStrategy` once implemented; `f1` is the first one.
- [`upload-pipeline.md`](upload-pipeline.md) — produces the operational data the legacy `/metrics/dashboard` aggregates over.
- [`pseudonymisation-module.md`](pseudonymisation-module.md) — same module-reference style for the sibling service.
- [`07 Integration CAA 27APR2026/backend_integration_status.md`](../07%20Integration%20CAA%2027APR2026/backend_integration_status.md) §3.1 — the integration status row that pointed here.
- [`fl-dp-risk-assessment.md`](../07%20Integration%20CAA%2027APR2026/fl-dp-risk-assessment.md) §4.5 / P5 — why `_strip_published_artifacts()` runs before the post-train hook can read `adapter_config.json` (it's on the allowlist precisely so this read is safe).
