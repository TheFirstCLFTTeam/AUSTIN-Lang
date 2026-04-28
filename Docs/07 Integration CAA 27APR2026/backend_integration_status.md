# Backend ↔ Frontend Integration Status

_Last audited: 2026-04-28 (branch `ui_enhancement`)_

Master status board for everything wired (or planned to be wired) across the Next.js frontend, the FastAPI backend services, and the surrounding infra. Consolidates the ten sibling docs in this folder so anyone can take stock without grepping through them. Each row points at the detail doc that owns the design.

---

## At a glance

| Workstream | State | Owner | Detail |
|---|---|---|---|
| Upload → transcription → edit pipeline | ✅ shipped | FE + BE | [`audio-to-edit-pipeline.md`](audio-to-edit-pipeline.md), [`file_viewing_pipeline.md`](file_viewing_pipeline.md) |
| Pseudonymisation review loop | ✅ shipped | FE + BE | [`audio-to-edit-pipeline.md`](audio-to-edit-pipeline.md) §1.5 |
| Security baseline — Wave 1 (15 fixes) | ✅ shipped this branch | FE + BE + Infra | [`fix-implementation-log.md`](fix-implementation-log.md) §1 |
| Metrics → Dashboard | ✅ shipped this branch (live series in render path) | FE + BE | this doc §3.1, [`../06 server/metrics-service-module.md`](../06%20server/metrics-service-module.md) |
| Leaderboard | 🟡 stubbed (no BE) | FE + BE | this doc §3.2 |
| Retraining / Training Jobs | 🟡 in progress (orchestrator + simulated + real CLI-driven worker shipped; heartbeat/log SSE + base-model registry pending) | FE + BE | this doc §3.3, [`training-job-pipeline.md`](training-job-pipeline.md) |
| User profile sync | 🟡 stubbed (decision pending) | FE + BE | this doc §3.4 |
| Redis cache middleware | ✅ shipped this branch (read-through file detail + per-user recents + invalidation hooks) | FE + Infra | [`redis-cache-integration.md`](redis-cache-integration.md) |
| Transcript edit versioning | ✅ shipped this branch (data model + write/read refactor + endpoints + UI + restore-with-no-hanging-drafts) | FE + BE | [`transcript-versioning-plan.md`](transcript-versioning-plan.md) |
| Meeting webhook ingestion (Teams + Zoom + Generic + Google Meet stub) | ✅ shipped this branch (factory pattern; Teams + Zoom + Generic ready, Google Meet pattern stub) | new BE service | [`meeting_recording_webhooks.md`](meeting_recording_webhooks.md) |
| Financial terms dictionary | 🟡 slices 1-3 + 5 shipped (microservice + 10 endpoints + 47 BE tests + CSV cleaner 6,013/303 split + FE proxies + admin moderation page + "💼 Add to dictionary" affordance + auto-trail occurrence hook + 22 FE tests); metric integration (slice 4) pending | new BE service + FE admin page | [`financial-terms-dictionary.md`](financial-terms-dictionary.md) |
| Custom metrics pipeline (user-uploaded `.py`) | 📐 specced, not built (FE dialog + schema column already exist; backend execution + sandbox + persistence missing) | metrics-service + FE | [`custom-metrics-pipeline.md`](custom-metrics-pipeline.md) |
| Security baseline — Wave 2 (CSRF token + prod CSP) | ✅ shipped this branch | FE | [`fix-implementation-log.md`](fix-implementation-log.md) §1 |
| FL / DP enablement (Wave 3) | ⏸ deferred (governance) | BE + Governance | [`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md), [`fix-triage-frontend-vs-backend.md`](fix-triage-frontend-vs-backend.md) Wave 3 |
| Cloud move (Wave 4 — Azure) | ⏸ deferred (infra) | Infra | [`azure-deployment-requirements.md`](azure-deployment-requirements.md) |

Legend: ✅ in production / on `ui_enhancement` · 🟡 partial · 📐 designed but not built · ⏸ deferred / blocked.

---

## 1. Done — Real Integrations

Frontend already talks to a real backend service for these features. All of them survive a flip of `NEXT_PUBLIC_MOCK_API=false`.

| Feature | Frontend entry | Backend service | Endpoint |
|---|---|---|---|
| Upload & transcription | `/api/upload` | `transcription-orchestrator:8001` | `POST /transcribe/` |
| Adapter discovery (LoRA list) | `/api/adapters` | `transcription-orchestrator:8001` | `GET /adapters/` |
| Transcript edits | `/api/audio-files/[id]/edits` | `database:8002` | `PUT /edited-transcripts/{id}` |
| Pseudonymisation run | `/api/pseudonymisation/[fileId]/run` | `pseudonymisation-orchestrator:5002` | `POST /transcripts/{id}/submit-for-review` |
| Pseudonymisation spans | `/api/pseudonymisation/[fileId]/spans` | `pseudonymisation-orchestrator:5002` | `GET /transcripts/{id}/pseudonymisation` |
| Span decisions | `/api/pseudonymisation/[fileId]/spans/[spanId]/decision` | `pseudonymisation-orchestrator:5002` | `POST /spans/{id}/decision` |
| Approval gate | `/api/audio-files/[id]/approve` | `pseudonymisation-orchestrator:5002` | (gate check before completion) |

**Open follow-ups inside "done" items**

- `transcript_edit` schema is char-level with `add`/`delete`; UI edit model is word-level with `insert | delete | replace`. Round-trip loses `replace` info. (See [`02 frontend/integration fixes.md`](../02%20frontend/integration%20fixes.md) §3 and the JSON-in-`content` workaround in [`audio-to-edit-pipeline.md`](audio-to-edit-pipeline.md) §6.)
- ~~Edits are destructively rewritten on every save.~~ **Fixed 2026-04-28** — slice 1 of `transcript-versioning-plan.md` landed: `transcript_edit` rows are now tagged with `version_id` and the destructive `DELETE … INSERT` only matches the draft (is_current=1) version. Frozen versions are immutable. Endpoints + UI for browsing/diffing/restoring versions are deferred to slice 2.

---

## 2. Done — Security Baseline (Wave 1, this branch)

Fifteen fixes from the security triage have landed on `ui_enhancement`. Detail per fix in [`fix-implementation-log.md`](fix-implementation-log.md) §1.

| # | Fix | What it closes |
|---|---|---|
| F2 | Boot guards on missing `JWT_SECRET` / `PSEUDONYM_FERNET_KEY` / `GLINER_SHARED_SECRET` in production | Silent dev-default in prod |
| F3 | FE sends real `X-User-Role` instead of hardcoded `reviewer` | Role spoofing |
| F4 | `requireOwnerOrRole` on per-file mutation routes (edits, approve, request-changes, submit-for-review) | IDOR |
| F5 | Sliding-window rate limit on `/auth/login` (8/60s/IP) | Credential stuffing |
| F6 | Upload validation — size cap, MIME allow-list, magic-byte sniff | Malicious uploads |
| F7 | `__Host-token` cookie + security headers (XCTO, XFO, RP, PP, HSTS) via `next.config.ts` | Cookie hijack, clickjacking |
| F8 | Origin/Referer check + double-submit `__Host-csrf-token` (auto-attached by `services/http.js`, verified constant-time in `proxy.js`) | CSRF (both layers) |
| F9 | Backend CORS hardening (`allow_origins` env-driven, methods enumerated) | Browser-side CORS abuse |
| F10 | Dependabot extended to npm + pip (eight backend service dirs + `/frontend`) | Supply chain |
| F11 | Per-request CSP nonces (`script-src 'self' 'nonce-X' 'strict-dynamic' 'wasm-unsafe-eval'`); dotlottie WASM self-hosted from `/public` so `connect-src 'self'` stays clean; smoke-tested under `next build && next start` | XSS |
| F13 | Generic `detail` responses; real error logged server-side only | Stack-trace leakage |
| F17 | Auth-event logging (`login_succeeded`, `login_failed`, `logout` in `audit_event`) | Forensics |
| F19 | `opacus==1.5.2` pinned in retraining pipeline (inert, ready for DP-SGD wire-in) | Reproducibility |
| F24 | `_strip_published_artifacts()` in `train.py` removes `training_args.bin`, `trainer_state.json`, `runs/` | DP hyperparameter side channel ([`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md) §4.5 / P5) |

**Verification checklist before this branch ships** lives in [`fix-implementation-log.md`](fix-implementation-log.md) §4 — run it before any merge to `main`.

---

## 3. Stubbed — Backend Wiring Required

### 3.1 Metrics & Dashboard

> Full module reference: [`../06 server/metrics-service-module.md`](../06%20server/metrics-service-module.md). This row is the integration-status summary only.

