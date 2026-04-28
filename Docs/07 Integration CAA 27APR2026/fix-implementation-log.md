# Fix Implementation Log

> Written 2026-04-27, alongside `fix-triage-frontend-vs-backend.md`. Records which fixes from the triage have been **implemented in code on this branch** vs **deliberately deferred**, and *why*.

Branch: `ui_enhancement` · Type-check: `tsc --noEmit` clean · Python AST: clean for all touched files.

---

## 1. Implemented this pass

| # | Fix | Files touched | Notes |
|---|---|---|---|
| **F2** | Boot guards on missing secrets | `frontend/src/server/auth.js`, `backend/pseudonymization/orchestrator/crypto.py`, `backend/pseudonymization/gliner_service/main.py` | Each process refuses to boot when its secret env var is unset *and* `NODE_ENV=production` (FE) / `ENVIRONMENT=production` (BE). Dev keeps the convenience defaults so no local workflow breaks. |
| **F3** | Stop hardcoding `X-User-Role: reviewer` | `frontend/src/app/api/audio-files/[id]/approve/route.js` | FE now sends the authenticated user's actual role. The BE half (orchestrator should verify a JWT instead of trusting the header) is still open — see deferrals. |
| **F4** | Ownership / role checks on per-file mutation routes | `frontend/src/server/route-helpers.js` (new `requireOwnerOrRole`), `frontend/src/app/api/audio-files/[id]/{edits,approve,request-changes,submit-for-review}/route.js` | Helper resolves `audio_file.owner_id` from `platform.db` and 403s when caller is neither owner nor in `{admin, reviewer, engineer}`. Closes the IDOR surface. |
| **F5** | Rate limiting on `/auth/login` | `frontend/src/proxy.js` | In-memory sliding-window bucket, 8 POSTs / 60 s / IP. Returns 429 + `Retry-After`. Single-instance only — for multi-instance, swap to `@upstash/ratelimit`. |
| **F6** | Upload validation | `frontend/src/app/api/upload/route.js` | Size cap (100 MB, env-overridable), MIME allow-list, extension allow-list, magic-byte sniff over the first 16 bytes for WAV / MP3 / Ogg / FLAC / MP4-M4A / WebM. |
| **F7** | Cookie hardening + static security headers | `frontend/src/server/auth.js`, `frontend/next.config.ts` | `Secure` flag now follows `NODE_ENV`; cookie name flips to `__Host-token` in production. `next.config.ts` `headers()` adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`. |
| **F8 (partial)** | Origin-based CSRF defence | `frontend/src/proxy.js` | All state-changing `/api/*` requests must come from the same host. Together with `SameSite=Lax` this gives two layers. Full double-submit token still pending — see deferrals. |
| **F9** | Tighten BE CORS | `backend/database/main.py`, `backend/pseudonymization/gliner_service/main.py` | `allow_origins` now driven by `ALLOWED_ORIGINS` env (comma-separated), defaults to `http://localhost:3000` for the database service and **empty** for gliner (intra-VNet only). `allow_methods` and `allow_headers` enumerated explicitly. |
| **F10** | Extend Dependabot to npm + pip | `.github/dependabot.yml` | Added `npm` for `/frontend` (with grouped Next/React/tooling updates) and `pip` for all eight backend service directories. |
| **F11** | CSP with per-request nonces | `frontend/src/proxy.js` | Per-request nonce + `script-src 'self' 'nonce-X' 'strict-dynamic'`, plus `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, etc. Pages hit through `proxy.js` are already dynamically rendered (the dashboard layout calls `getServerUser()`), so no new render-mode regression. Recipe per `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`. |
| **F13** | Generic error responses | `frontend/src/app/api/audio-files/[id]/{approve,edits,request-changes,submit-for-review}/route.js` | Real error logged server-side via `console.error`; client gets a generic `detail` string. Stops `err.message` leakage. |
| **F17** | Authentication-event logging | `frontend/src/server/audit.js`, `frontend/src/app/auth/login/route.js`, `frontend/src/app/auth/logout/route.js`, `database(FE)/seed/fixtures/audit_actions.json` | New `audit_action` keys `login_succeeded`, `login_failed`, `logout`, all upserted at module load via `INSERT OR IGNORE` so existing seeded DBs work without re-seeding. Login failures are recorded under the candidate user when the email exists, otherwise under `system`. Captures IP + user-agent. |
| **F19** | Pin Opacus | `backend/retraining-pipeline/requirements.txt` | `opacus==1.5.2` with a comment pointing at FL/DP risk P1. Currently inert — `train.py` doesn't import it yet — but the version is reproducible the moment DP-SGD is wired in. |
| **F24** | Strip published adapter artifacts | `backend/retraining-pipeline/train.py` | New `_strip_published_artifacts()` runs after `model.save_pretrained()`. Anything not in the allow-list (`adapter_config.json`, `adapter_model.safetensors`, tokenizer files, `generation_config.json`) is removed. Prevents `training_args.bin` / `trainer_state.json` / `runs/` from leaving the training enclave with the adapter. |

---

## 2. Implemented partially

### F8 — CSRF (partial)

The Origin/Referer check has landed in `proxy.js`. The full triage scope was *also* a double-submit cookie token. That part is **deferred** because it requires every `frontend/src/services/*.js` `http.post/put/del` call site to attach an `X-CSRF-Token` header — a sweep across ~20 service files plus the React components that bypass the helper. Doing that without a typed verification path risks silent omission. Suggested follow-up: add the token bookkeeping to `frontend/src/services/http.js` so all callers pick it up automatically, then audit for direct `fetch()` use.

### F11 — CSP (production-tested)

The CSP header is in place and the dev path uses `'unsafe-eval'` per the Next.js doc. The production CSP has not yet been smoke-tested end-to-end (`next build && next start`), because the project's pages all currently render dynamically and the nonce is automatically attached to framework scripts — but third-party styles/scripts (`@lottiefiles/dotlottie-react` injects scripts at runtime) may need their own allowance. Suggested follow-up: run `next build && next start`, exercise every page in a browser with the console open, add domains to the `script-src`/`connect-src`/`media-src` directives as needed.

---

## 3. Deferred — needs a decision or out-of-scope infra

| # | Fix | Why deferred |
|---|---|---|
| **F1** | Authenticate the backend `database` FastAPI service | Needs a chosen scheme (shared-secret header vs JWT propagation) plus a sweep of every caller. `frontend/src/server/audio-files.js` is the only caller today, but the change is BE-led and the auth scheme is a design decision. |
| **F12** | HSTS preload | The `Strict-Transport-Security` header is now emitted, but preload-list submission requires a real HTTPS deployment with a domain — not local dev. Will action when the reverse proxy lands. |
| **F14** | mTLS between orchestrator and gliner-service | Cert issuance + Docker network re-config. Cloud-deployment workstream. |
| **F15** | Drop dev port mappings on backend services in `compose.yaml` | Would break the existing local dev workflow where individual backend services are sometimes hit directly from a browser / curl during debugging. Defer until the dev team confirms they're OK switching to `docker compose exec` for ad-hoc pokes. |
| **F16** | Encrypt SQLite at rest / migrate to Postgres | Multi-week migration tracked separately in `azure-deployment-requirements.md`. |
| **F18** | Centralised log aggregation + tracing | Requires Application Insights wiring at the infra layer. |
| **F20** | Real PII scrubbing pipeline | Multi-week BE work — Presidio + forced-alignment audio redaction. |
| **F21** | Decide and document (ε, δ, accounting unit) | Governance artifact, not code. Must precede F22 / F23 / F26. |
| **F22** | Per-user privacy budget ledger | Blocked on F21. |
| **F23** | Drop 4-bit quantisation when DP is on | Would gate behaviour on a `DP_ENABLED` env var that doesn't exist yet (DP-SGD isn't wired in). When Opacus is integrated, add the gate at the same time — annotated as a TODO in `train.py`'s `_PUBLISHED_ARTIFACT_ALLOWLIST` neighbourhood. |
| **F25** | Pick FL framework | Governance — ADR comparing Flower vs NVFlare vs PySyft. |
| **F26** | Update-norm clipping at aggregator | Blocked on F25 (no aggregator exists yet). |
| **F27** | Encrypt `audit_event` rows at rest | Needs a key-management decision (Key Vault layout, rotation cadence). |
| **F28** | Stakeholder one-pager | Governance writing task. |
| **F29** | Provenance check on training manifest | Blocked on `dataset_builder.py` being completed (still WIP per the README). |
| **F30** | Audio-side biometric redaction | Research thread, not a fix. |

---

## 4. Things to verify before this branch ships

1. **Re-seed `platform.db`** (or rely on the runtime upsert in `audit.js`). Both work; re-seeding is cleaner.
2. **`next build && next start`** in production mode to confirm CSP doesn't break any page. Watch the browser console for CSP violations and add directives as needed.
3. **Hit every mutation endpoint as a non-owner**: should now 403. As an owner: should still succeed. As an admin/reviewer/engineer: should succeed.
4. **Login 9 times in a minute from one IP** — the 9th should 429 with a `Retry-After` header.
5. **Upload a non-audio file** with a faked `audio/wav` MIME — should 415 because the magic-byte sniff fails.
6. **Try a cross-origin POST to `/api/audio-files/<id>/approve`** with `Origin: https://evil.example` — should 403.
7. **Confirm `JWT_SECRET` is set** in any deploy that has `NODE_ENV=production` — the FE will refuse to start otherwise. Same for `PSEUDONYM_FERNET_KEY` and `GLINER_SHARED_SECRET` when `ENVIRONMENT=production`.
8. **Run `next lint` and `vitest`** — not run in this pass because lint config issue (`Invalid project directory provided`) and tests need the full DB seed.
