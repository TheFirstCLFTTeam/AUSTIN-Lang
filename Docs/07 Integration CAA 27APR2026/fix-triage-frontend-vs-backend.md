# Remediation Triage — Frontend vs Backend Ownership

> Written 2026-04-27. Inputs: `security overview.md` (top 10 + 16 detailed categories) and `fl-dp-risk-assessment.md` (10 actions + 12 project-specific risks P1–P12) in this folder.
> Purpose: for each fix, decide whether it's owned by the **Next.js frontend**, by a **backend Python module**, or by **both** (and if both, what the contract between them is). Items that are pure infra/CI/governance get their own bucket so they don't fall through the cracks.

Ownership conventions used below:
- **Frontend (FE)** = code under `frontend/` — Next.js App Router routes, server modules in `frontend/src/server/`, `next.config.ts`, `middleware.ts`.
- **Backend (BE)** = code under `backend/` — FastAPI services (`database`, `transcription_orchestrator`, `transcription-service-2`, `audio_submission`, `pseudonymisation/orchestrator`, `pseudonymisation/gliner_service`) and the retraining pipeline.
- **Both** = needs a coordinated change on each side; the row spells out the contract.
- **Infra** = `.github/`, `compose.yaml`, `Dockerfile`s, secrets stores — not application code.
- **Governance** = a written decision/policy artifact, not code.

---

## 1. Master triage table