- **Original state:** Frontend reads from `mock_data-dashboard.js`; `getDashboardStats()` returns mock object. Backend `metrics-service:8006` only exposed an operational WER aggregate over `database:8002`, not per-(model × dataset) evaluation. Service was never wired into `compose.yaml`.
- **Re-scoped:** the dashboard wants base-vs-finetuned series across ~14 metrics. That needs (a) a place to store evaluation rows, (b) a way to add new metrics without touching the runner, (c) a hook that fires when training finishes. Built as one service buildout instead of FE-only proxy work.

**Landed (this branch):**

| Layer | What landed |
|---|---|
| Strategy pattern | `backend/metrics_service/strategies/` — `MetricStrategy` ABC + `Sample`/`StrategyResult` dataclasses, `@register_strategy` registry (rejects duplicates + missing names), `MetricsRunner` single-pass dispatcher, shared `_text.normalise/tokenise_words/tokenise_chars/levenshtein` helpers. Four concrete strategies: `f1` (token overlap), `wer`, `cer` (CJK-friendly), `sequence_match_rate`. Adding a new metric = one new file + one import line. |
| Storage | `schema.sql` + `storage.py` — `model_evaluation` (with `adapter_name IS NULL` rows for the base-model baseline, mirroring PEFT's `disable_adapter()` semantics) + `evaluation_metric` with FK cascade. `MetricsStore` provides `record_evaluation`, `get_evaluation`, `list_evaluations` (with `__base__` sentinel for adapter-IS-NULL filter), `list_metrics_for_evaluation`, `list_strategy_names`, `latest_metric_pair` (base + finetuned + delta, ignores failed runs), `latest_metric_series` (chronological N points per role for chart rendering), `delete_evaluations_with_notes` (cascade-deletes via FK). Idempotent schema init via `executescript` on `CREATE IF NOT EXISTS` DDL. |
| HTTP API | `main.py` — operational endpoints unchanged (`GET /metrics/dashboard`, `GET /metrics/accuracy/{file_id}`, `POST /metrics/refresh`); five new evaluation endpoints (`POST /evaluations/run`, `POST /evaluations/baseline`, `GET /evaluations`, `GET /evaluations/{id}`, `GET /metrics/by-dataset?series_points=N`). `/metrics/by-dataset` defaults to "strategies recorded in the DB for the (base_model, dataset)" — not just `list_strategies()` — so seeded metrics surface even before a runnable `MetricStrategy` exists. `/health` now also returns the registered strategy list. |
| Manifest + adapter helpers | `manifest_loader.py` — JSONL → `list[Sample]` with line-numbered errors; `adapter_meta.py` — reads `base_model_name_or_path` from `adapter_config.json` (allowlisted by `_strip_published_artifacts`). |
| Mock seeder | `seed_mock.py` — mirrors `frontend/src/services/mock_data-dashboard.js`: 14 metrics × 5 days × 2 roles (base + finetuned) = 140 metric rows. Idempotent via `notes='seed:mock'` (FK cascade clears the metric rows on re-run; real runs survive). Runnable via CLI (`python seed_mock.py`) **or** auto-fired on first boot via the `SEED_ON_BOOT` lifespan hook in `main.py` when the DB is empty (so a fresh `metrics_data` volume gets a populated dashboard with no extra step). |
| Post-train hook | `backend/retraining-pipeline/post_train_hook.py` — extracted from `train.py` so it's testable without importing torch/transformers. `post_train_evaluate(adapter_dir, adapter_name)` reads `base_model` from `adapter_config.json` and best-effort POSTs to `${METRICS_SERVICE_URL}/evaluations/run`. **Failure is logged at WARNING and never raised** — training success does not depend on metrics availability. Resolution order per input: explicit kwarg → env var → default → skip with INFO log. Wired into `train_one_round()` step 10, after `_strip_published_artifacts()`. |
| compose.yaml | New `metrics-service` block (port `${METRICS_SERVICE_PORT}`, depends on `database`, mounts source + adapters read-only + `metrics_data` volume). Frontend `depends_on` adds metrics-service; `METRICS_SERVICE_URL` injected. New `metrics_data` named volume. |
| FE proxy routes | `frontend/src/app/api/metrics/route.js`, `metrics/by-dataset/route.js`, `metrics/refresh/route.js`, `audio-files/[id]/accuracy/route.js`. All `requireUser`-gated (the per-file accuracy route uses `requireOwnerOrRole` per F4 + resolves the FE's external id to the backend's `backend_audio_file_id`). 15s `AbortController` timeouts. Distinguish 404 (no metrics yet) from 502 (upstream down) so the UI can render an empty state. |
| FE client | `frontend/src/services/metrics.js` rewritten to call same-origin proxy paths only — `NEXT_PUBLIC_METRICS_SERVICE_URL` retired. Exposes `fetchDashboardMetrics`, `fetchFileAccuracy`, `fetchMetricsByDataset({dataset, baseModel, strategies?, seriesPoints?})`, `refreshMetricsCache`. |
| FE merge layer | `frontend/src/services/live-dashboard-metrics.js` — `useDashboardSeries({dataset, baseModel, seriesPoints})` hook (no-op in mock mode), `mergeMetricsWithLive(mockMetrics, apiResponse)` overlays `value`/`sublabel`/`series.{baseModel,fineTuned,currentValue,difference}` per id-matched metric, mock supplies `unit`/`yMin`/`yMax`. **Falls back to mock on any backend failure** so the dashboard never breaks. Hook + merge wired into `frontend/src/app/(dashboard)/dashboard/page.jsx` (3-line change). |
| Tests | **106 total**: 87 metrics-service (strategies 17, storage 12, storage-extras 4, metric-series 6, manifest-loader 8, adapter-meta 7, seed-mock 6, text-strategies 27) + 9 retraining-pipeline (post-train hook) + 10 FE merge layer. |

End-to-end loop: `train.py` → `post_train_hook` → `POST /evaluations/run` → `metrics.db` → `GET /metrics/by-dataset` → `/api/metrics/by-dataset` → `useDashboardSeries` → `MetricChart`. Falls back to seeded mock when no real evaluation rows exist; falls back to FE mock when the metrics service is unreachable.

**Pending follow-ups:**

1. Implementations for the remaining dashboard metrics. WER, CER, SMR shipped this branch alongside F1; nine remain (W-WER, L-CER, CS-PIER, WDER, F-NER, etc.). Each is one file in `strategies/` + one import line + a unit test — see [`../06 server/metrics-service-module.md`](../06%20server/metrics-service-module.md) §4.5. Most of the remaining nine need richer per-sample metadata (language tags, entity tags, speaker labels, word weights) — that's a manifest-format addition, separate from the strategy itself.
2. Inference fan-out in `/evaluations/run` — today the eval manifest must carry `hypothesis`. A follow-up PR will let it be omitted and have metrics-service POST each clip to `transcription-service-2:/transcribe?domain=<adapter>` to fill it in.
3. `METRICS_BASELINE_FRESHNESS_DAYS` enforcement — the schema and pair query support it; the post-train hook doesn't yet check it before triggering a baseline re-run. Default 30 days.
4. Per-dataset / per-base-model selection in the dashboard (currently hardcoded to `default_eval` + `openai/whisper-large-v3-turbo`). Becomes relevant when multiple datasets are evaluated.

### 3.2 Leaderboard
- **State:** `leaderboard/page.jsx` populates from `getCustomMockLeaderboard()` (`mock_data-leaderboard.js`, `mock_data-leaderboard-custom.js`).
- **Backend:** No endpoint exists.
- **Work:**
  1. Define backend service (likely a new endpoint on `metrics-service` or a dedicated leaderboard service) returning `{ datasetId, rows: [{ engineerId, modelFamily, wer, … }] }`.
  2. Apply `getGroupIdForRole`-based scoping server-side (per `leaderboard_research.md` §5.6 — currently copy-only on the page).
  3. Reconcile mock engineer IDs (`eng-priya`, `eng-andreas`, `eng-james`) with real `users.db` rows — they don't exist today.

### 3.3 Retraining / Training Jobs

> Full end-to-end design (sidebar → dialog → resource → base-model registry → progress → metrics → leaderboard): [`training-job-pipeline.md`](training-job-pipeline.md). This row is the integration-status summary only.

- **State:**
  - `triggerRetraining()` in `/services/analytics.js` is a 2 s `setTimeout` stub (its log even says "BACKEND HANDOVER").
  - `/api/processing-jobs` lists from `platform.db` only; no orchestration.
  - `/training` page reads `MOCK_PROCESSING_JOBS`.
  - "New Train Job" dialog (`training/page.jsx:147–540`) captures every field but the LAUNCH button just closes the modal — no submission contract.
  - Retraining pipeline only runs as manual CLI in `backend/retraining-pipeline/`.
  - No `training_job` / `base_model` / `training_artifact` tables in `database/main.py`.
  - No FL framework imported (`requirements.txt` ships `peft` + `transformers` + `opacus==1.5.2` pinned but inert; no `flwr` / `nvflare` / `syft`).
**Landed (this branch — orchestrator skeleton):**

| Layer | What landed |
|---|---|
| New service | `backend/training_orchestrator/` (port `${TRAINING_ORCHESTRATOR_PORT}` = 8008; 8007 is taken by `meeting-webhooks`, **doc reference to "port 8007 suggested" is now stale** in both this doc and `training-job-pipeline.md` §1 — orchestrator runs on 8008). FastAPI app, own SQLite DB on a `training_orchestrator_data` volume. |
| Schema | `schema.sql` — `training_job` (id, name, submitted_by, submitted_at, status, target, base_model, dataset_ref, data_zone, env_json, fl_enabled, dp_enabled, progress_pct, started_at, finished_at, failure_reason). Indexed on submitter + status. Carries `data_zone` from day one per FR-M05 / NFR-P02. Subset of the design schema in [`training-job-pipeline.md`](training-job-pipeline.md) §4.2 — `base_model` and `training_artifact` registry tables defer to a follow-up slice (architecture-deviation work — design open question 3 on trust boundary). |
| Storage | `storage.py` — `JobStore` with `submit`, `get`, `list` (filterable by submitter/status), `transition` (state machine — `queued → preparing → running → evaluating → published`, plus `paused` / `cancelled` / `failed` off-paths; rejects illegal jumps with `JobError` carrying status code), `cancel` helper. State milestones stamp `started_at` / `finished_at` automatically. Microsecond-precision UTC timestamps so consecutive submissions sort deterministically. Federated runs guard-rejected with HTTP 501 referencing F25 ADR. |
| HTTP API | `main.py` — `POST /jobs`, `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/cancel`, `POST /jobs/{id}/transitions/{new_status}` (worker-side), `GET /health`. Pydantic models for request + response. Validation errors propagate the JobStore's status code (400 / 404 / 409 / 501). |
| compose.yaml | `training-orchestrator` block + `training_orchestrator_data` volume. Frontend `depends_on` adds it; new `TRAINING_ORCHESTRATOR_URL` env injected. `TRAINING_ORCHESTRATOR_PORT=8008` in `backend/.env`. |
| FE proxies | `frontend/src/app/api/training-jobs/route.js` (GET list, POST submit), `[id]/route.js`, `[id]/cancel/route.js`. All `requireUser`-gated, 15s `AbortController` timeouts. **POST stamps `submitted_by` from the cookie session** — clients can't claim to be another user (F4 spirit). Upstream validation errors (400 / 501) pass through unchanged so the dialog can surface the orchestrator's reason. |
| FE client | `frontend/src/services/training-jobs.js` — new exports `submitTrainingJob`, `listTrainingJobs`, `getTrainingJobDetail`, `cancelTrainingJob` (mock list + log helpers preserved for now). |
| FE wiring | `frontend/src/app/(dashboard)/training/page.jsx` — "LAUNCH EXPERIMENT" button now submits via `submitTrainingJob` (was `setShowExperiment(false)`). Loading state ("SUBMITTING…"), inline error surface, base-model display name → HF id mapping (`Whisper Large-v3` → `openai/whisper-large-v3-turbo`, etc.). |
| Tests | **29 total**: 20 storage (submit validation, federated guards, state machine happy path + illegal jumps + terminal-state guard, list filters, ordering, cascade FK, idempotent re-init) + 9 endpoint (TestClient: health, submit 201, validation 400, federated 501, list filters, cancel + double-cancel 409, lifecycle sequence, illegal jump 409). |

**Worker (simulated, this branch):** `worker.py` — `SimulatedWorker` claims oldest queued job (FIFO), transitions `preparing → running → evaluating → published` with periodic progress updates over `WORKER_SIMULATED_DURATION_SECONDS` (default 30s). Spawned on FastAPI startup as a daemon thread when `WORKER_ENABLED=true` (default). Race-safe (skip-and-continue if claim loses), cancellation-aware (bails when an external cancel fires), error-isolated (`run_forever` swallows per-iteration exceptions so one bad job can't kill the loop). **Honest about what it is:** the module docstring + log lines call out "simulated — does not run real training". Real training stays a CLI-on-a-GPU-box concern (`cloud_train_sync.sh` SSH path); when a real worker container takes the queue, set `WORKER_ENABLED=false` here and the orchestrator API is unchanged. 10 worker tests added (claim happy path, oldest-first ordering, skip non-queued, full lifecycle drive-through, monotonic progress, cancel-mid-run bail, run_once true/false return, run_forever stops + survives a poisoned `simulate`).

**Pending (not in this slice):**

1. ~~**Real-training worker.**~~ _Done 2026-04-28._ `backend/training_orchestrator/real_worker.py` invokes `cloud_train_sync.sh` as a subprocess, parses stdout for state markers (Step 4 → running, Step 5 → evaluating) + HF Trainer progress (`{'loss': …} step/total` regex), drives `JobStore.transition()` end-to-end. Open Q1 resolved: **CLI-driven mode** (orchestrator records state while the script SSHes to the GPU box). `WORKER_MODE=simulated|real` env flag picks worker; default stays simulated for backwards compat. **Cancel = terminate-on-cancel** — SIGTERM with 10 s grace, SIGKILL fallback. `cloud_train_sync.sh` + `train.py` parametrised so per-job `env_json` (ADAPTER_NAME, MANIFEST_NAME, EPOCHS, BATCH_SIZE, …) drives the run without script edits. New `JobStore.update_progress()` writes `progress_pct` without touching status (closes the running→running gap the simulated worker noted). 15 new pytest cases on top of the existing 39 — all 54 orchestrator tests green.
2. **Heartbeat + log SSE** for the detail page — replaces `MOCK_COMPLETION_DELAY_MS = 8000` and `getTrainingLogs()`. ([`training-job-pipeline.md`](training-job-pipeline.md) §4.5)
3. **Script upload** (`POST /jobs/{id}/script`) — multipart, size-capped, MIME-sniffed (same harness as F6).
4. **`base_model` + `training_artifact` registry tables** + **architecture-deviation check** ([`training-job-pipeline.md`](training-job-pipeline.md) §4.3). The fingerprint must be computed orchestrator-side, never trust the worker's claim.
5. **Federated path** — schema carries `fl_enabled` + `target='federated'`; runtime returns 501 until F25 (FL framework ADR) lands.
6. **Leaderboard endpoint** on metrics-service joining `model_evaluation` ⇄ `training_artifact` ⇄ `training_job` ⇄ `user` ([`training-job-pipeline.md`](training-job-pipeline.md) §4.7) — depends on (4).
7. **List page real-data swap.** `/training` page still reads the `TRAINING_JOBS` mock for its table render. The orchestrator returns the canonical list now via `listTrainingJobs()`; the table can swap when the worker exists and produces non-empty rows for the e2e demo.

### 3.4 User Profile
- **State:** `/api/user-profile` reads `users.db` (SQLite) only; no backend sync.
- **Decision needed:** intentional (auth pilot owns users) or should profile reads/writes round-trip through an auth/identity service? Confirm with auth team before wiring.

---

## 4. Specced — Awaiting Implementation

Four substantial workstreams have been designed in detail but no code has landed yet. Each has its own dedicated doc; the lines below are the one-paragraph summary plus the integration touchpoints into the rest of this status board.

### 4.1 Redis cache middleware — [`redis-cache-integration.md`](redis-cache-integration.md)

**Shipped this branch (2026-04-28).** Read-through Redis cache between `GET /api/audio-files/{id}` and `getAudioFileDetail()`, plus a server-side per-user "recently viewed" list. All cache calls are fail-open — a Redis outage degrades to today's SQLite latency, never to a 5xx.

What landed:

- **New service** in `compose.yaml`: `redis:7-alpine` with `--appendonly no` (cache is fully reconstructible from `platform.db`) + `--maxmemory 256mb --maxmemory-policy allkeys-lru` so even un-TTL'd keys get evicted under memory pressure. Healthcheck + frontend `depends_on`. The previously-staged-but-commented-out block was uncommented and aligned to the spec's no-AOF rationale.
- **New module:** `frontend/src/server/cache.js` — `getCachedDetail` / `setCachedDetail` / `invalidateDetail` for the file-detail payload (120 s soft TTL + explicit invalidation), `recordRecent` / `listRecents` for the user's recently-viewed list (LPUSH + LREM dedupe + LTRIM cap-at-50, mirrored into a hash for `accessedAt` lookups). Singleton `ioredis` client with `maxRetriesPerRequest: 1` + `enableOfflineQueue: false` so requests fail fast instead of queueing under outage. Every public function wraps in try/catch — the module disabled (no `REDIS_URL`, or `NEXT_PUBLIC_MOCK_API=true`) returns the documented no-cache sentinels (`null`, `[]`, `undefined`) without throwing.
- **Route wiring:** `frontend/src/app/api/audio-files/[id]/route.js` is now read-through; `recordRecent(user.id, id)` fires-and-forgets on every successful detail read.
- **Invalidation hooks** added at `writeEditsForFile` (slice 1's draft saves), `setAudioFileStatus` (the freeze hook), `restoreVersion` (slice 2's new draft creation), and the two pseudonymisation routes (`/run` + `/spans/[spanId]/decision` — both can flip `pseudonymisationApplied` / `pseudonymisationWarning` flags surfaced in the cached payload). `writeEditsForFile` and `restoreVersion` are now async to await the invalidation; the existing route callers + tests were updated.
- **New endpoint:** `frontend/src/app/api/recents/route.js` → `{ items: [{ id, accessedAt }, …] }`. `requireUser`-gated.
- **Client hydration:** `src/lib/recents.js` gained `hydrateFromServer(userId)` — fetches `/api/recents`, merges into the `localStorage` map (server entries win on tie), dispatches the existing `RECENTS_EVENT` so subscribed widgets re-render. Wired into `AuthHydrator.jsx` so it fires once per dashboard mount.
- **Env wiring:** `REDIS_URL` injected into the frontend container (commented placeholder uncommented), `REDIS_PORT` added to `backend/.env`.
- **Tests** — 7 new vitest cases in `src/__tests__/cache.test.js` against an in-memory ioredis fake: read-through hit/miss, invalidation, recents dedupe + 50-cap + meta hash pruning, empty-recents path, plus two fail-open cases (no `REDIS_URL`; `NEXT_PUBLIC_MOCK_API=true`). All slice 1/2 versioning tests still pass after the async-conversion of `writeEditsForFile` and `restoreVersion` — total 33 tests on the branch.

Pending follow-ups (left as deferred from spec §9):

1. **Pseudonymisation span caching** — out of scope for v1; add `pseudo:spans:{fileId}` if `/api/pseudonymisation/{fileId}/spans` becomes a hot path.
2. **Single-flight stampede protection** — soft TTL bounds blast radius; add `SET NX PX 2000` lock only if logs show concurrent cold reads.
3. **Role-aware cache key** — flag for the day a per-role payload variant lands (`audio:detail:{fileId}:{role}`).
4. **Cluster move (Azure Cache for Redis)** — `REDIS_TLS=true` + `rediss://` switch when this hits the cloud.

### 4.2 Transcript edit versioning — [`transcript-versioning-plan.md`](transcript-versioning-plan.md)

Replaces today's destructive `DELETE-then-INSERT` write path with an append-only, version-pointer model. New `transcript_version` table holds named checkpoints (`draft` / `submitted` / `approved` / `changes_requested` / `restored`); `transcript_edit` gains a `version_id` FK. **Frozen versions are never updated or deleted** — that's the core requirement. Drafts stay mutable to avoid microversion explosion on autosave.

- **Schema migration:** `database(FE)/seed/migrations/0001_add_transcript_versioning.sql` (idempotent).
- **New endpoints:** `GET /versions`, `GET /versions/{vNo}`, `GET /versions/{a}/diff/{b}`, `POST /versions/{vNo}/restore`.
- **Cross-cuts:** every freeze / restore must call `cache.invalidateDetail()` from §4.1; `audio-to-edit-pipeline.md` §6 needs an update once the new write path lands.

### 4.3 Meeting recording webhooks (factory pattern; Teams + Zoom + Generic + Google Meet) — [`meeting_recording_webhooks.md`](meeting_recording_webhooks.md)

**Shipped this branch (2026-04-28).** The `backend/meeting_webhooks` FastAPI service is now end-to-end functional and structured around a factory/registry pattern so adding Slack, Discord, Webex, etc. is one new file + one import line — no changes to routes, dedupe, the renewal cron, or the transcription handoff.

What landed:

- **Factory + registry** in `backend/meeting_webhooks/app/providers/base.py`. Concrete providers subclass `BaseProvider`, decorate with `@register_provider`, and the eager imports in `providers/__init__.py` populate the registry at FastAPI startup. The catalogue endpoint (`GET /providers`) iterates the registry, so the integrations page picks up new providers automatically.
- **Four providers ship in this branch:**
  - `teams.py` — full implementation (admin-consent OAuth, Graph subscription create + renew, validation handshake, clientState enforcement, app-only token refresh, streaming download).
  - `zoom.py` — full implementation (Marketplace S2S OAuth instructions, URL-validation handshake, HMAC-SHA256 + 5-min replay-window check, `recording_files[]` walk filtered to `M4A` + `status=completed`, streaming download with Bearer `download_token` and S2S `access_token` fallback).
  - `generic.py` — pluggable HMAC-signed webhook for any platform that can POST JSON. Body `{ recording_id, audio_url, organiser_email?, audio_url_auth?, … }` signed `v0:{ts}:{rawBody}` keyed by `GENERIC_WEBHOOK_SECRET`. The intended landing pad for Slack Huddles / Discord recording bots / Lambda forwarders / internal services.
  - `google_meet.py` — pattern stub demonstrating the contract; every required method is present, raising `NotImplementedError` with inline comments pointing at the Drive Activity / Drive v3 endpoints to fill in.
- **Schema migration** `database(FE)/seed/migrations/platform/0002_add_source_attribution.sql` — `audio_file` gains `source_provider`, `source_recording_id`, `source_meeting_id`, `source_organiser`, plus a partial unique index `ux_audio_file_provider_rec ON (source_provider, source_recording_id) WHERE source_provider IS NOT NULL` that doubles as the webhook dedupe gate. `schema_platform.sql` updated for fresh-seed parity.
- **`registerUploadedFile` + `/api/integrations/ingest`** thread provider attribution through. Idempotent — re-delivery of the same `(provider, recording_id)` returns the existing detail rather than re-inserting. The ingest route also resolves `organiser_email → users.db user.id` so webhook-ingested files end up under the right owner when the host's email is registered.
- **`getAudioFileDetail`** returns `source: { provider, recordingId, meetingId, organiser } | null`. The file detail page renders a `SOURCE: ZOOM/TEAMS/GOOGLE MEET/GENERIC` badge next to the status badge with provider-tinted colours.
- **Proactive renewal cron** in `app/renewal.py` — asyncio task on FastAPI startup, scans `subscription` for rows expiring within 36 h every 30 min and PATCHes via `provider.renew_subscription`. Provider-agnostic via a `BaseProvider.renew_subscription` default that raises `NotImplementedError`; providers that don't have long-lived subscriptions (Zoom, generic, Google Meet) are skipped silently. Disabled via `WEBHOOK_RENEWAL_ENABLED=false` for tests.
- **Mock mode** preserved across all four providers — leaving creds blank with `ALLOW_MOCK_CONNECT=true` lets the integrations page exercise Connect → Disconnect end-to-end.
- **Tests** — 16 stdlib `unittest` cases in `backend/meeting_webhooks/tests/test_providers.py`: registry duplicates rejected, Zoom URL-validation handshake, Zoom signature pass + replay-window fail + tamper detection, Zoom event extraction (M4A filter + status filter + non-recording events), generic HMAC pass + tampered body + missing headers, generic event extraction with extension inference, and renewal-cron `renew_subscription` override detection.
- **README** rewritten with a full "Adding a provider" walkthrough using a hypothetical `SlackHuddleProvider` as the worked example, plus reference-implementation notes pointing at each existing provider's strengths.

**Pending follow-ups (not blocking today):**

1. Teams `includeResourceData: true` — X.509 keypair plumbing for sub-second resource fetch instead of the current resource-path follow-up GET.
2. Background queue — swap FastAPI `BackgroundTasks` for Celery/RQ once we want durable retries beyond a single process restart.
3. KMS-wrap `connection.credentials_json` at rest — currently plain JSON; fine for SQLite-on-trusted-volume, not for Azure.
4. Fill in Google Meet's `extract_recording_events` + `download_recording` against Drive Activity / Drive v3 when we prioritise that platform.

### 4.4 Financial terms dictionary — [`financial-terms-dictionary.md`](financial-terms-dictionary.md)

**Slices 1, 2, and 3 shipped this branch (2026-04-28).** `backend/Financial_terms_dictionary/` FastAPI microservice on port **8009** is up: schema + storage helpers + 10 endpoints + role gates + container + compose wiring + CSV bulk-import with cleaning heuristics + FE proxies + admin moderation page + selection-based "💼 Add to dictionary" affordance on the file detail page. Slice 4 (`financial_term_accuracy` strategy + dataset_builder integration) and slice 5 (auto-trail occurrence hook in `writeEditsForFile`) are the remaining pending work — see the per-slice breakdown in [`financial-terms-dictionary.md`](financial-terms-dictionary.md) §10.

Slice 3 specifics:

- **6 FE proxy routes** under `frontend/src/app/api/financial-terms/`: `route.js` (GET list / POST submit), `[id]/route.js` (GET / PATCH moderate), `occurrences/route.js` (POST), `occurrences/stats/route.js` (GET), `snapshot/route.js` (GET — for the auto-trail cache in slice 5), `bulk-import/route.js` (POST, admin-gated). All `requireUser`-gated; forward `X-User-Id` + `X-User-Role` to the microservice for upstream role enforcement.
- **Service layer** at `frontend/src/services/financial-terms.js` — `fetchTerms`, `fetchTerm`, `submitTerm`, `moderateTerm` / `moderateTermPatch` (PATCH not on the http helper, so direct fetch with CSRF token attached), `fetchStats`, `recordOccurrence`, `fetchSnapshot`, `runBulkImport`, plus `getCachedSnapshot` (5-min TTL — the cache that slice 5's auto-trail hook will consume to look up edit `before` text without per-edit network calls). Mock-mode branches return a small in-memory fixture so dev mode renders the admin page populated.
- **Admin moderation page** at `frontend/src/app/(dashboard)/admin/financial-terms/page.jsx`. Three tabs: **Pending** (approve / reject buttons per row), **Approved** (retire button), **Top wrong terms** (occurrences sorted descending by miss count, with per-term wrong / right / total + a horizontal bar visualising error rate against the leader). Search input filters the term tabs by `term_normalized` substring. "Re-run CSV import" button (admin only) hits `/api/financial-terms/bulk-import` and renders the resulting `imported_clean / imported_pending / skipped_duplicate / skipped_empty` counts. Non-admin users see a "this page is admin-only" panel rather than a 403 they can't act on.
- **`TermFlagger` component** at `frontend/src/app/(dashboard)/components/TermFlagger.jsx`. Listens for browser selection inside the page; renders a small floating "💼 Add to dictionary" button when the selection looks like a plausible term (1-5 whitespace-delimited tokens, ≤80 chars, no sentence-internal `.!?`). Click → modal with the wireframe shape from `financial-terms-dictionary.md` §7.2: term (pre-filled, editable), category (optional), source (locked to current file), "did the model transcribe it correctly?" radio, optional note. Submits via `submitTerm` + `recordOccurrence`. Mounted as one line at the top of the file detail page's render (`page.jsx:984`); fixed-position rendering means it doesn't disturb the existing layout. Renders nothing while no selection is active so it's invisible by default.
- **Tests** — 11 new vitest cases in `src/__tests__/financial-terms.test.js`: `fetchTerms` filters (status / category / q-substring), `fetchTerm` round-trip, `submitTerm` appends pending, `moderateTerm` flips status + stamps approver, `recordOccurrence` correctness flag, `fetchStats` top-wrong ranking monotonicity, `fetchSnapshot` shape, `getCachedSnapshot` hits cache on second call (object-identity check), `runBulkImport` counts shape. All 34 vitest cases green (slice 1+2 versioning + cache + financial-terms).
- **Doc fix:** `financial-terms-dictionary.md` §7 had described attaching the affordance to a "per-word edit popover" which doesn't exist (the real editor is segment-level `contentEditable`). Updated to the selection-based design with a wireframe of the modal and explicit reasoning vs. the right-click and save-modal alternatives.

Replaces the in-repo `financialTerms.csv` (6,318 rows, single column, mixed-quality) with a SQLite-backed user-curated dictionary. Reviewers submit terms while editing transcripts (explicit "💼 Add to dictionary" affordance + implicit auto-trail when correcting words the model got wrong); admins moderate via a queue; ML engineers consume the approved list at eval-manifest build time and at training-data packaging time. Drives the `financial_term_accuracy` strategy in [`../06 server/metrics-service-module.md`](../06%20server/metrics-service-module.md).

What landed in slice 1:

- **`app/schema.sql` + `app/db.py`** — `financial_term` (mutable; `pending`/`approved`/`rejected`/`retired` lifecycle, unique on `term_normalized` = strip + casefold for dedupe, submitter + approver attribution) + `financial_term_occurrence` (append-only, unique on `(term_id, audio_file_external_id)` so re-submissions are no-ops). Idempotent schema init via `IF NOT EXISTS`. Helpers: `submit_term` (dedupe on normalised key), `moderate_term` (status flip + optional metadata patch; only stamps `approved_by`/`approved_at` on the first approval transition), `record_occurrence`, `stats_top_wrong` (HAVING wrong_count > 0 so perfect terms don't pollute the list), `stats_trending` (with optional `since_iso`), `dictionary_snapshot` (approved-only + `version = max(approved_at)`).
- **`app/main.py` + `routes_terms.py` + `routes_occurrences.py`** — 9 endpoints. Role gates: submitter (`reviewer`/`engineer`/`admin`) for `POST /terms`; moderator (`admin` only) for `PATCH /terms/{id}`; any authenticated for reads + occurrence writes; service-internal (still requires `X-User-Id` so the proxy can't blindly forward unauthenticated calls) for `/occurrences` POST + `/dictionary/snapshot`.
- **`Dockerfile` + `requirements.txt`** — sibling pattern to `meeting_webhooks` and `training_orchestrator`. Python 3.11-slim, `python -m uvicorn app.main:app --port 8009`. Volume `financial_terms_data` for the SQLite file.
- **`compose.yaml`** — new `financial-terms-dictionary` service block. `FINANCIAL_TERMS_URL=http://financial-terms-dictionary:8009` injected into the frontend container; `FINANCIAL_TERMS_PORT=8009` and `FINANCIAL_TERMS_SEED_ON_BOOT=true` in `backend/.env`. Frontend `depends_on` extended.
- **Slice 2 — `app/seed.py` + `app/routes_admin.py`.** CSV cleaner (`classify_row`) tags rows as `clean` / `suspicious` / `drop` using calibrated heuristics: question marks, prose-style colons (`:` followed by a space + alphabetic char), article-title openers (`Understanding`, `What`, `How`, `Why`, …), telltale phrases (`What It Is`, `How It Works`, `Definition`, `Meaning`, `Explained`, `Mechanics`, `Characteristics`, …), >10-token entries. Encoding-tolerant — probes UTF-8 first, falls back to cp1252 (Investopedia exports often mix), final fallback to UTF-8 with `errors='replace'`. `import_csv` is idempotent (dedupes by `term_normalized` so re-runs are no-ops). Lifespan hook in `main.py` auto-fires on first boot when DB is empty + `SEED_ON_BOOT=true`. Failure during boot-seed logs at WARNING and never crashes the service. New `POST /terms/bulk-import` admin endpoint exposes the same machinery for ad-hoc re-imports without container restart. Against the bundled 6,318-row CSV: **6,013 clean / 303 pending / 2 in-CSV duplicates** (95.2% / 4.8%) — admin triage queue lands at a manageable size out of the box.
- **Tests** — 47 stdlib `unittest` cases. Slice 1 (`tests/test_dictionary.py`, 26): schema idempotency, term dedupe on `term_normalized` (case + whitespace), moderation lifecycle (approval stamps approver + timestamp; retire keeps original approver), invalid-status rejection, list filters (status/category/q-substring), occurrence dedupe on `(term, file)`, top-wrong ranking + perfect-term exclusion, snapshot approved-only + retired-drops-out + null-version-on-empty, plus HTTP role-gate cases (submitter accepted, generic role 403, moderation by engineer 403, moderation by admin 200, missing headers 401, empty PATCH 400), `/healthz`, `/terms/{id}` 404, `/occurrences` 404 on unknown term, `/dictionary/snapshot` round-trip. Slice 2 (`tests/test_seed.py`, 21): `classify_row` against real Investopedia samples (`EBITDA`, `10-K`, `Schedule K-1 Beneficiary Share of Income Deductions Credits` clean; `10-K Wrap: What It Is, How It Works, Elements`, `Understanding the 25% Rule: …`, `What Defines a Bungalow?`, `Benjamin Graham: The Father of Value Investing` suspicious; empty / whitespace dropped); `import_csv` integration tests (counts kept/pending/duplicate/empty, idempotent re-runs, dedupe by normalised form, missing-CSV raises FileNotFoundError, suspicious-rows-with-reason-in-notes flow); HTTP bulk-import route role gate (engineer 403, admin 200, missing CSV 404).

- **New service:** `backend/Financial_terms_dictionary/` (FastAPI, port 8009, sibling pattern to `meeting_webhooks` + `training_orchestrator`).
- **Schema:** `financial_term` (mutable; `pending` → `approved` / `rejected` / `retired` lifecycle, unique `term_normalized`, submitter + approver attribution, optional category + definition-as-URL); `financial_term_occurrence` (append-only ledger of where terms appeared in real transcripts and whether the model got each one right).
- **Endpoints:** `GET/POST /terms`, `PATCH /terms/{id}` (admin moderate), `POST /terms/bulk-import` (CSV cleaner with quarantine-as-pending for likely-noise rows), `POST /occurrences`, `GET /occurrences/stats` (trending + top-wrong), `GET /dictionary/snapshot` (versioned bulk approved-list for manifest-time stamping).
- **Cross-cuts:** `metrics-service` reads `/dictionary/snapshot` once per eval run and pre-stamps `Sample.tags.critical_terms`; `retraining-pipeline/dataset_builder.py` does the same when building manifests; `frontend/src/server/audio-files.js::writeEditsForFile` adds an auto-trail hook that writes occurrences with `correctly_transcribed=0` when a reviewer corrects a word that's in the dictionary.
- **FE impact:** new `/admin/financial-terms` page (pending / approved / **top wrong terms** tabs — the last is the genuinely valuable surface for engineering prioritisation), inline "💼 Add to dictionary" affordance on the existing edit popover at `/files/[id]/page.jsx`.
- **Research summary:** dictionary-maintenance patterns from MeSH/SNOMED (heavyweight curation — skipped), Wiktionary/Wikidata (moderation backbone — stolen), Loughran-McDonald (static seed source — stolen), Google/Azure Speech `phrase hints` (snapshot-at-eval-time — stolen). Detail in `financial-terms-dictionary.md` §4.

### 4.5 Custom metrics pipeline — [`custom-metrics-pipeline.md`](custom-metrics-pipeline.md)

Control-user uploads a Python script via `/dashboard/configure`; it becomes a runnable metric on the dashboard alongside the built-in WER / CER / F1 strategies. Today the FE has the upload dialog (`AddMetricDialog` in `dashboard/configure/page.jsx`), `services/metrics-config.js` writes to `localStorage`, and `platform.db.metric` already has `python_script` + `is_custom` columns. **Nothing connects those points** — the backend never sees the script, never executes it, and never records a result. This doc covers the missing path: API surface, persistence with audit trail, sandboxed execution, dispatch into the existing strategy registry.

- **Contract:** `def compute(predictions: pd.DataFrame, references: pd.DataFrame) -> float`. DataFrame shape published once, scripts in the wild assume it. Adapter converts `MetricsRunner`'s sample iterator into DataFrames before calling user code; built-in strategies stay on the `Sample` iterator unchanged.
- **Sandboxing — load-bearing:** subprocess + `setrlimit` (10 s CPU, 512 MB RSS, 8 FDs) + network namespace (`unshare -n`) + tmpfs `/tmp/<run-id>/` + RestrictedPython inside. AST whitelist enforced at upload time AND at run time. No `os` / `subprocess` / `socket` / `urllib` / `requests` / `pickle` / `marshal` / `ctypes` / `multiprocessing`. Allowed: `pandas`, `numpy`, `math`, `re`, `statistics`, `collections`, `itertools`, `functools`, `typing`, `dataclasses`. Container-per-script (gVisor / Firecracker) deferred to Option C if internal-only assumption breaks.
- **Schema migration `0003_add_custom_metric_audit.sql`** — promotes `python_script` from "exists, unused" to "actually used"; adds `script_sha256`, `submitted_by` / `submitted_at`, `smoke_test_value` / `smoke_test_at`, `last_run_at` / `last_run_failed` / `last_run_failure`, `status ∈ ('active','disabled','retired')`. New `metric_script_history` table holds prior versions append-only so old `evaluation_metric` rows can be traced back to the script that produced them.
- **API additions on `metrics-service`:** `GET /metrics/catalogue`, `POST /metrics/custom`, `PATCH /metrics/custom/{id}`, `POST /metrics/custom/{id}/{enable,disable,smoke-test}`, `DELETE /metrics/custom/{id}`, `GET /metrics/custom/{id}/history`. FE proxy mirrors these under `/api/metrics/custom/`.
- **Dispatch into `MetricsRunner`:** `_CustomScriptStrategy` constructed per-run (not imported once) so a freshly-uploaded script runs without a service restart. Wraps the sandbox call in the existing `MetricStrategy.compute()` contract — single dispatch path, two implementations.
- **Failure handling:** exception / timeout / OOM / non-numeric / NaN-inf return → `last_run_failed=1`, value=`NaN`, dashboard renders the prior point. Auto-disable after 5 consecutive failures.
- **Cross-cuts:** depends on §3.1 (the strategy registry it extends); financial-terms dictionary's `/dictionary/snapshot` could be injected as an optional third arg to `compute()` per open-question 8 of [`custom-metrics-pipeline.md`](custom-metrics-pipeline.md).

### 4.6 Training-job pipeline (sidebar → leaderboard) — [`training-job-pipeline.md`](training-job-pipeline.md)

New `training-orchestrator` service (port 8007) sits between the `/training` page's "New Train Job" dialog and the existing `retraining-pipeline/train.py`, owning the full lifecycle: submission → script + env-var capture → resource pull → training → architecture-deviation check → post-train metrics hook → leaderboard publish. Schema adds three tables (`training_job`, `base_model`, `training_artifact`) — none exist today; `database/main.py` only models audio/transcripts. The eight-step user flow (sidebar → dialog → script upload → resource → derived-base spawn → progress page → metrics fan-out → leaderboard) is not implemented end-to-end and was not designed end-to-end before this branch.

- **New service:** `training-orchestrator` (FastAPI, port 8007). `POST /jobs`, `GET /jobs/{id}`, lifecycle (`pause` / `resume` / `cancel`), heartbeat + log SSE.
- **Schema:** `training_job` (`status`, `target ∈ cloud|local|federated`, `data_zone`, `env_json`, `script_sha256`, `dp_enabled`, snapshot fields), `base_model` (vendor + user-derived; `architecture_fingerprint`, `parent_base_model_id`, `owner_user_id`), `training_artifact` (links job → adapter / new base model / checkpoint).
- **New endpoint on metrics-service:** `GET /leaderboard?dataset_id=…` joining `model_evaluation` ⇄ `training_artifact` ⇄ `training_job` ⇄ `user`. Replaces today's `getCustomMockLeaderboard()` mock data.
- **Architecture-fingerprint check:** orchestrator (not the worker) hashes `model.config` + named parameter shapes after each run; mismatch with the base ⇒ insert a new `base_model` row owned by the engineer.
- **Cross-cuts:** F25 (FL framework ADR) gates `target='federated'`; F19 / F22 / F23 gate `dp_enabled=true`; F29 (manifest provenance) gates the resource's pull step; [`redis-cache-integration.md`](redis-cache-integration.md) cache must be invalidated on each `published` transition; [`azure-deployment-requirements.md`](azure-deployment-requirements.md) §3 owns `data_zone` propagation through every row.
- **FE impact:** wire the no-op LAUNCH button at `training/page.jsx:532`, replace `MOCK_COMPLETION_DELAY_MS = 8000` with an SSE subscription, swap `getCustomMockLeaderboard()` for `GET /api/leaderboard`.

---

## 5. Done — Security baseline (Wave 2)

Both Wave-2 partials closed on this branch (2026-04-28). Detail in [`fix-implementation-log.md`](fix-implementation-log.md) §1.

- **F8 — full double-submit CSRF token.** `proxy.js` issues a non-HttpOnly `__Host-csrf-token` cookie (32 random bytes, 12 h TTL, `SameSite=Lax`) on first response. `services/http.js` exposes `readCsrfToken()` and auto-attaches `X-CSRF-Token` on POST/PUT/PATCH/DELETE; the proxy compares header to cookie in constant time and 403s on mismatch. Direct-`fetch()` callers were swept and patched: multipart upload (`services/api.js`), `services/metrics.js` `request()`, `services/training-jobs.js` `_request()`, and the integrations page. `/auth/*` exempt (login bootstraps before any cookie). Verified via curl: no token → 403, mismatch → 403, matched + same-origin → passes through.
- **F11 — production CSP smoke test.** `next build` clean. Live `next start` returns the expected CSP header (`script-src 'self' 'nonce-…' 'strict-dynamic' 'wasm-unsafe-eval'`), the per-request `x-nonce`, and the new CSRF cookie. The `@lottiefiles/dotlottie-react` WASM (which defaults to fetching from `cdn.jsdelivr.net`) is now self-hosted at `/public/dotlottie-player.wasm` with `setWasmUrl()` wired into a top-level `LottieWasmInit` client component, so `connect-src 'self'` does not need a CDN allowance. `'wasm-unsafe-eval'` covers `WebAssembly.compile`/`instantiate` only — it does not enable JS `eval`.

A full browser walkthrough across every authed page (console open, watching for CSP violations) still belongs on the pre-merge verification checklist — F11 entry there has been annotated.

---

## 6. Deferred — Cloud move + FL / DP enablement

Tracked across two docs:

- [`fix-triage-frontend-vs-backend.md`](fix-triage-frontend-vs-backend.md) §3 (deferred fixes F1, F12, F14–F16, F18, F20–F30) and §7 (Wave 3 + Wave 4 sequencing).
- [`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md) for the FL/DP risk register (P1–P12).

### 6.1 Cloud move (Wave 4)

| Fix | Owner | Detail |
|---|---|---|
| F12 — HSTS preload | Infra | After reverse proxy + real domain land |
| F14 — mTLS between orchestrator and gliner-service | BE + Infra | Cert issuance + Docker network re-config |
| F15 — Drop dev port mappings on backend services | Infra | Pending dev-team sign-off on `docker compose exec` for ad-hoc debugging |
| F16 — Encrypt SQLite at rest / migrate to Postgres | BE + Infra | Multi-week, tracked in [`azure-deployment-requirements.md`](azure-deployment-requirements.md) §2 |
| F18 — Centralised log aggregation + tracing | Infra + small FE/BE hooks | Application Insights wiring |
| F27 — Encrypt `audit_event` at rest | FE writer + Infra KMS | Key Vault layout + rotation cadence |

[`azure-deployment-requirements.md`](azure-deployment-requirements.md) is the umbrella plan: Container Apps + Azure ML, two-VNet red-zone / green-zone topology, ACR Premium with content trust + private endpoint for the **restricted-package FL/DP image** (Opacus + Flower + internal wheels baked in), Azure Artifacts feed as the private PyPI mirror, customer-managed keys on the registry + model store, 7-day Blob lifecycle for raw audio (PDPA), Postgres for `users.db` + `platform.db` cutover.

### 6.2 FL / DP enablement (Wave 3)

The risk register in [`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md) lists 12 project-specific risks (P1–P12). Two have been mitigated on this branch:

- **P1 — Opacus pinning:** F19 shipped (`opacus==1.5.2` in `requirements.txt`).
- **P5 — adapter hyperparameter side channel:** F24 shipped (`_strip_published_artifacts()` in `train.py`).

Open. Sequence: governance ε decision → privacy ledger → quantisation gate → PII scrubbing → FL framework choice → aggregator hardening:

| Fix | Blocked on | Detail |
|---|---|---|
| F21 — Decide & document (ε, δ, accounting unit) | Governance | Blocks F22 / F23 / F26 |
| F22 — Per-user privacy budget ledger | F21 | Blocks continual-learning go-live |
| F23 — Drop 4-bit quantisation when DP is on (or audit) | F21 | Add gate at the same time DP-SGD lands |
| F20 — Real PII scrubbing pipeline (Presidio + audio redaction) | — | Multi-week BE work |
| F25 — Pick FL framework (Flower / NVFlare / PySyft) | Governance ADR | Blocks F26 |
| F26 — Update-norm clipping at aggregator | F25 | No aggregator yet |
| F28 — Stakeholder one-pager (what FL+DP do *not* protect against) | Governance | Sign-off before FL/DP are publicly claimed |
| F29 — Provenance check on training manifest | `dataset_builder.py` (WIP) + F1 | Closes most of P6 |
| F30 — Audio-side biometric redaction | Research thread | Voice biometrics survive transcript-only DP |

**One-line summary from the risk doc:** FL controls *where* raw data lives; DP controls *what* a model release reveals. Neither addresses the other's gap on its own. Combining them helps but introduces budget-composition and aggregator-trust complications. AUSTIN-Lang has neither wired in today — the right time to design these in properly is now, before retrofit pressure builds.

### 6.3 Outstanding cross-cut: F1 — Authenticate the backend `database` service

Not part of FL/DP and not blocked on cloud move, but listed deferred in [`fix-implementation-log.md`](fix-implementation-log.md) §3 because the auth scheme (shared-secret header vs JWT propagation) is a design decision that needs BE sign-off. Important blocker: F3 (real role propagation), F29 (provenance check) both depend on this landing.

---

## 7. Config / Env Wiring

`compose.yaml` already injects the following into the frontend container.

| Env var | Service / purpose | State |
|---|---|---|
| `TRANSCRIPTION_ORCHESTRATOR_URL` | `transcription-orchestrator:8001` | ✅ wired |
| `BACKEND_DB_URL` | `database:8002` | ✅ wired |
| `PSEUDONYM_ORCHESTRATOR_URL` | `pseudonymisation-orchestrator:5002` | ✅ wired |
| `JWT_SECRET` | FE auth (boot-guard in prod per F2) | ✅ wired |
| `GLINER_SHARED_SECRET` | gliner ↔ orchestrator (boot-guard in prod per F2) | ✅ wired |
| `PSEUDONYM_FERNET_KEY` | orchestrator at-rest encryption (boot-guard in prod per F2) | ✅ wired |
| `ENVIRONMENT` | toggle the F2 boot guards (default = dev convenience) | ✅ wired |
| `ALLOWED_ORIGINS` | BE CORS allow-list (F9) | ✅ wired |
| `NEXT_PUBLIC_MOCK_API` | dev mock toggle (defaults `true` in dev) | ✅ wired |
| `MAX_UPLOAD_BYTES` | upload size cap (F6) | ✅ wired |
| `METRICS_SERVICE_URL` | metrics-service:8006 (FE proxy target) | ✅ wired |
| `METRICS_DB_PATH` | path to metrics.db inside the container (default `/app/data/metrics.db`) | ✅ wired |
| `ADAPTERS_DIR` | adapter directory mount inside the metrics-service container (read-only) | ✅ wired |
| `METRICS_SEED_ON_BOOT` | dev convenience: seed mock dashboard on first boot of an empty DB (default `true`) | ✅ wired |
| `METRICS_BASELINE_FRESHNESS_DAYS` | how long a baseline row is reused before re-running (default 30) | ❌ pending §3.1 |
| `LEADERBOARD_SERVICE_URL` | new leaderboard service | ❌ pending §3.2 |
| `TRAINING_ORCHESTRATOR_URL` | training-orchestrator:8008 (FE proxy target) | ✅ wired |
| `TRAINING_ORCHESTRATOR_PORT` | training-orchestrator listen port (8008 — `8007` was already taken by `meeting-webhooks`) | ✅ wired |
| `TRAINING_DB_PATH` | training-orchestrator's SQLite path inside the container | ✅ wired |
| `WORKER_ENABLED` | spawn either worker on boot (default `true`; set `false` when an external worker container takes the queue) | ✅ wired |
| `WORKER_MODE` | `simulated` (default) or `real` — picks `worker.py` vs `real_worker.py` | ✅ wired |
| `WORKER_POLL_INTERVAL_SECONDS` | how often the worker checks for queued jobs (default 2.0) | ✅ wired |
| `WORKER_SIMULATED_DURATION_SECONDS` | total simulated training duration per job (default 30.0; simulated mode only) | ✅ wired |
| `TRAINING_SCRIPT_PATH` | path to `cloud_train_sync.sh` inside the orchestrator container (real mode) | ✅ wired |
| `TRAINING_SCRIPT_CWD` | working directory for the script invocation (real mode) | ✅ wired |
| `TRAINING_LOG_DIR` | where the real worker streams subprocess stdout, one file per job (default `/app/data/logs`) | ✅ wired |
| `REDIS_URL` | `redis://redis:6379` — read-through file-detail cache + per-user recents | ✅ wired |
| `REDIS_PORT` | host port for the redis container (default 6379) | ✅ wired |
| `ZOOM_WEBHOOK_SECRET_TOKEN`, Zoom S2S OAuth client id/secret | webhook ingestion | ✅ wired (set per-tenant) |
| Teams: tenant id, app client id/secret | webhook ingestion (resource-data encryption deferred) | ✅ wired (set per-tenant) |
| `GENERIC_WEBHOOK_SECRET` | generic-provider HMAC signing for Slack/Discord/etc bots | ✅ wired |
| `WEBHOOK_RENEWAL_ENABLED`, `WEBHOOK_RENEWAL_INTERVAL_SECONDS` | proactive Graph subscription renewal cron (defaults true / 1800) | ✅ wired |
| `FINANCIAL_TERMS_URL` | financial-terms-dictionary:8009 (FE proxy + metrics + retraining-pipeline target) | ✅ wired |
| `FINANCIAL_TERMS_PORT` | financial-terms-dictionary listen port (default 8009) | ✅ wired |
| `FINANCIAL_TERMS_DB_PATH` (`DB_PATH` inside the container) | SQLite path (default `/app/data/financial_terms.db`) | ✅ wired |
| `FINANCIAL_TERMS_SEED_ON_BOOT` | seed from `financialTerms.csv` on first boot of an empty DB (default `true`; consumed by slice 2) | ✅ wired |
| `DP_ENABLED` | gates 4-bit quantisation in `train.py` (F23) | ❌ pending Wave 3 |

---

## 8. Backend Services Without a Frontend Caller

These run in `compose.yaml` but no API route in `frontend/src/app/api/` calls them. Worth confirming whether they are dead, internal-only, or pending integration.

- `metrics-service:8006` — operational endpoints exist; evaluation endpoints landing per §3.1. Full reference: [`../06 server/metrics-service-module.md`](../06%20server/metrics-service-module.md).
- `training-orchestrator:8008` — `/jobs` endpoints + simulated worker wired; submitted jobs run through the full `queued → preparing → running → evaluating → published` lifecycle in ~30s of simulated time (§3.3). Real-training worker still pending.
- `8000` audio-submission service (called by orchestrator only).
- `8003` transcription server (legacy / fallback path).
- `8004` auth (consumed via cookie middleware only).
- `8005` transcription-service-2 (called by orchestrator only).

---

## 9. Suggested Order of Attack

Reconciles the four "waves" from [`fix-triage-frontend-vs-backend.md`](fix-triage-frontend-vs-backend.md) §7 with the integration backlog above.

1. ~~**Wave 2 finish-up** — close F8 (full CSRF token) and F11 (production CSP smoke test).~~ _Done 2026-04-28._
2. **Specced workstreams (parallelisable)** —
   - ~~§4.2 transcript versioning (largest design surface; affects every edit save).~~ _Done 2026-04-28._
   - ~~§4.1 Redis cache (depends on §4.2's invalidation hooks landing in the same PR series, but the Redis container + module skeleton can land independently).~~ _Done 2026-04-28._
   - §3.1 metrics → dashboard (low effort, backend ready, immediate user-visible win).
   - §3.3 retraining orchestration (largest design work; unblocks `/training` and the leaderboard refresh story).
3. ~~**Webhook ingestion (§4.3)** — phase 1 (Zoom-only, no resource-data encryption) is a self-contained land; Teams phase 2 adds the X.509 cert + renewal cron.~~ _Done 2026-04-28 — factory pattern with Teams + Zoom + Generic shipping; Google Meet stub demonstrating the pattern; renewal cron live; Teams `includeResourceData` deferred per pending follow-up 1._
4. **Wave 3 — FL / DP** — only after F21 (ε decision) and F25 (framework choice) governance artefacts exist. F22 / F23 / F20 / F26 then sequence under those.
5. **Wave 4 — Cloud move** — F12, F14, F15, F16, F18, F27 align with the [`azure-deployment-requirements.md`](azure-deployment-requirements.md) workstream.

---

## 10. Cross-references

Every doc in this folder, with what to read it for:

| Doc | Read for |
|---|---|
| [`audio-to-edit-pipeline.md`](audio-to-edit-pipeline.md) | The current end-to-end upload-to-editable-transcript pipeline (six stages + the tables touched matrix). Source of truth for the existing write path that §4.2 replaces. |
| [`azure-deployment-requirements.md`](azure-deployment-requirements.md) | Azure target architecture — Container Apps, AML, two-VNet red/green zones, ACR Premium for the restricted FL/DP image, 7-day Blob lifecycle, SQLite→Postgres cutover. |
| [`file_viewing_pipeline.md`](file_viewing_pipeline.md) | Click-to-render path on the dashboard — selection model, route transition, mock-vs-real branching, where things break. |
| [`custom-metrics-pipeline.md`](custom-metrics-pipeline.md) | User-uploaded Python scripts as runnable metrics — contract (DataFrames in, float out), sandbox design (subprocess + `setrlimit` + namespace + RestrictedPython), schema migration to add audit columns + `metric_script_history`, dispatch into the existing strategy registry, failure handling, threat model. |
| [`financial-terms-dictionary.md`](financial-terms-dictionary.md) | User-curated financial-terms microservice — schema, moderation lifecycle, snapshot pattern for eval-manifest stamping, auto-trail occurrence ledger, term-match algorithm, slice plan. Replaces the in-repo `financialTerms.csv`. |
| [`fix-implementation-log.md`](fix-implementation-log.md) | What landed on this branch (Wave 1, 15 fixes), what's partial, what's deferred and why, and the verification checklist. |
| [`fix-triage-frontend-vs-backend.md`](fix-triage-frontend-vs-backend.md) | Master triage of all 30 security/privacy fixes, FE-vs-BE-vs-Infra-vs-Governance ownership, four-wave sequencing. |
| [`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md) | The honest case for *what FL and DP do not protect against* — gradient leakage, membership inference, model poisoning, ε opacity, group privacy, quantisation-vs-DP, library bugs. P1–P12 mapped to current code. |
| [`meeting_recording_webhooks.md`](meeting_recording_webhooks.md) | Zoom + Teams (Graph) webhook ingestion — payload shapes, signature verification, validation handshakes, lifecycle, dedupe key, organiser → internal-user mapping, X.509 encryption for resource-data notifications. |
| [`redis-cache-integration.md`](redis-cache-integration.md) | Read-through Redis cache for `getAudioFileDetail`, per-user `LPUSH`/`LTRIM` recents list, fail-open semantics, eight implementation steps. |
| [`security overview.md`](security%20overview.md) | 2026 security baseline checklist (CORS, CSP, HSTS, CSRF, cookies, supply chain, rate limiting, plus 9 deeper categories). The original prompt for the F1–F30 triage. |
| [`transcript-versioning-plan.md`](transcript-versioning-plan.md) | Append-only version-pointer model for transcript edits, backed by MongoDB document-versioning + Google Docs revisions + SQL temporal-table research. Migration script + 11 sections of design. |
| [`training-job-pipeline.md`](training-job-pipeline.md) | End-to-end engineer training-job flow — `/training` sidebar → New-Train-Job dialog → script + env-var upload → resource pulls weights/dataset → architecture-deviation registry → progress page → post-train metrics hook → leaderboard surfacing. New `training-orchestrator` service (port 8007) + `training_job` / `base_model` / `training_artifact` schema. |

External / older docs still relevant:

- [`02 frontend/integration fixes.md`](../02%20frontend/integration%20fixes.md) — taxonomy clashes, schema mismatches, PRD gaps.
- [`02 frontend/Project_Requirements_Document.md`](../02%20frontend/Project_Requirements_Document.md) — FR/NFR clauses cited throughout.
- [`02 frontend/metrics_research/`](../02%20frontend/metrics_research/) — metrics surface design.

---

## 11. Training-job pipeline (sidebar → leaderboard) — addendum

Audited 2026-04-28 against the eight-step engineer flow: visit Train Jobs tab → fill New-Train-Job dialog → upload script + env-var metadata → resource pulls weights/dataset and trains (ideally federated) → store as a new user-owned base model when architecture deviates → view progress on the detail page → on completion auto-register and push to metrics → surface on leaderboard.

**Verdict:** not implemented end-to-end and not _designed_ end-to-end anywhere prior to this branch. Frontend has production-quality UI for steps 1, 2, 6, 8 driven entirely by mock data; backend has a real CLI-only `retraining-pipeline/train.py` and a real metrics-service evaluation hook (`POST /evaluations/run`). The connective tissue — job-queue API, base-model registry, FL runtime, real leaderboard endpoint — does not exist.

The full design now lives in [`training-job-pipeline.md`](training-job-pipeline.md):

- **§1** per-step status table (FE state × BE state for all eight steps).
- **§2** what exists today — file:line references for the dialog, detail page, mocks, real `train.py` entrypoint, real post-train hook, metrics-service surface.
- **§3** cross-cuts to FL/DP risk assessment (F19, F22, F23, F25, F29), Azure deployment (`data_zone`), metrics-service module, leaderboard research, Redis cache invalidation.
- **§4** proposed design — new `training-orchestrator` service on port 8007; `POST /jobs`, `GET /jobs/{id}`, heartbeat + log SSE; `training_job` / `base_model` / `training_artifact` schema; architecture-fingerprint check for the step-5 deviation case; FL deferred behind F25; new `GET /leaderboard` endpoint on metrics-service.
- **§5** sequencing (cloud/local first, leaderboard second, deviation-registry third, FL fourth).
- **§6** open questions — script execution model (CLI vs. orchestrator-owned), local-target progress reporting, trust boundary on the deviation check, derived-base-model leaderboard fairness, weights storage backend.

Biggest blockers called out there that this status board should track:

- **Submit handler missing.** `training/page.jsx:532` "LAUNCH EXPERIMENT" closes the modal and emits nothing — there is no contract to integrate against until the orchestrator + `POST /jobs` schema land.
- **No base-model registry.** Step 5 has nowhere to write today; needs a `base_model` table with `owner_user_id`, `parent_base_model_id`, `architecture_fingerprint`.
- **No FL framework.** Step 4's "federated" wording in the user flow is aspirational; current `retraining-pipeline` is single-machine LoRA. Holds behind F25 ADR.
- **Leaderboard ranking shape.** Metrics-service today exposes per-pair (`/metrics/by-dataset`) and per-eval (`/evaluations`) shapes, not a ranked list keyed by engineer. Needs a new `GET /leaderboard?dataset_id=…` endpoint joining `model_evaluation` ⇄ `training_artifact` ⇄ `training_job` ⇄ `user`.
