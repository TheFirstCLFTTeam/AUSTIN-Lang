# Backend ↔ Frontend Integration Status

_Last audited: 2026-04-27 (branch `ui_enhancement`)_

Master status board for everything wired (or planned to be wired) across the Next.js frontend, the FastAPI backend services, and the surrounding infra. Consolidates the ten sibling docs in this folder so anyone can take stock without grepping through them. Each row points at the detail doc that owns the design.

---

## At a glance

| Workstream | State | Owner | Detail |
|---|---|---|---|
| Upload → transcription → edit pipeline | ✅ shipped | FE + BE | [`audio-to-edit-pipeline.md`](audio-to-edit-pipeline.md), [`file_viewing_pipeline.md`](file_viewing_pipeline.md) |
| Pseudonymisation review loop | ✅ shipped | FE + BE | [`audio-to-edit-pipeline.md`](audio-to-edit-pipeline.md) §1.5 |
| Security baseline — Wave 1 (15 fixes) | ✅ shipped this branch | FE + BE + Infra | [`fix-implementation-log.md`](fix-implementation-log.md) §1 |
| Metrics → Dashboard | 🟡 stubbed (BE ready) | FE | this doc §3.1 |
| Leaderboard | 🟡 stubbed (no BE) | FE + BE | this doc §3.2 |
| Retraining / Training Jobs | 🟡 stubbed (no orchestration) | FE + BE | this doc §3.3 |
| User profile sync | 🟡 stubbed (decision pending) | FE + BE | this doc §3.4 |
| Redis cache middleware | 📐 specced, not built | FE + Infra | [`redis-cache-integration.md`](redis-cache-integration.md) |
| Transcript edit versioning | 📐 specced, not built | FE + BE | [`transcript-versioning-plan.md`](transcript-versioning-plan.md) |
| Meeting webhook ingestion (Zoom + Teams) | 📐 specced, not built | new BE service | [`meeting_recording_webhooks.md`](meeting_recording_webhooks.md) |
| Security baseline — Wave 2 (CSRF token, etc.) | 🟡 partial | FE | [`fix-implementation-log.md`](fix-implementation-log.md) §2 |
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
- Edits are **destructively rewritten** on every save (`DELETE FROM transcript_edit … then INSERT`). Replacement design lives in [`transcript-versioning-plan.md`](transcript-versioning-plan.md).

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
| F8 (partial) | Origin/Referer CSRF check in `proxy.js` | CSRF (layer 1 of 2) |
| F9 | Backend CORS hardening (`allow_origins` env-driven, methods enumerated) | Browser-side CORS abuse |
| F10 | Dependabot extended to npm + pip (eight backend service dirs + `/frontend`) | Supply chain |
| F11 | Per-request CSP nonces (`script-src 'self' 'nonce-X' 'strict-dynamic'`) | XSS |
| F13 | Generic `detail` responses; real error logged server-side only | Stack-trace leakage |
| F17 | Auth-event logging (`login_succeeded`, `login_failed`, `logout` in `audit_event`) | Forensics |
| F19 | `opacus==1.5.2` pinned in retraining pipeline (inert, ready for DP-SGD wire-in) | Reproducibility |
| F24 | `_strip_published_artifacts()` in `train.py` removes `training_args.bin`, `trainer_state.json`, `runs/` | DP hyperparameter side channel ([`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md) §4.5 / P5) |

**Verification checklist before this branch ships** lives in [`fix-implementation-log.md`](fix-implementation-log.md) §4 — run it before any merge to `main`.

---

## 3. Stubbed — Backend Wiring Required

### 3.1 Metrics & Dashboard ★ quickest win
- **State:** Frontend reads from `mock_data-dashboard.js`; `getDashboardStats()` returns mock object.
- **Backend already exists:** `metrics-service:8006` exposes `GET /metrics/dashboard` and `GET /metrics/accuracy/{file_id}`.
- **Work:**
  1. Add `frontend/src/app/api/metrics/route.js` that proxies to `process.env.METRICS_SERVICE_URL`.
  2. Replace `getDashboardStats()` in `services/analytics.js` with a fetch to `/api/metrics`.
  3. Wire per-file accuracy into the file detail page via `/api/audio-files/[id]/accuracy` → `metrics-service:8006/metrics/accuracy/{id}`.

### 3.2 Leaderboard
- **State:** `leaderboard/page.jsx` populates from `getCustomMockLeaderboard()` (`mock_data-leaderboard.js`, `mock_data-leaderboard-custom.js`).
- **Backend:** No endpoint exists.
- **Work:**
  1. Define backend service (likely a new endpoint on `metrics-service` or a dedicated leaderboard service) returning `{ datasetId, rows: [{ engineerId, modelFamily, wer, … }] }`.
  2. Apply `getGroupIdForRole`-based scoping server-side (per `leaderboard_research.md` §5.6 — currently copy-only on the page).
  3. Reconcile mock engineer IDs (`eng-priya`, `eng-andreas`, `eng-james`) with real `users.db` rows — they don't exist today.

### 3.3 Retraining / Training Jobs ★ biggest gap
- **State:**
  - `triggerRetraining()` in `/services/analytics.js` is a 2 s `setTimeout` stub (its log even says "BACKEND HANDOVER").
  - `/api/processing-jobs` lists from `platform.db` only; no orchestration.
  - `/training` page reads `MOCK_PROCESSING_JOBS`.
  - Retraining pipeline only runs as manual CLI in `backend/retraining-pipeline/`.
- **Backend:** No orchestration endpoint exists yet.
- **Work:**
  1. Stand up a job-queue API (FastAPI service, suggest port 8007) with `POST /jobs/retrain`, `GET /jobs`, `GET /jobs/{id}`.
  2. Frontend: replace `triggerRetraining()` with a real fetch; have `/api/processing-jobs` proxy `GET /jobs`.
  3. Add `data_zone` (green/red) on the training job record per FR-M05 / NFR-P02 while the schema is being designed (cross-ref [`azure-deployment-requirements.md`](azure-deployment-requirements.md) §3).

### 3.4 User Profile
- **State:** `/api/user-profile` reads `users.db` (SQLite) only; no backend sync.
- **Decision needed:** intentional (auth pilot owns users) or should profile reads/writes round-trip through an auth/identity service? Confirm with auth team before wiring.

---

## 4. Specced — Awaiting Implementation

Three substantial workstreams have been designed in detail but no code has landed yet. Each has its own dedicated doc; the lines below are the one-paragraph summary plus the integration touchpoints into the rest of this status board.

### 4.1 Redis cache middleware — [`redis-cache-integration.md`](redis-cache-integration.md)

Adds a Redis cache between `GET /api/audio-files/{id}` and `getAudioFileDetail()`, plus a server-side per-user "recently viewed" list (the existing `src/lib/recents.js` is `localStorage`-only and doesn't survive device-switching). All cache calls are **fail-open** — Redis outage degrades to today's SQLite latency, never to 5xx. Invalidates on every transcript edit, status change, and (when §4.2 lands) version freeze.

- **New service** in `compose.yaml`: `redis:7-alpine`, `allkeys-lru`, no AOF.
- **New module:** `frontend/src/server/cache.js`.
- **New endpoint:** `GET /api/recents`.
- **Env:** `REDIS_URL=redis://redis:6379`.
- **Cross-cuts:** invalidation hooks live in `writeEditsForFile()` (mutated by §4.2 too) and `setAudioFileStatus()`.

### 4.2 Transcript edit versioning — [`transcript-versioning-plan.md`](transcript-versioning-plan.md)

Replaces today's destructive `DELETE-then-INSERT` write path with an append-only, version-pointer model. New `transcript_version` table holds named checkpoints (`draft` / `submitted` / `approved` / `changes_requested` / `restored`); `transcript_edit` gains a `version_id` FK. **Frozen versions are never updated or deleted** — that's the core requirement. Drafts stay mutable to avoid microversion explosion on autosave.

- **Schema migration:** `database(FE)/seed/migrations/0001_add_transcript_versioning.sql` (idempotent).
- **New endpoints:** `GET /versions`, `GET /versions/{vNo}`, `GET /versions/{a}/diff/{b}`, `POST /versions/{vNo}/restore`.
- **Cross-cuts:** every freeze / restore must call `cache.invalidateDetail()` from §4.1; `audio-to-edit-pipeline.md` §6 needs an update once the new write path lands.

### 4.3 Meeting recording webhooks (Zoom + Teams) — [`meeting_recording_webhooks.md`](meeting_recording_webhooks.md)

New public-HTTPS service `meeting-webhook-receiver` plus a `meeting-recording-worker` that subscribes to Zoom `recording.completed` and Microsoft Graph `callRecording` events, downloads the media, and POSTs to the existing `transcription-orchestrator:8001/transcribe/` — i.e. the same contract `/api/upload` already uses. Receiver and worker are split because Zoom retries non-2xx 3× with a 3 s timeout, then drops the event (no DLQ); the receiver must 200 immediately and the multi-MB download happens in the worker.

- **Schema additions on `audio_file`:** `source_provider` (`'manual' | 'zoom' | 'teams'`), `source_recording_id`, `source_meeting_id`, `source_organiser`. Unique index `(source_provider, source_recording_id)` doubles as the dedupe gate.
- **Renewal cron required for Teams** — `callRecording` subscriptions max out at 3 days; a half-life renewer (~36 h) is mandatory infra, not optional.
- **Mapping** organiser → internal user via email (Zoom) or AAD object id (Teams); falls back to a system "external/unmapped" user with an admin re-attribution view.
- **Provider-context column + UI badge** lets the file list show "Source: Zoom" / "Source: Teams" alongside the existing manual uploads.

---

## 5. In Progress — Security baseline (Wave 2, partial)

Two Wave-1 fixes landed only partially. Tracked in [`fix-implementation-log.md`](fix-implementation-log.md) §2.

- **F8 — CSRF (full double-submit token).** Origin/Referer check shipped; the token side requires sweeping every `services/*.js` `http.post/put/del` call site. Suggested approach: bake the token into `services/http.js` so all callers pick it up automatically, then audit for direct `fetch()` use.
- **F11 — CSP production smoke test.** Header is in place, dev path uses `'unsafe-eval'` per the Next.js doc. Production CSP not yet exercised end-to-end with `next build && next start`. Watch out for `@lottiefiles/dotlottie-react` runtime-injected scripts.

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
| `METRICS_SERVICE_URL` | metrics-service:8006 | ❌ pending §3.1 |
| `LEADERBOARD_SERVICE_URL` | new leaderboard service | ❌ pending §3.2 |
| `RETRAINING_SERVICE_URL` | new job-queue service (port 8007 suggested) | ❌ pending §3.3 |
| `REDIS_URL`, `REDIS_PORT` | cache middleware | ❌ pending §4.1 |
| `ZOOM_WEBHOOK_SECRET_TOKEN`, Zoom S2S OAuth client id/secret | webhook ingestion | ❌ pending §4.3 |
| Teams: tenant id, app client id/secret, encryption cert id/thumbprint | webhook ingestion | ❌ pending §4.3 |
| `DP_ENABLED` | gates 4-bit quantisation in `train.py` (F23) | ❌ pending Wave 3 |

---

## 8. Backend Services Without a Frontend Caller

These run in `compose.yaml` but no API route in `frontend/src/app/api/` calls them. Worth confirming whether they are dead, internal-only, or pending integration.

- `metrics-service:8006` — see §3.1.
- `8000` audio-submission service (called by orchestrator only).
- `8003` transcription server (legacy / fallback path).
- `8004` auth (consumed via cookie middleware only).
- `8005` transcription-service-2 (called by orchestrator only).

---

## 9. Suggested Order of Attack

Reconciles the four "waves" from [`fix-triage-frontend-vs-backend.md`](fix-triage-frontend-vs-backend.md) §7 with the integration backlog above.

1. **Wave 2 finish-up** — close F8 (full CSRF token) and F11 (production CSP smoke test).
2. **Specced workstreams (parallelisable)** —
   - §4.2 transcript versioning (largest design surface; affects every edit save).
   - §4.1 Redis cache (depends on §4.2's invalidation hooks landing in the same PR series, but the Redis container + module skeleton can land independently).
   - §3.1 metrics → dashboard (low effort, backend ready, immediate user-visible win).
   - §3.3 retraining orchestration (largest design work; unblocks `/training` and the leaderboard refresh story).
3. **Webhook ingestion (§4.3)** — phase 1 (Zoom-only, no resource-data encryption) is a self-contained land; Teams phase 2 adds the X.509 cert + renewal cron.
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
| [`fix-implementation-log.md`](fix-implementation-log.md) | What landed on this branch (Wave 1, 15 fixes), what's partial, what's deferred and why, and the verification checklist. |
| [`fix-triage-frontend-vs-backend.md`](fix-triage-frontend-vs-backend.md) | Master triage of all 30 security/privacy fixes, FE-vs-BE-vs-Infra-vs-Governance ownership, four-wave sequencing. |
| [`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md) | The honest case for *what FL and DP do not protect against* — gradient leakage, membership inference, model poisoning, ε opacity, group privacy, quantisation-vs-DP, library bugs. P1–P12 mapped to current code. |
| [`meeting_recording_webhooks.md`](meeting_recording_webhooks.md) | Zoom + Teams (Graph) webhook ingestion — payload shapes, signature verification, validation handshakes, lifecycle, dedupe key, organiser → internal-user mapping, X.509 encryption for resource-data notifications. |
| [`redis-cache-integration.md`](redis-cache-integration.md) | Read-through Redis cache for `getAudioFileDetail`, per-user `LPUSH`/`LTRIM` recents list, fail-open semantics, eight implementation steps. |
| [`security overview.md`](security%20overview.md) | 2026 security baseline checklist (CORS, CSP, HSTS, CSRF, cookies, supply chain, rate limiting, plus 9 deeper categories). The original prompt for the F1–F30 triage. |
| [`transcript-versioning-plan.md`](transcript-versioning-plan.md) | Append-only version-pointer model for transcript edits, backed by MongoDB document-versioning + Google Docs revisions + SQL temporal-table research. Migration script + 11 sections of design. |

External / older docs still relevant:

- [`02 frontend/integration fixes.md`](../02%20frontend/integration%20fixes.md) — taxonomy clashes, schema mismatches, PRD gaps.
- [`02 frontend/Project_Requirements_Document.md`](../02%20frontend/Project_Requirements_Document.md) — FR/NFR clauses cited throughout.
- [`02 frontend/metrics_research/`](../02%20frontend/metrics_research/) — metrics surface design.