| # | Fix (source) | Owner | Effort | Blocks |
|---|---|---|---|---|
| F1 | Authenticate the backend `database` FastAPI service ([SO §12, top-1](#)) | **BE** | M | F2, FL/DP cloud move |
| F2 | Refuse to boot when `JWT_SECRET` / `PSEUDONYM_FERNET_KEY` / `GLINER_SHARED_SECRET` are unset (SO §13, top-2) | **Both** (one check per process) | S | Prod deploy |
| F3 | Stop hardcoding `X-User-Role: reviewer` (SO §9, top-3) | **Both** (FE sends real role; BE must verify, not trust) | M | RBAC story |
| F4 | Ownership / role checks on per-file mutation routes (SO §9, top-4) | **FE** | M | — |
| F5 | Rate limiting + login-failure logging on `/auth/login` (SO §7, top-5) | **FE** | S | — |
| F6 | Validate uploads — size cap, MIME allow-list (SO §10, top-6) | **FE** primary; **BE** defence-in-depth | S | — |
| F7 | Set `Secure` on cookie + `__Host-` prefix + security-header bundle (SO §5, §11, top-7) | **FE** | S | HTTPS in front |
| F8 | CSRF protection (anti-CSRF token, `Origin` check) (SO §4, top-8) | **FE** | M | — |
| F9 | Tighten CORS on backend FastAPI services (SO §1, top-9) | **BE** | S | Browser-exposed BE only |
| F10 | Extend Dependabot to npm + pip (SO §6, top-10) | **Infra** | S | — |
| F11 | CSP with per-request nonces (SO §2) | **FE** | M | — |
| F12 | HSTS + preload (SO §3) | **Infra** (reverse proxy) + **FE** (header) | S | HTTPS in front |
| F13 | Generic error responses, no `err.message` leakage (SO §16) | **FE** | S | — |
| F14 | mTLS or stronger between orchestrator and `gliner-service` (SO §12) | **BE** + **Infra** | L | Cloud move |
| F15 | Bind internal services to private network only (SO §12) | **Infra** (`compose.yaml`, Bicep) | S | — |
| F16 | Encrypt SQLite at rest / migrate to Postgres+TDE (SO §14) | **BE** + **Infra** | L | Cloud move |
| F17 | Authentication-event logging (login attempts, failures) (SO §15) | **FE** | S | — |
| F18 | Centralised log aggregation + request tracing (SO §15) | **Infra** + small **FE/BE** hooks | M | Observability |
| F19 | Pin Opacus version (FL/DP §6 P1) | **BE** | S | All DP work |
| F20 | Real PII scrubbing pipeline (Presidio + audio redaction) (FL/DP P4) | **BE** | L | DP claim |
| F21 | Decide & document (ε, δ, accounting unit) (FL/DP §7.3) | **Governance** | S | DP turn-on |
| F22 | Per-user privacy budget ledger (FL/DP P10) | **BE** primary; small **FE** admin view optional | L | Continual learning |
| F23 | Drop 4-bit quantisation when DP is on, or audit it (FL/DP P3) | **BE** | M | DP turn-on |
| F24 | Strip `training_args.bin` / `trainer_state.json` from published adapters (FL/DP P5) | **BE** | S | Adapter export |
| F25 | Pick FL framework with secure aggregation (FL/DP P7) | **Governance** + **BE** | L | FL turn-on |
| F26 | Update-norm clipping & anomaly detection at aggregator (FL/DP §3.3) | **BE** (FL aggregator) | M | FL turn-on |
| F27 | Encrypt `audit_event` rows at rest with a separately-managed key (FL/DP P11) | **FE** (writer side, since `audit.js` is the only writer) + **Infra** (KMS) | M | Compliance |
| F28 | Stakeholder one-pager: what FL+DP do *not* protect against (FL/DP §7.10) | **Governance** | S | Stakeholder sign-off |
| F29 | Provenance check on training manifest entries to mitigate backdoor injection (FL/DP P6) | **BE** (`dataset_builder.py`) — can lean on **FE** `audit_event` data | M | Retraining trust |
| F30 | Voice-biometrics handling (audio-side redaction; transcript-only DP is insufficient) (FL/DP P8) | **BE** (audio_submission + retraining ingest) | L | Privacy claim |

Effort key: **S** ≈ ½–1 day, **M** ≈ 2–5 days, **L** ≈ > 1 week.

---

## 2. Frontend-only fixes (own this entirely)

These never need a backend code change — they're contained inside `frontend/`.

### F4 — Ownership / role checks on per-file mutation routes
- **Where:** `frontend/src/app/api/audio-files/[id]/edits/route.js`, `frontend/src/app/api/audio-files/[id]/approve/route.js`, `frontend/src/app/api/audio-files/[id]/request-changes/route.js`, `frontend/src/app/api/audio-files/[id]/submit-for-review/route.js`.
- **What:** add a helper in `frontend/src/server/route-helpers.js`, e.g. `requireOwnerOrRole(handler, { roles: ['reviewer','admin'] })`, that loads the file's `owner_id` from `platform.db` and 403s if the caller is neither owner nor in the role allow-list.
- **Why this is FE-only:** ownership data lives in `platform.db` and is read directly by `frontend/src/server/audio-files.js`. The backend services don't know about ownership at all.

### F5 — Rate limiting on `/auth/login`
- **Where:** new `frontend/src/middleware.ts`.
- **What:** match `/auth/login` only, sliding-window token bucket keyed on IP (and optionally email if you want to slow per-account brute force). For single-instance deploys an in-memory `Map` is fine; for multi-instance, swap to `@upstash/ratelimit` against Redis.
- **Returns:** `429 Too Many Requests` with a `Retry-After` header.

### F6 — Upload validation (primary check)
- **Where:** `frontend/src/app/api/upload/route.js`.
- **What:** before forwarding to the orchestrator:
  - reject if `file.size > MAX_UPLOAD_BYTES` (suggest 100 MB cap configurable via env);
  - reject if `file.type` is not in an allow-list (`audio/wav`, `audio/x-wav`, `audio/mpeg`, `audio/mp4`, `audio/ogg`, `audio/flac`);
  - reject if filename extension doesn't match the MIME family;
  - sniff first N bytes against a magic-number table for the same families (don't trust the client `type` alone).
- **Note:** the backend should still validate too (see F6 in §3) — defence in depth.

### F7 — Cookie hardening + security headers
- **Where:** `frontend/src/server/auth.js` (cookie) + `frontend/next.config.ts` (headers).
- **What:**
  - In `setAuthCookie()`: rename the cookie to `__Host-token`, drop `domain`, set `path: '/'`, set `secure: process.env.NODE_ENV === 'production'`.
  - In `next.config.ts`, add `async headers()` returning `Strict-Transport-Security` (only meaningful when behind HTTPS — pair with F12), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

### F8 — CSRF protection
- **Where:** `frontend/src/server/route-helpers.js` + every mutating route (POST/PUT/PATCH/DELETE).
- **What:** double-submit cookie pattern. Issue a `csrf` cookie on first GET (random 32 bytes, `SameSite=Strict`, **not** HttpOnly so JS can read it). Wrap `requireUser` to also require an `X-CSRF-Token` header that matches. As a belt: in the same wrapper, reject if `Origin` is set and not in the configured allow-list.

### F11 — CSP with per-request nonces
- **Where:** `frontend/src/middleware.ts` (already added for F5) + `next.config.ts`.
- **What:** generate a per-request nonce in middleware, write it onto the response header `Content-Security-Policy: script-src 'self' 'nonce-<X>'; style-src 'self' 'nonce-<X>'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`. Pass the nonce to `<Script nonce={...}>` consumers in the App Router. The Next.js docs under `node_modules/next/dist/docs/` have the canonical recipe — read those before coding (per `frontend/AGENTS.md`).

### F13 — Generic error responses
- **Where:** `frontend/src/app/api/audio-files/[id]/approve/route.js:65`, `.../edits/route.js:18`, plus any other `NextResponse.json({ detail: err.message })`.
- **What:** log the real error server-side (with a correlation id), return a generic message + the correlation id to the client.

### F17 — Authentication-event logging
- **Where:** `frontend/src/app/auth/login/route.js` + `frontend/src/server/audit.js`.
- **What:** add `audit_action` rows for `login_succeeded`, `login_failed`, `logout`. Recording this on the FE side is fine because all auth currently flows through Next.js routes.

---

## 3. Backend-only fixes (own this entirely)

### F1 — Authenticate the `database` FastAPI service
- **Where:** `backend/database/main.py`.
- **What:** add a FastAPI dependency that verifies a service-to-service credential. Two reasonable shapes:
  - **Shared-secret header** (matches the existing pattern in `backend/pseudonymization/gliner_service/main.py`) — lowest-effort, fine for now.
  - **JWT signed by the same key as the user JWT** — better for audit, lets the database log "which user's request triggered this write".
- **Caller side:** the only caller today is `frontend/src/server/audio-files.js` (`coWriteEditedTranscriptToBackend`); whichever scheme is picked, that one call site adds an `Authorization` or `X-Service-Token` header. *Calling-side change is small enough that this stays a BE-led fix.*

### F9 — Tighten CORS on backend FastAPI
- **Where:** `backend/database/main.py:25-31`, `backend/pseudonymization/gliner_service/main.py:34-40`.
- **What:**
  - `allow_origins`: a strict list of deployed frontend origins (no `*`).
  - `allow_methods`: enumerate (`["GET", "POST", "PUT"]`), don't wildcard.
  - `allow_credentials`: keep `True` only if the FE actually sets a cookie; gliner-service should stay `False`.

### F19 — Pin Opacus
- **Where:** `backend/retraining-pipeline/requirements.txt`.
- **What:** add `opacus==<version>` (latest known-good at the time of integration) and a comment pointing to the row P1 in `fl-dp-risk-assessment.md` so the pin is not silently bumped.

### F20 — Real PII scrubbing pipeline
- **Where:** `backend/retraining-pipeline/pii_scrubbing.py` (currently stubs) + integration into `backend/retraining-pipeline/dataset_builder.py`.
- **What:** Presidio analyzer for text spans, plus a forced-alignment audio redaction pass (mute byte ranges in the WAV that align to PII spans). Run **before** the manifest is written, so `train.py` only ever sees scrubbed data.
- **Cross-reference:** the gliner pseudonymisation pipeline already detects PII spans for the *display* path. If those spans are persisted with their character offsets, the retraining-side scrubber can reuse them rather than re-running NER.

### F23 — Drop 4-bit quantisation when DP is on (or audit)
- **Where:** `backend/retraining-pipeline/train.py:117-128` (the `BitsAndBytesConfig` block).
- **What:** gate the 4-bit branch on `DP_ENABLED == False`. When DP is on, load the model in fp16 (still LoRA-friendly), accept the memory cost. The privacy bound from Opacus's accountant is otherwise un-audited. (See `fl-dp-risk-assessment.md` §4.9.)

### F24 — Strip hyperparameter artifacts from published adapters
- **Where:** `backend/retraining-pipeline/train.py:194-196` (post-save block).
- **What:** after `model.save_pretrained()`, delete `training_args.bin`, `trainer_state.json`, `runs/`, anything else under `OUTPUT_DIR` that isn't `adapter_model.safetensors` + `adapter_config.json` + tokenizer files. (See `fl-dp-risk-assessment.md` §4.5 / P5.)

### F26 — Update-norm clipping at aggregator (when FL is built)
- **Where:** new module under `backend/retraining-pipeline/` (or wherever the FL coordinator lands).
- **What:** at aggregation time, reject or clip client updates whose L2 norm exceeds a configured threshold; log cosine-similarity outliers vs the median update direction. Mitigates §3.3 (model poisoning / backdoors).

### F29 — Provenance check on training manifest
- **Where:** `backend/retraining-pipeline/dataset_builder.py` (currently WIP per the README).
- **What:** when building the manifest, only ingest `audio_file`s whose latest `audit_event` chain contains an `approved` action by a user with role `reviewer` (or higher). The data is in `platform.db`, which is reachable via the database FastAPI service after F1 lands. Closes most of P6.

### F30 — Audio-side redaction
- **Where:** `backend/audio_submission/` and `backend/retraining-pipeline/pii_scrubbing.py`.
- **What:** voice biometrics survive transcript-only redaction. Full mitigation is hard; partial measures: low-pass filter + pitch shift + speaker-anonymisation models on training audio, before the manifest. Treat as a research thread rather than a checkbox.

---

## 4. Cross-cutting (FE + BE coordinated change)

These need work on both sides simultaneously, so the contract between them needs writing down.

### F2 — Refuse to boot on missing secrets
- **FE side** (`frontend/src/server/auth.js`): replace the fallback with `if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set')`. Place at module top so the error fires at import time, not first request.
- **BE side** (`backend/pseudonymization/orchestrator/crypto.py:18-27`, `backend/pseudonymization/gliner_service/main.py:26`): same pattern for `PSEUDONYM_FERNET_KEY` and `GLINER_SHARED_SECRET`. Today both fall back to dev defaults (the Fernet key is *regenerated on each restart*, which silently invalidates existing ciphertexts).
- **Contract:** add a single env var, e.g. `ENVIRONMENT=production`, that the boot checks consult — so dev keeps the convenience defaults and prod refuses to start.

### F3 — Stop hardcoding `X-User-Role: reviewer`
- **FE side** (`frontend/src/app/api/audio-files/[id]/approve/route.js:22-29`): pass the actual `user.role` from `requireUser`.
- **BE side** (`backend/pseudonymization/orchestrator/`): instead of trusting the header, accept a JWT (the same one issued to the user) and read `role` from the verified payload. Otherwise *any* upstream caller can claim any role.
- **Contract:** define a service token format. Suggest reusing the user JWT and requiring a header like `Authorization: Bearer <user-jwt>` — saves inventing a second token.

### F6 — Upload validation (defence-in-depth side)
- **BE side** (`backend/audio_submission/`, `backend/transcription_orchestrator/`): the orchestrator should also validate file size, type, and duration before handing off to the Whisper service. Required because direct calls bypass the FE.

### F12 — HSTS
- **Infra side**: terminate TLS at a reverse proxy (Azure Front Door per the deployment plan) and set `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` there.
- **FE side**: optionally also emit the header from `next.config.ts` as belt-and-braces.
- **Governance side**: submit the production domain to https://hstspreload.org once HSTS has been live for ≥ 30 days.

### F22 — Per-user privacy budget ledger
- **BE primary**: `backend/retraining-pipeline/` gains a small `privacy_ledger.py` that decrements `(user_id → ε_remaining)` on each training round. Refuses to build a manifest entry for a user whose budget is exhausted.
- **FE optional**: an admin page under `frontend/src/app/(dashboard)/admin/` to surface remaining-budget per user.
- **Contract:** the ledger lives in `platform.db` (or its Postgres successor) so it's reachable by both training jobs (write) and the admin UI (read-only).

### F27 — Encrypt `audit_event` rows at rest
- **FE side** (`frontend/src/server/audit.js`): wrap the `details_json` field in Fernet (or use a column-level encryption helper) before insert.
- **Infra side**: the encryption key itself lives in Key Vault, mounted via a service identity. Rotation policy needs to be documented.
- **Contract:** decide what's encrypted at the column level vs what relies on database-level TDE; column-level is more defensive but means existing read paths need decrypt steps.

---

## 5. Infra-only fixes (no application code changes)

### F10 — Extend Dependabot
- **Where:** `.github/dependabot.yml`.
- **What:** add `package-ecosystem: "npm"` (`/frontend`) and `package-ecosystem: "pip"` for each backend service that ships a `requirements.txt` (the directories are: `audio_submission`, `database`, `pseudonymization/gliner_service`, `pseudonymization/orchestrator`, `retraining-pipeline`, `server`, `transcription_orchestrator`, `transcription-service-2`, `metrics_service`).

### F14 — mTLS between orchestrator and gliner-service
- **Where:** `compose.yaml` (today) → cloud network policy (later).
- **What:** issue per-service certs, configure both services to require client cert. Today's shared-secret header drops to defence-in-depth.

### F15 — Bind internal services to private network only
- **Where:** `compose.yaml`. Drop the `ports:` mapping for `database`, `gliner-service`, `pseudonymisation-orchestrator`, `transcription-service-2`, `audio_submission`, `transcription-orchestrator` — they're only reached from inside the compose network. Keep the mapping only for `frontend:3000`.
- **Cloud follow-on:** reproduce in Bicep / Terraform with private VNet only.

### F16 — Encrypt SQLite / migrate to Postgres
- **Where:** `database(FE)/users.db`, `database(FE)/platform.db`, `backend/database/poc.db`.
- **What:** for prod, migrate to Azure Database for PostgreSQL Flexible Server (TDE on by default). For local dev, accept SQLite as-is. Migration is in the Azure plan §2.

### F18 — Centralised logging + tracing
- **Where:** Application Insights wiring at the infra layer; small `console.log`/`logger` adjustments on each service to emit JSON + correlation ids. Mostly infra; service-side change is one shared logger module per language.

---

## 6. Governance items (no code)

### F21 — Decide and document (ε, δ, accounting unit)
- Owner: ML lead + privacy/legal.
- Output: a short decision record in `Docs/ZZ ML Research/` capturing the chosen ε, δ, accounting unit (per-utterance vs per-user), and the data-class scope. Block any DP-asserting deploy on this artifact existing.

### F25 — Pick FL framework
- Owner: ML lead.
- Output: ADR comparing Flower (`SecAgg+`), NVFlare, PySyft. Decision criteria: secure-aggregation maturity, Azure ML compatibility, language fit (PyTorch ecosystem aligns with current `train.py`).

### F28 — Stakeholder one-pager: what FL+DP do *not* protect against
- Owner: same.
- Output: 1-page plain-English explainer mirroring `fl-dp-risk-assessment.md` §9, signed off before FL/DP are publicly claimed.

---

## 7. Suggested sequencing

Some fixes block others. A reasonable order:

**Wave 1 — quick wins, no blockers (≤ 1 sprint)**
F2 (boot guards), F7 (cookie + headers), F13 (generic errors), F15 (drop dev port mappings), F10 (dependabot), F19 (pin Opacus), F24 (strip adapter artifacts), F17 (auth-event logging).

**Wave 2 — application security baseline**
F4 (ownership checks), F5 (rate limit), F6 (upload validation, FE+BE), F8 (CSRF), F11 (CSP nonces), F9 (BE CORS), F1 (database-service auth) → which then enables F3 (real role propagation) and F29 (provenance checks).

**Wave 3 — FL/DP enablement**
F21 (ε decision) → F22 (privacy ledger) → F23 (quantisation gate) → F20 (PII scrubbing) — all required *before* `DP_ENABLED=true`. F25 → F26 *before* FL goes live.

**Wave 4 — cloud move**
F12 (HSTS), F14 (mTLS), F16 (Postgres migration), F18 (logging), F27 (audit-event encryption), F30 (audio redaction). These align with the Azure deployment workstream.

---

## 8. One-line summary

Of the 30 fixes triaged, **12 are pure-frontend** (most security-header / cookie / route-guard work), **12 are pure-backend** (FastAPI auth, retraining-pipeline cleanup), **3 need coordinated FE+BE work** (boot guards, role propagation, privacy ledger), and **6 are infra/governance** (Dependabot, network isolation, ε decision, framework choice). Wave 1 is achievable inside a single sprint and removes the most embarrassing-to-explain findings; FL/DP enablement is gated on Wave 2 + the governance decisions.
