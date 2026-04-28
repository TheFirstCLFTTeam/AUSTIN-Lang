# Training Job Pipeline — End-to-End Engineer Flow

_Last audited: 2026-04-28 (branch `ui_enhancement`)_

**Update (2026-04-28):** orchestrator skeleton + simulated worker + **real CLI-driven worker** all landed — `backend/training_orchestrator/` on port **8008** (the doc's earlier "port 8007" suggestion is stale; 8007 is taken by `meeting-webhooks`). What's live: `POST /jobs`, `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/cancel`, `POST /jobs/{id}/transitions/{new_status}`, full state machine in `storage.py::JobStore` + new `update_progress()` for in-state writes, FE proxy + `submitTrainingJob` client + LAUNCH-button wiring, **`worker.py` simulated worker** (FIFO claim + progress ticks, ~30 s per job, useful for tests / dev), **and `real_worker.py`** which invokes `backend/retraining-pipeline/cloud_train_sync.sh` as a subprocess, parses stdout for state markers + HF-Trainer progress, terminates the subprocess on cancel (SIGTERM/10 s/SIGKILL), and streams logs to `/app/data/logs/{job_id}.log`. `WORKER_MODE=simulated|real` flips between them at boot; default `simulated` for backwards compat.

What's still missing: heartbeat/log SSE on the detail page (slice 2 — the log file is being written, just not yet streamed to the browser), the `base_model` + `training_artifact` registry (slice 3 — gated on architecture-fingerprint design), pause/resume semantics (current `paused` state has no effect on the subprocess), and the FL path (gated on F25 ADR). See [`backend_integration_status.md`](backend_integration_status.md) §3.3 for the per-layer breakdown.

**Open Q1 (orchestrator-owned subprocess vs CLI-records-only) resolved 2026-04-28 → CLI-records-only.** The orchestrator container runs `bash cloud_train_sync.sh` directly; the script itself SSHes to the GPU box and the orchestrator just observes. Trade-off: the orchestrator container holds the SSH key. Acceptable for dev/staging — re-evaluate when prod ops re-wire to a control-VM hop (open question 3 of §6).

**Open Q5 (cancel semantics) resolved 2026-04-28 → terminate-on-cancel.** Cancel polls between stdout reads; on flip to `cancelled` we SIGTERM the subprocess, give it 10 s, then SIGKILL. Trade-off: more complex worker loop, but a 6-hour training run can actually be stopped from the dashboard.

Documents the full path an ML engineer takes from clicking **Train Jobs** in the sidebar to seeing their finished model on the leaderboard. Created because no doc in this folder (or sibling folders) covered the eight-step submission flow end-to-end — the work is currently fragmented across the PRD, `backend_integration_status.md` §3.2/§3.3, the metrics-service module ref, the FL/DP risk assessment, and `ZZ ML Research/03 Designing an Online learning pipeline.md`.

This doc is the integration-level master. Where another doc owns the detail design, links go out.

---

## TL;DR — verdict

**This flow is not implemented end-to-end. It is also not _designed_ end-to-end anywhere else in the docs.**

The frontend has production-quality UI for steps 1, 2, 6, and 8 driven by mock data. The backend has a real but CLI-only training entry-point (`backend/retraining-pipeline/train.py`) and a real metrics-service evaluation pipeline. The connective tissue between them — a job-queue API, a base-model registry, a federated training runtime, and a real leaderboard endpoint — does not exist. Per-step status table at §1.

The biggest gaps are:

1. **No job-submission API** — the dialog's "LAUNCH EXPERIMENT" button currently just closes itself (`training/page.jsx:532` → `setShowExperiment(false)`).
2. **No federated training runtime** — `retraining-pipeline/requirements.txt` has no Flower / NVFlare / PySyft / flwr; training is single-machine LoRA fine-tuning today.
3. **No base-model registry table** — `backend/database/main.py` only models `audio_file`, `raw_transcript`, `edited_transcript`. Architecture-deviation handling (step 5) has nowhere to write.
4. **No real leaderboard endpoint** — `metrics-service` has `/metrics/by-dataset` and `/evaluations` (per-pair / per-eval shapes); ranking + user-model attribution does not exist.

The sections below catalogue what's there per step, then propose the design.

---

## 1. Per-step status

| # | Step | FE state | BE state | Detail |
|---|------|----------|----------|--------|
| 1 | Visit "Train Jobs" tab | ✅ real | n/a | `SidebarShell.jsx:19`, route `/training`, role-gated to `engineer` / `admin` |
| 2 | Fill "New Train Job" dialog | ✅ UI real | — | `training/page.jsx:147–540`; fields = name, target (cloud VM / local), dataset, base model, LoRA toggle + rank/alpha, LR, epochs, batch, model-config path, launch script |
| 3 | Upload script + env-var metadata | 🟡 dialog captures values, no submit | ❌ no upload endpoint | "LAUNCH EXPERIMENT" at `training/page.jsx:532` calls `setShowExperiment(false)`; preview only emits `austin-cli jobs submit … --env .env` text |
| 4 | Resource pulls weights + dataset, FL run | ❌ | 🟡 single-machine, **non-federated** | `retraining-pipeline/train.py` real; `cloud_train_sync.sh` SSH-syncs to a remote box; **no FL framework imported** |
| 5 | Architecture deviation → new base model under user | ❌ | ❌ | No registry table, no deviation check, no per-user namespace |
| 6 | Training-detail page (progress) | ✅ UI real, mock-only data | ❌ no progress endpoint | `training/[id]/page.jsx`; data from `services/training-jobs.js`; loss history, GPU bars, log tail all mocked |
| 7 | Auto-store on completion + push to metrics module | 🟡 mock notification at 8 s | 🟡 partial: post-train hook fires `/evaluations/run`; storage is filesystem-only | `train.py:204` strips artifacts → `:209` calls `post_train_evaluate()`; adapter saved to `retraining-pipeline/adapters/<name>/` |
| 8 | Appears on leaderboard with specs + multi-metric perf | ✅ UI real, mock-only data | ❌ no leaderboard endpoint | `leaderboard/page.jsx` reads `getCustomMockLeaderboard()`; metrics-service has `/metrics/by-dataset` (pair shape, not ranked) |

Legend: ✅ shipped · 🟡 partial · ❌ missing.

---

## 2. What exists today

### 2.1 Frontend — `/training` and dialog

**Sidebar entry** — `frontend/src/app/(dashboard)/components/SidebarShell.jsx:19` registers the route `/training` with label "Training Jobs", icon `training`, gated to roles `engineer` / `admin`.

**List page** — `frontend/src/app/(dashboard)/training/page.jsx` reads `TRAINING_JOBS` from `services/training-jobs.js` (three hard-coded jobs). Header has a "+ NEW EXPERIMENT" button (`page.jsx:273`) that opens a modal.

**New-experiment dialog** (`page.jsx:334–540`):
- Job name (text)
- Execution target — radio: `cloud` ("Runs austin-cli on the provisioned analysis VM") or `local` (`page.jsx:370`)
- Dataset (dropdown of `getDatasets()`, with `datasetRef` rendered as `{email}/{YYYYMMDDhhmmss}` — the canonical mount-point address used elsewhere in this branch)
- Base model — hard-coded list at `page.jsx:22`: `["Whisper Large-v3", "Whisper Tiny", "MERaLiON", "Qwen3-ASR"]`
- Model-config path (local mode only)
- Env-var overrides — `LORA` (toggle), `LORA_RANK`, `LORA_ALPHA`, `LEARNING_RATE`, `EPOCHS`, `BATCH_SIZE` (`page.jsx:163, 472`)
- Launch script path (local mode only)
- Read-only **Command Preview** at `page.jsx:516` rendering `austin-cli jobs submit --name "<slug>" --env .env` (or a bash invocation in local mode) — implies the eventual contract is "user copies + pastes the command", not "FE POSTs and BE owns the run"

**Submit handler** — `page.jsx:532` "LAUNCH EXPERIMENT" → `setShowExperiment(false)`. Nothing more. No fetch, no API route called.

**Detail page** — `frontend/src/app/(dashboard)/training/[id]/page.jsx` reads from the same `TRAINING_JOBS` mock. Renders status badge, progress bar, GPU bars, elapsed/ETA, infra block, train/val loss + LR + tokens/sec + grad-norm metrics, a sparkline-shaped `lossHistory` array, deterministic mock log tail (`getTrainingLogs()`), and pause/resume/cancel buttons with no handlers.

**Mock completion** — `page.jsx:20` defines `MOCK_COMPLETION_DELAY_MS = 8000`; clicking the watch-bell on a job fires a notification 8 s later. The comment is honest: "In production this would be replaced by a real event (websocket / polling) — and by a Teams webhook for external delivery."

**`triggerRetraining()`** — `services/analytics.js:71`, called from the dashboard page (`dashboard/page.jsx:241`) only. 2 s `setTimeout`, returns hardcoded success. No relation to the `/training` flow yet.

### 2.2 Backend — `retraining-pipeline`

**Real training entry-point** — `backend/retraining-pipeline/train.py`:
- `train_one_round()` loads the base model from HF (`openai/whisper-large-v3-turbo`), reads a manifest, applies LoRA via `peft`, trains with 8-bit quantization, saves the adapter to `OUTPUT_DIR`, and calls `_strip_published_artifacts(OUTPUT_DIR)` (line 204) to remove `training_args.bin`, `trainer_state.json`, and `runs/` (the F24 fix landed on this branch — see `fl-dp-risk-assessment.md` §4.5 / P5).
- Immediately after stripping: `post_train_evaluate(adapter_dir=OUTPUT_DIR, adapter_name=ADAPTER_NAME)` (line 209).
- TensorBoard reporter wired (`report_to=["tensorboard"]`); no HTTP stream.

**Post-train hook** — `backend/retraining-pipeline/post_train_hook.py:56–127`:
- `post_train_evaluate()` POSTs `{adapter_name, dataset_name, manifest_path, strategies, base_model, adapter_version}` to `${METRICS_SERVICE_URL}/evaluations/run`.
- **Best-effort** — every failure path logs at WARNING and returns False; "training success must not depend on metrics availability" (module docstring).
- Reads `base_model_name_or_path` out of `adapter_config.json` to populate the eval payload.

**Cloud sync** — `cloud_train_sync.sh` is SSH-based: pushes the pipeline directory to a remote box, runs `train.py` there, downloads adapters back. There is no orchestrator API in front of this; an engineer runs the script manually.

**No FL framework** — `requirements.txt` ships `peft`, `transformers`, `bitsandbytes`, `opacus==1.5.2` (pinned for F19 / P1, not yet wired in). No `flwr`, `nvflare`, `syft`. Step 4's "federated training run" is unimplemented. (Cross-ref `fl-dp-risk-assessment.md` and `backend_integration_status.md` §6.2 for the Wave-3 sequencing on F25 — _Pick FL framework_.)

### 2.3 Backend — `metrics-service`

Implements the back half of step 7 and the data shape that step 8 will need:

- `POST /evaluations/run` — receives the post-train hook payload, runs strategies (currently `TokenF1`), writes rows into `model_evaluation` / `evaluation_metric` (`backend/metrics_service/storage.py`).
- `POST /evaluations/baseline` — runs a base-only evaluation (no adapter), persists with `adapter_name IS NULL`.
- `GET /evaluations` — paginated list, filterable by `base_model` / `adapter_name` / `dataset_name`.
- `GET /metrics/by-dataset` — returns the side-by-side base/finetuned pair + delta for one (base_model, dataset, strategy) tuple. Used by the dashboard, **not** ranked across engineers.
- `GET /metrics/dashboard` — aggregated, 60 s cache, computes `needs_attention`.

The ranking and per-user attribution that the leaderboard page renders today (rank #, engineer name, "You" badge) have no backend — no engineer-id is recorded with an evaluation, no ranking endpoint exists.

### 2.4 Backend — `database`

`backend/database/main.py` only models `AudioFile`, `RawTranscript`, `EditedTranscript`, `FullContext`. There is **no** `base_model`, `training_job`, `user_model_artifact`, or `leaderboard_submission` table.

Pretrained-weight directories live on disk under `backend/server/pretrained_weights/<vendor>/<family>/` (Whisper, Qwen, MERaLiON). They are not a registry — there is no metadata layer recording who owns what, or whether a checkpoint was vendor-shipped vs. user-derived.

---

## 3. Cross-cuts to existing plans

This flow does not stand alone; several decisions interact with workstreams that already have their own design docs.

| Touchpoint | Owner doc | What this flow needs from it |
|---|---|---|
| FL framework choice (step 4) | [`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md) §F25, [`fix-triage-frontend-vs-backend.md`](fix-triage-frontend-vs-backend.md) Wave 3 | Governance ADR — Flower / NVFlare / PySyft. Blocks any real implementation of step 4. |
| DP gate (step 4) | [`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md) §F19 / P1, §F23 / P5 | `DP_ENABLED` env var must gate 4-bit quantisation; per-user ε ledger (F22) must be charged when a job runs. |
| `data_zone` on every job (steps 3–7) | [`azure-deployment-requirements.md`](azure-deployment-requirements.md) §3, [`backend_integration_status.md`](backend_integration_status.md) §3.3 | Job records, base-model registry rows, and evaluation rows all need a `green` / `red` zone tag per FR-M05 / NFR-P02 — this is a hard schema requirement, not a nice-to-have. |
| Provenance check on training manifest (step 4) | [`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md) §F29 | The manifest the dataset-builder produces must be signed/verified before the resource consumes it. Blocks step 4 going live in the FL/DP wave. |
| Post-train evaluation contract (step 7) | [`../06 server/metrics-service-module.md`](../06%20server/metrics-service-module.md) §5.3 | Already specifies `POST /evaluations/run` payload — re-use as-is. |
| Leaderboard data shape (step 8) | [`../02 frontend/UX/leaderboard_research.md`](../02%20frontend/UX/leaderboard_research.md), [`backend_integration_status.md`](backend_integration_status.md) §3.2 | Engineer-id reconciliation (mock IDs `eng-priya` etc. don't exist in `users.db`) must land before ranking is meaningful. |
| Cache invalidation on model publish (step 7→8) | [`redis-cache-integration.md`](redis-cache-integration.md) | When step 7 writes a new model row, the leaderboard cache key for affected datasets must be evicted. |

---

## 4. Proposed end-to-end design

This is the _integration-level_ design. Service-internal mechanics (e.g. how a job-queue worker drains, how the FL aggregator authenticates clients) belong in service-owned docs that should follow.

### 4.1 Service: `training-orchestrator` (port 8008)

A FastAPI service that owns the lifecycle of a training job. Sits between the `/training` page and `retraining-pipeline`. **Skeleton has landed on this branch** (`backend/training_orchestrator/`) — the table below marks live vs pending.

**Endpoints:**

| Method | Path | Status | Purpose |
|---|---|---|---|
| `POST` | `/jobs` | ✅ live | Submit a new training job (replaces `austin-cli jobs submit`) |
| `GET` | `/jobs` | ✅ live | List jobs the caller can see (engineer → own jobs; admin → all) |
| `GET` | `/jobs/{id}` | ✅ live | Single-job detail incl. status, progress, last metrics snapshot |
| `POST` | `/jobs/{id}/cancel` | ✅ live | Cancel a queued or running job |
| `POST` | `/jobs/{id}/transitions/{new_status}` | ✅ live | Worker-side state transition write-through |
| `POST` | `/jobs/{id}/heartbeat` | ❌ pending | 30 s heartbeat from worker (`{step, loss, gpu_util, ts}`) |
| `POST` | `/jobs/{id}/events` | ❌ pending | Worker-side log + metric batch (idempotent on `event_id`) |
| `GET` | `/jobs/{id}/stream` | ❌ pending | Browser SSE channel — multiplexed logs + metrics, supports `Last-Event-ID` reconnect |
| `POST` | `/jobs/{id}/artifacts` | ❌ pending | Worker uploads finished artifact for orchestrator-side fingerprint check |
| `POST` | `/jobs/{id}/resume-from-checkpoint` | ❌ pending | Re-submit cancelled/failed job from last checkpoint (replaces "pause/resume") |

`POST /jobs/{id}/pause` is **not on the roadmap**. None of Vertex AI, SageMaker, K8s Job, HF Jobs, or Argo expose a true pause; what users call "pause/resume" is in fact "cancel + resubmit from checkpoint." The detail-page PAUSE/RESUME buttons (`training/page.jsx:321-322`) should be removed or rewired to cancel + checkpoint.

**Submission payload** (step 3) — borrows SageMaker's flat shape with a Stripe-style idempotency header:

```http
POST /jobs
Idempotency-Key: <uuid4>
Authorization: Bearer <austin-token>
```
```json
{
  "name": "whisper-largev3-fin-q2",
  "target": "cloud" | "local" | "federated",
  "base_model_id": "bm_whisper_large_v3_turbo",
  "dataset_ref": "engineer@example.com/20260401T120000",
  "training_script": { "kind": "upload", "filename": "train.py", "sha256": "..." },
  "env": {
    "LORA": "1",
    "LORA_RANK": "16",
    "LORA_ALPHA": "32",
    "LEARNING_RATE": "3e-4",
    "EPOCHS": "3",
    "BATCH_SIZE": "8"
  },
  "data_zone": "green" | "red",
  "timeout_seconds": 86400,
  "fl": {
    "enabled": false,
    "rounds": null,
    "min_clients": null,
    "strategy": null,
    "dp": null
  }
}
```

The env-var key set is the canonical contract — these names already exist in both ends: `training/page.jsx:186-201` emits them and `train.py:37-44` declares (currently commented-out) `os.getenv` calls for `MODEL_ID`, `ADAPTER_NAME`, `MANIFEST_PATH`, `OUTPUT_DIR`, `BASE_ADAPTER_PATH`. Materialise them into the worker process environment at start time; surface read-only on the detail page (step 6) so engineers can audit what their resource actually ran with.

The script body is uploaded via a separate `POST /jobs/{id}/script` (multipart, size-capped, MIME-sniffed — re-use the F6 upload-validation harness). Decoupling submit-then-upload lets us assign `job_id` immediately and stream upload progress.

**State machine** (8 states; mirrors Vertex AI's `JobState` with SageMaker secondary granularity):

```
QUEUED ──► PREPARING ──► RUNNING ──► EVALUATING ──► SUCCEEDED
                            │             │
                            ├──► FAILED   │
                            └──► CANCELLED
              (any)        ─►   STUCK   (heartbeat-detected, terminal)
```

Persist a free-text `secondary_status` column for "downloading dataset" / "compiling kernel" / "saving adapter" so the UI shows progress without expanding the enum. `EVALUATING` covers step 7's metrics call; only on `2xx` from `/evaluations/run` does the row move to `SUCCEEDED`.

### 4.2 Schema additions

In a new `platform.db` migration (or Postgres after Wave 4 / F16):

```sql
CREATE TABLE training_job (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  submitted_by TEXT NOT NULL REFERENCES user(id),
  submitted_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('cloud','local','federated')),
  base_model_id TEXT NOT NULL REFERENCES base_model(id),
  dataset_ref TEXT NOT NULL,
  data_zone TEXT NOT NULL CHECK (data_zone IN ('green','red')),
  env_json TEXT NOT NULL,
  script_sha256 TEXT,
  fl_enabled BOOLEAN NOT NULL DEFAULT 0,
  dp_enabled BOOLEAN NOT NULL DEFAULT 0,
  progress_pct REAL,
  current_step INTEGER,
  total_steps INTEGER,
  current_epoch INTEGER,
  metrics_snapshot_json TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  failure_reason TEXT
);

CREATE TABLE base_model (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,                  -- 'whisper' | 'meralion' | 'qwen3-asr' | …
  display_name TEXT NOT NULL,
  hf_id TEXT,                            -- 'openai/whisper-large-v3-turbo' for vendor-shipped
  owner_user_id TEXT REFERENCES user(id), -- NULL for vendor base; set when step-5 spawns one
  parent_base_model_id TEXT REFERENCES base_model(id), -- lineage when derived
  architecture_fingerprint TEXT NOT NULL, -- see §4.3
  weights_uri TEXT NOT NULL,
  data_zone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE training_artifact (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES training_job(id),
  kind TEXT NOT NULL CHECK (kind IN ('adapter','base_model','checkpoint')),
  base_model_id TEXT REFERENCES base_model(id), -- when kind='base_model' (step 5)
  uri TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
```

`adapter_name` rows in `model_evaluation` (already present — `metrics_service/schema.sql`) gain an FK to `training_artifact.id` so the leaderboard can join evaluations back to the producing job and engineer.

### 4.3 Architecture-fingerprint algorithm (step 5)

Naïvely hashing `model.config.to_json_string()` plus all parameter shapes is unstable across HF Transformers versions and produces false positives when only quantization or precision changes. We use a **two-layer fingerprint**: an `arch_fp` over a config allow-list (stable across runtime concerns), and a `weight_fp` over named parameters (changes with quantization or precision). Promotion to "new base model" gates on `arch_fp` divergence only.

**Stable config keys (allow-list).** Anything not in this set is excluded:

```
model_type, architectures,
hidden_size, intermediate_size,
num_hidden_layers, num_attention_heads, num_key_value_heads,
vocab_size, max_position_embeddings,
tie_word_embeddings, is_encoder_decoder,
d_model, encoder_layers, decoder_layers,
encoder_attention_heads, decoder_attention_heads,
encoder_ffn_dim, decoder_ffn_dim,
num_mel_bins, max_source_positions, max_target_positions,
scale_embedding, activation_function,
bos_token_id, eos_token_id, pad_token_id, decoder_start_token_id,
rope_scaling, rope_theta
```

Excluded by design: `transformers_version`, `torch_dtype`, `_name_or_path`, `_commit_hash`, `task_specific_params`, `forced_decoder_ids`, `suppress_tokens`, `begin_suppress_tokens`, `id2label` / `label2id` (ordering noise), `use_cache`, `output_attentions`, `output_hidden_states`, and `quantization_config` (deployment concern, not architecture — surfaces in `weight_fp` instead).

**Weight signature.** Hash `(name, tuple(shape), normalised_dtype)` over `model.named_parameters()` sorted by name. Normalise dtype:
- `{float32, float16, bfloat16, float64}` → `"float"` (kills mixed-precision false positives)
- `{int8, uint8, int4, fp8_e4m3, fp8_e5m2}` → `"quantized"` (preserves the quantization signal in `weight_fp` only)

Use `named_parameters()` not `state_dict()` so rotary cache buffers don't masquerade as architecture drift.

**Adapter detection.** PEFT 0.15+ writes `adapter_config.json` next to `adapter_model.safetensors`. Rule: if `peft_type ∈ {LORA, ADALORA, IA3, DORA, VERA, ...}` AND `modules_to_save` is empty (or contains only LayerNorm / RMSNorm modules), the artefact is a pure adapter; fingerprint with the adapter allow-list `{peft_type, r, lora_alpha, target_modules (sorted), modules_to_save (sorted), bias, task_type}` and write `training_artifact.kind = 'adapter'`. If `modules_to_save` adds any non-norm module (LM head, classifier, projection), promote to `candidate_base` and require human review before publishing — the fine-tune has structurally extended the base.

**Promotion rule.**

| `arch_fp` | `weight_fp` | `modules_to_save` non-norm | Outcome |
|---|---|---|---|
| match | match | — | duplicate publish — reject with 409 |
| match | differ | empty | adapter or fine-tune of same arch (today's path) |
| match | — | non-empty | `candidate_base`, human review queue |
| differ | — | — | **new base model** owned by submitter |

**Reference algorithm** — implements all of the above:

```python
import hashlib, json
from typing import Any

CONFIG_ALLOWLIST = {
    "model_type", "architectures",
    "hidden_size", "intermediate_size",
    "num_hidden_layers", "num_attention_heads", "num_key_value_heads",
    "vocab_size", "max_position_embeddings",
    "tie_word_embeddings", "is_encoder_decoder",
    "d_model", "encoder_layers", "decoder_layers",
    "encoder_attention_heads", "decoder_attention_heads",
    "encoder_ffn_dim", "decoder_ffn_dim",
    "num_mel_bins", "max_source_positions", "max_target_positions",
    "scale_embedding", "activation_function",
    "bos_token_id", "eos_token_id", "pad_token_id", "decoder_start_token_id",
    "rope_scaling", "rope_theta",
}
ADAPTER_ALLOWLIST = {
    "peft_type", "r", "lora_alpha", "target_modules",
    "modules_to_save", "bias", "task_type",
}

def _canon(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)

def _norm_dtype(dt: str) -> str:
    dt = str(dt).lower()
    if any(k in dt for k in ("float32", "float16", "bfloat16", "float64")):
        return "float"
    if any(k in dt for k in ("int8", "uint8", "int4", "fp8")):
        return "quantized"
    return dt

def fingerprint(model, config_dict, adapter_config=None) -> dict:
    cfg = {k: config_dict[k] for k in CONFIG_ALLOWLIST if k in config_dict}
    if isinstance(cfg.get("architectures"), list):
        cfg["architectures"] = sorted(cfg["architectures"])
    arch_fp = hashlib.sha256(_canon(cfg).encode()).hexdigest()

    wt_items = sorted(
        (n, tuple(p.shape), _norm_dtype(p.dtype))
        for n, p in model.named_parameters()
    )
    weight_fp = hashlib.sha256(_canon(wt_items).encode()).hexdigest()

    out = {"arch_fp": arch_fp, "weight_fp": weight_fp, "kind": "base"}
    if adapter_config is not None:
        a = {k: adapter_config[k] for k in ADAPTER_ALLOWLIST if k in adapter_config}
        for key in ("target_modules", "modules_to_save"):
            if isinstance(a.get(key), list):
                a[key] = sorted(a[key])
        out["adapter_fp"] = hashlib.sha256(
            (arch_fp + _canon(a)).encode()
        ).hexdigest()
        out["kind"] = "adapter"
        non_norm = [m for m in (a.get("modules_to_save") or [])
                    if "norm" not in m.lower() and "ln" not in m.lower()]
        if non_norm:
            out["kind"] = "candidate_base"
            out["promotion_reason"] = f"modules_to_save adds: {non_norm}"
    return out
```

**Trust boundary.** The fingerprint must be computed **server-side, by the orchestrator, after the worker uploads its artifact** — never by the worker on its own behalf. A malicious worker could otherwise claim "no deviation" to avoid triggering the human-review path on a `candidate_base`. `POST /jobs/{id}/artifacts` accepts the file; the orchestrator runs `fingerprint()`, persists the result on `training_artifact`, and only then transitions the job to `EVALUATING`.

**Storage on promotion.** When a new base model spawns, write a `base_model` row with `owner_user_id = submitted_by`, `parent_base_model_id = <original>`, `architecture_fingerprint = arch_fp`, `weights_uri = <artifact-store path>`. Surface a "Derived base model" badge on `/training/[id]` and a separate filter chip on the leaderboard (§4.7) — derived bases compete in their own family, not against vendor-base adapters.

### 4.4 Federated training (step 4) — Flower 1.29.x

**Recommendation:** pin **`flwr==1.29.x`** (Apache-2.0) as the resolution to F25 in [`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md). The full framework comparison is at the bottom of this section; the headline reasons are:

1. **PEFT + HF Transformers integration is on Flower's happy path.** `train.py:17` already builds a `PeftModel` from `openai/whisper-large-v3-turbo`; Flower's idiom is "wrap the existing PyTorch loop in a `client_fn`, serialise only the LoRA `state_dict()` as round payload" — ~50 LoC.
2. **Opacus is officially documented in Flower.** Retires F19's "pinned but inert" status; DP wraps the local optimiser inside `client_fn`, no parallel codebase.
3. **SecAgg+ retires P9** (aggregator-sees-plaintext) via `flwr.server.workflow.SecAggPlusWorkflow`.
4. **Azure Container Apps mapping is documented** by Flower; SuperLink ↔ on-prem SuperNode is outbound-from-site mTLS on 9092 — exactly the green/red-zone topology in [`azure-deployment-requirements.md`](azure-deployment-requirements.md).

**Topology.** The orchestrator does **not** become the SuperLink itself — it spawns and supervises a SuperLink subprocess per FL job, the way a CI server manages build agents. New module:

```
backend/training_orchestrator/
  fl/
    supervisor.py              # spawns flwr SuperLink per fl-enabled job
    strategy_factory.py        # FedAvg | FedProx | FedYogi from job env
    dp_wrapper.py              # central-DP wrapper around chosen strategy
    secagg.py                  # SecAggPlusWorkflow config (min_clients=3)
    privacy_ledger.py          # decrements per-user epsilon (P10)
    manifest_signer.py         # signs the round manifest (F29)
```

A new client image `austin-lang/fl-client:<sha>` derives from the existing retraining-pipeline image (inheriting Whisper / PEFT / Opacus pinning):

```
backend/fl-client/
  Dockerfile                   # FROM austin-lang/retraining-pipeline:...
                               # ADD flwr[simulation]==1.29.*
  app/
    client.py                  # NumPyClient: wraps train_one_round()
    auth.py                    # JWT from orchestrator + site mTLS cert
    local_dp.py                # PrivacyEngine wrapped around the Trainer
    artifact_strip.py          # _strip_published_artifacts() BEFORE return (P5)
```

Each site's outbound network surface: **one** TCP/9092 to the orchestrator's SuperLink endpoint, plus existing pseudonymisation traffic. No inbound. No raw audio leaves site. Only LoRA-rank deltas, masked by SecAgg+, leave site.

**Round lifecycle on the orchestrator state machine:**

| State | What happens |
|---|---|
| `QUEUED → PREPARING` | Orchestrator builds per-round config (strategy, DP params, `min_clients`, signed manifest URL); persists to `training_job.env_json`. |
| `PREPARING → RUNNING` | `supervisor.py` starts a SuperLink subprocess on an internal-only port. Returns `{superlink_endpoint: "wss://...:9092", round_id, client_token}` per site via the per-site lifecycle webhook. |
| `RUNNING` | SuperLink drives `SecAggPlusWorkflow`. After `min_clients ≥ 3` updates, central-DP noise is added if `dp_enabled`, aggregated weights written to `training_artifact`. Privacy ledger decrements. |
| `RUNNING → EVALUATING` | Same `post_train_hook.py` path — orchestrator calls `metrics-service /evaluations/run`. |
| `EVALUATING → SUCCEEDED` | Existing path, plus leaderboard cache eviction. |

**FL submission payload extension** (added to §4.1):

```json
"fl": {
  "enabled": true,
  "rounds": 10,
  "min_clients": 3,
  "strategy": "fedyogi",
  "dp": {
    "enabled": true,
    "noise_multiplier": 1.1,
    "max_grad_norm": 1.0,
    "epsilon_target": 8.0,
    "delta": 1e-5,
    "accounting_unit": "per_speaker"
  }
}
```

**Hard cross-cut invariants** the orchestrator must enforce at submission time, not at runtime:

- **`dp_enabled=true` ⇒ 4-bit quantisation OFF** (P3 / F23). Reject the submission with 422 otherwise. The interaction is unsound — quantisation noise is untracked by the privacy budget.
- **`fl.min_clients < 3`** ⇒ reject. SecAgg+ assumes ≥ 3 honest participants per round.
- **Per-user ε ledger must be charged** before SuperLink starts the round, not after. P10 is non-negotiable.
- **Workers must call `_strip_published_artifacts()` BEFORE returning weights to the server**, not after. Verify in client code review (P5).
- **No SCAFFOLD in Flower core.** Default to `fedyogi` for non-IID across sites; if utility collapses, lift a community SCAFFOLD strategy. Track this risk explicitly — non-IID convergence requires more rounds, more rounds spend more ε.

**Until F25 ratification + F21 ε decision land, `target='federated'` returns 501** from the orchestrator. The schema and submission shape accommodate it; the runtime does not.

**Framework comparison** (full reasoning kept here so this doc is the single source of truth for F25):

| Axis | Flower 1.29 | NVFlare 2.7 | PySyft 0.9 | TFF | FedML / TensorOpera | Custom FastAPI |
|---|---|---|---|---|---|---|
| HF + PEFT/LoRA for Whisper | **5** | 3 (NeMo-coupled) | 1 | 2 (TF only) | 2 | 4 (write your own) |
| DP-SGD / Opacus | **5** (official ex.) | 3 (custom filters) | 2 | 3 | 2 | 3 |
| Secure aggregation vs curious server | 4 (SecAgg+) | **5** (HE + SecAgg) | 1 | 2 | 3 | 1 |
| mTLS + Azure CA + on-prem mix | **5** | 4 | 2 | 2 | 3 | 4 |
| Strategy breadth (FedAvg/Prox/Yogi/SCAFFOLD) | 4 (no core SCAFFOLD) | **5** | 1 | 3 | 3 | 1 |
| 2026 governance trajectory | **5** | **5** | 3 (pivoted to Datasites) | 3 | 2 (OSS stalling) | n/a |
| **Total / 30** | **28** | **25** | 10 | 15 | 15 | 13 |

Escape hatch: if regulators demand HE rather than SecAgg+, or > 50 sites onboard with personalisation needs, NVFlare is the correct pivot. The orchestrator schema in §4.2 is framework-agnostic; the pivot is bounded.

### 4.5 Progress reporting (step 6) — SSE, not WebSocket

**Transport: Server-Sent Events.** Single `GET /jobs/{id}/stream` channel multiplexing log lines and structured metric events; browser uses `EventSource` with the built-in `Last-Event-ID` reconnect — survives most corporate proxies, is one-way (we don't need bi-directional), and Next.js 15 + React 19 has trivial integration. WebSocket only buys complexity here; gRPC streaming has no ergonomic browser story for our stack.

**Worker → orchestrator.** The training process posts batched events on `POST /jobs/{id}/events` every ~30 s with an idempotency key per event:

```json
{
  "event_id": "<job_id>:step:4020",
  "ts": "2026-04-28T08:14:32Z",
  "kind": "metric",
  "payload": { "step": 4020, "epoch": 2, "loss": 0.612, "val_loss": 0.754,
               "lr": 2.1e-4, "tokens_per_sec": 18420, "grad_norm": 0.83 }
}
```

`kind` ∈ `{"metric", "log", "status"}`. Server dedupes on `(job_id, event_id)` so worker retries are safe. Every event is also persisted to a metrics table so the detail page is hydratable on reload (the page never depends on having been live during training).

**Orchestrator → browser.** SSE multiplex format:

```
id: 4020
event: metric
data: {"step":4020,"loss":0.612,...}

id: log-12871
event: log
data: {"ts":"...","line":"[INFO] saving adapter..."}
```

Reconnect: client supplies `Last-Event-ID` header; server replays from `events` table.

**Heartbeat & dead-job detection** (mirrors Slurm's 30 s emit / 60 s probe shape):

1. Worker emits `POST /jobs/{id}/heartbeat` every **30 s** with `{step, gpu_util, ts}`.
2. Orchestrator stores `last_heartbeat_at` on `training_job`.
3. Background task scans every 30 s. If `now - last_heartbeat_at > 120 s` (4 missed) AND state ∈ `{PREPARING, RUNNING, EVALUATING}` ⇒ transition to `STUCK`, attempt forceful cancel of the underlying container, emit a `job.stuck` event.
4. Independently, enforce `timeout_seconds` from the submission payload as a hard wall-clock cap (mirrors SageMaker's `MaxRuntimeInSeconds`).
5. Heartbeats are best-effort and idempotent: workers retry with exponential backoff but never block training on a heartbeat failure.

**Local-target nuance.** When `target='local'` (engineer's own machine), the orchestrator can only _record_ the run — heartbeats and event posts are opt-in, requiring the engineer to run a thin `austin-cli` daemon that bridges stdout + metric callbacks to the orchestrator. If that daemon isn't running, the detail page shows "Status: queued (awaiting heartbeat)" indefinitely. Document this on the dialog so engineers know what they're agreeing to. Cloud-target jobs always carry the daemon as part of the worker image.

This replaces today's `MOCK_COMPLETION_DELAY_MS = 8000` and `getTrainingLogs()` mock generator.

### 4.6 Post-train evaluation (step 7)

Already exists end-to-end on the backend — `train.py:209` → `post_train_evaluate()` → `POST /evaluations/run`. The integration change is:

1. The orchestrator's `evaluating` state wraps that hook (`train.py` becomes a worker invoked by the orchestrator, not a CLI run by a human).
2. On `POST /evaluations/run` success, the orchestrator inserts a `training_artifact` row, transitions the job to `published`, and invalidates the leaderboard cache for the affected `(base_model, dataset)` keys (Redis — see [`redis-cache-integration.md`](redis-cache-integration.md)).
3. On evaluation failure the job stays in `evaluating` with `failure_reason` set; the artifact still exists, so an engineer can re-trigger evaluation manually without re-training.

### 4.7 Leaderboard endpoint (step 8)

New endpoint on `metrics-service` (closer to evaluation data than to job state):

```
GET /leaderboard?dataset_id=<id>&base_family=<optional>&group_id=<optional>
```

Returns ranked rows joined from `model_evaluation` ⇄ `training_artifact` ⇄ `training_job` ⇄ `user`:

```json
{
  "datasetId": "...",
  "rows": [
    {
      "rank": 1,
      "engineerId": "u2",
      "engineerName": "...",
      "modelName": "...",
      "baseFamily": "whisper",
      "wer": 0.061,
      "cer": 0.024,
      "rtf": 0.18,
      "submittedAtIso": "...",
      "trainingJobId": "...",
      "artifactId": "..."
    }
  ]
}
```

Server-side scoping by `getGroupIdForRole` (per `leaderboard_research.md` §5.6) — engineers see their group, admins see all. Mock engineer IDs in `mock_data-leaderboard.js` (`eng-priya`, `eng-andreas`, `eng-james`) get reconciled with real `users.db` rows as part of the cutover ([`backend_integration_status.md`](backend_integration_status.md) §3.2 work item 3).

---

## 5. Sequencing

Suggested order, dovetailed into the wave plan in [`fix-triage-frontend-vs-backend.md`](fix-triage-frontend-vs-backend.md) §7 and [`backend_integration_status.md`](backend_integration_status.md) §9:

1. **Land the orchestrator skeleton + schema migrations + `target ∈ {cloud, local}` paths** (steps 3, 6, 7-non-FL). Unblocks the dashboard's `/training` page and lets steps 1, 2, 6 stop being mock-only without touching FL.
2. **Wire the leaderboard endpoint** (step 8) once `training_job` + `training_artifact` rows exist. This is a metrics-service additive change, depends on (1).
3. **Architecture-deviation + base-model registry** (step 5). Independent of (2); can ship in parallel with the orchestrator beta.
4. **Federated path** (step 4) — only after F25 framework ADR and F21 ε decision land. The schema already accommodates it.
5. **DP integration** (step 4 with `dp_enabled=true`) — F22 / F23 / F26 sequenced under F21.

---

## 6. Open questions

- **Script execution model.** Today's UI command preview emits `austin-cli jobs submit … --env .env` which suggests a CLI-driven path the orchestrator merely records. Alternative: the orchestrator owns execution and the CLI is just one client. The latter is what §4 assumes — it is also a much bigger commitment. **Partially answered (2026-04-28):** the simulated worker now lives inside the orchestrator process (`worker.py`) which leans toward orchestrator-owned execution as the default. But the simulated worker doesn't actually run training — when the real worker lands the choice still has to be made. The `WORKER_ENABLED` flag means an out-of-process or out-of-container worker can take the queue without orchestrator changes, so the decision is reversible.
- **Where do training scripts execute when `target='local'`?** The dialog implies the engineer's own machine. If so the orchestrator can only _record_ the run; heartbeats become opt-in and the resource must open an outbound websocket. This matters for step 6 — local jobs may not surface real-time progress at all unless we ship a thin `austin-cli` daemon.
- **Trust boundary on the architecture-deviation check.** The fingerprint must be computed on a service the engineer cannot tamper with. If the worker computes it, a malicious worker can claim "no deviation" to avoid triggering ownership review. Suggest: the orchestrator pulls the artifact and runs the fingerprint itself, _before_ writing `training_artifact`.
- **Adapter vs. derived-base UI surfacing.** The `/training/[id]` page should show a clear distinction when step 5 fired, but leaderboard rows for a derived base model probably shouldn't compete in the same dataset ranking as adapters of vendor bases — different lineage, different fairness story. Needs design input from the leaderboard owner.
- **Storage backend for weights.** Filesystem under `retraining-pipeline/adapters/` works for `target=cloud` today. A real artifact store (S3-compatible or Azure Blob — see [`azure-deployment-requirements.md`](azure-deployment-requirements.md) §2) is needed before federated jobs from multiple sites can publish to a shared registry.

---

## 7. Pointers (TL;DR for future readers)

- Frontend dialog: `frontend/src/app/(dashboard)/training/page.jsx:147–540`.
- Frontend mocks: `frontend/src/services/training-jobs.js`, `frontend/src/services/notifications.js` (the 8 s completion fake).
- Real training entrypoint: `backend/retraining-pipeline/train.py:46–209`.
- Real post-train hook: `backend/retraining-pipeline/post_train_hook.py:56–127`.
- Real evaluation receiver: `backend/metrics_service/main.py` `POST /evaluations/run` (§5.3 of [`../06 server/metrics-service-module.md`](../06%20server/metrics-service-module.md)).
- Stub that pretends step 7 works on the dashboard side: `frontend/src/services/analytics.js:71` (`triggerRetraining()`).
- Sidebar nav: `frontend/src/app/(dashboard)/components/SidebarShell.jsx:19`.
- Leaderboard mocks: `frontend/src/services/mock_data-leaderboard.js`, `mock_data-leaderboard-custom.js`.
