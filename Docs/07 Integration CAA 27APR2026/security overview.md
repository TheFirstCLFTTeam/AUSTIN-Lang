# Security Overview

A snapshot of the common web/application security measures relevant to this stack and where AUSTIN-Lang stands against each. Scope: the Next.js frontend (`frontend/`) and the FastAPI backend services that sit behind it (`backend/`). Last reviewed 2026-04-27 against the `ui_enhancement` branch.

> Legend: ✅ implemented · ⚠️ partial / weak · ❌ missing

---

## 2026 Baseline Checklist

The seven measures below are now considered standard requirements, not nice-to-haves, for any production web app. Each row links to the deeper section in this document.

| # | Measure | Status | One-line summary |
|---|---|---|---|
| 1 | [CORS — strict origin allow-list](#1-cors-cross-origin-resource-sharing) | ⚠️ | Frontend uses Next.js same-origin, but `backend/database` and `gliner-service` use loose CORS (`*` or wildcards). |
| 2 | [CSP — Content-Security-Policy with nonces](#2-csp-content-security-policy) | ❌ | No `Content-Security-Policy` header set anywhere; `next.config.ts` declares no `headers()` block. |
| 3 | [HSTS — Strict-Transport-Security + preload](#3-hsts-http-strict-transport-security) | ❌ | Stack runs over plain HTTP in dev/compose; no HSTS header, no preload entry. |
| 4 | [CSRF — SameSite + anti-CSRF token](#4-csrf-cross-site-request-forgery) | ⚠️ | Cookie is `SameSite=Lax`; **no** synchroniser/double-submit token on state-changing routes. |
| 5 | [Secure cookie attributes (`HttpOnly`, `Secure`, `SameSite`)](#5-secure-cookie-attributes) | ⚠️ | `HttpOnly` ✅, `SameSite=Lax` ✅, `Secure: false` hardcoded ❌. |
| 6 | [Software supply chain (SCA + SRI)](#6-software-supply-chain--dependency-audits) | ❌ | Dependabot configured for **devcontainers only**; no npm/pip scanning in CI; no SRI on any external script (none loaded today). |
| 7 | [Rate limiting & bot protection](#7-rate-limiting-and-ai-bot-protection) | ❌ | No throttling, no CAPTCHA, no behavioural analysis on `/auth/login` or anywhere else. |

> **Quick checklist (yes/no form):**
> * [ ] Is `Access-Control-Allow-Origin` specific? — **No** for the database/gliner FastAPI services.
> * [ ] Do you have a `Content-Security-Policy` header? — **No.**
> * [ ] Are your cookies marked `HttpOnly` and `Secure`? — `HttpOnly` yes, `Secure` no.
> * [ ] Is HSTS enabled and preloaded? — **No.**
> * [ ] Do you run automated vulnerability scans on your dependencies? — **No** for application code.

---

## Detailed assessment

### 1. CORS (Cross-Origin Resource Sharing)

CORS is a **browser-enforced** instruction telling the browser which origins it should let touch your API. Server-to-server traffic ignores it entirely — so it's only one half of an access-control story, but a critical half for any browser-fronted API.

| Measure | Status | Where / Notes |
|---|---|---|
| No `Access-Control-Allow-Origin: *` in production | ⚠️ | `backend/pseudonymization/gliner_service/main.py` allows `allow_origins=["*"]` with `allow_credentials=False`. Acceptable because creds are off and the service is meant to live inside the enclave network, but if it ever gets exposed to a browser this becomes a footgun. |
| Strict origin allow-list (echo-back pattern) | ⚠️ | `backend/database/main.py` allow-lists `["http://localhost", "http://localhost:3000"]` with `allow_credentials=True`, `allow_methods=["*"]`. **No** dynamic echo of the `Origin` header against a multi-tenant whitelist; any prod move needs to add the deployed frontend origin and drop the wildcard methods. |
| Frontend never reads cross-origin with credentials | ✅ | All UI traffic is same-origin to the Next.js app; backend services are reached server-side from API routes, not from the browser. |
| `Access-Control-Allow-Methods` minimised | ❌ | Both FastAPI services use `["*"]`; should be narrowed to the verbs actually served. |

**Pro tip to apply:** when you add a real allow-list for prod, validate the incoming `Origin` against the list and echo it back exactly — never reflect arbitrary origins, and never combine `allow_origins=["*"]` with `allow_credentials=True` (browsers will reject it anyway).

### 2. CSP (Content-Security-Policy)

CSP is the single most effective defence against XSS — it tells the browser which script sources to trust, and blocks everything else.

| Measure | Status | Where / Notes |
|---|---|---|
| `Content-Security-Policy` response header | ❌ | `next.config.ts` does not declare an `async headers()` function. Pages ship with no CSP. |
| `script-src 'self'` (no `'unsafe-inline'`) | ❌ | Not configured. Next.js does inject some inline scripts for hydration; in 2026 the recommended pattern is **per-request nonces** issued from middleware so `'unsafe-inline'` can be dropped. |
| Per-request nonce on inline scripts | ❌ | Would require a `middleware.ts` that generates a nonce, stamps it on the CSP header, and passes it through `headers()` for `<Script nonce={...} />` consumers. |
| `frame-ancestors 'none'` (clickjacking) | ❌ | No CSP, no `X-Frame-Options` fallback. |
| `object-src 'none'` / `base-uri 'self'` | ❌ | Not set. |
| Trusted Types / DOMPurify on rich text | n/a | No rich-text input surface today; nothing uses `dangerouslySetInnerHTML`. |

**Implementation hint:** Next.js documents the recipe under `node_modules/next/dist/docs/` (per repo convention, read those before coding) — the canonical pattern is a nonce in `middleware.ts` plus a `headers()` block in `next.config.ts`.

### 3. HSTS (HTTP Strict Transport Security)

HSTS tells browsers "never use HTTP to talk to me again," shutting the MitM window between the user typing `http://...` and the server's redirect.

| Measure | Status | Where / Notes |
|---|---|---|
| `Strict-Transport-Security` header on HTTPS responses | ❌ | Not set. Stack currently serves plain HTTP from `compose.yaml` (no TLS termination). |
| `max-age` ≥ 1 year, `includeSubDomains` | ❌ | Not configured. |
| Preload entry on `hstspreload.org` | ❌ | Domain not submitted (no public domain configured yet). |
| Redirect HTTP → HTTPS at the edge | ❌ | No reverse proxy in compose. |

**Note:** HSTS only matters once you're behind real HTTPS. For now this is a "wire it in when you put a reverse proxy in front of the stack" item — but worth noting *before* that day so it doesn't get forgotten.

### 4. CSRF (Cross-Site Request Forgery)

CSRF tricks an authenticated user's browser into making a state-changing request the user didn't intend. The 2026 defence is **two layers**: `SameSite` cookies *and* a synchroniser/double-submit token.

| Measure | Status | Where / Notes |
|---|---|---|
| `SameSite=Lax` (or `Strict`) on auth cookie | ✅ | `setAuthCookie()` in `frontend/src/server/auth.js` sets `sameSite: 'lax'`. Lax blocks CSRF on cross-site form posts and top-level navigations. |
| Synchroniser / double-submit token | ❌ | No token validation on POST/PUT routes. Routes rely 100% on the cookie. |
| `Origin` / `Referer` validation as fallback | ❌ | Not checked. |
| Logout uses POST (not GET) | ✅ | `app/auth/logout/route.js` is `POST` only. |

**Why both layers matter:** `SameSite=Lax` does not protect against same-site attackers — any reflected XSS, subdomain takeover, or open redirect on the same registrable domain bypasses it. A token (or `Origin` allow-list check in `requireUser`) is needed before this is called solved.

### 5. Secure cookie attributes

The session cookie is the keys to the kingdom. All three attributes need to be on simultaneously to be safe.

| Attribute | Set today? | Where / Notes |
|---|---|---|
| `HttpOnly` | ✅ | `setAuthCookie()` — JS can't read the cookie, blocking XSS-based theft. |
| `Secure` | ❌ | Hardcoded `secure: false`. Needs to flip to `true` (or `process.env.NODE_ENV === 'production'`) once the stack runs over HTTPS. |
| `SameSite` | ✅ | `'lax'` — see CSRF section. |
| `Path` scoped to `/` | ✅ | Cookie scoped sitewide intentionally so all routes see the session. |
| Sensible `Max-Age` | ✅ | 12 hours; matches the JWT expiry. |
| `__Host-` prefix | ❌ | Cookie is named plain `token`. The `__Host-` prefix would force `Secure` + `Path=/` + no `Domain`, providing belt-and-braces against subdomain attacks. |

### 6. Software supply chain & dependency audits

Modern attacks increasingly target dependencies, not your code.

| Measure | Status | Where / Notes |
|---|---|---|
| Lockfiles committed | ✅ | `frontend/package-lock.json` present. |
| SCA in CI (Dependabot / Snyk / `npm audit`) | ❌ | `.github/dependabot.yml` exists but configures only the **devcontainers** ecosystem — npm and pip are not scanned. There is no GitHub Actions workflow running `npm audit`, `pip-audit`, or Snyk. |
| Subresource Integrity (SRI) on CDN scripts | n/a → ❌ | Grep finds no `<script src=...>` to external CDNs (`unpkg`, `jsdelivr`, `googleapis`, `cloudfront`). The only external resource is Google Fonts via `next/font/google`, which Next.js self-hosts at build time so SRI doesn't apply. **Document this as a rule:** any future external `<script>` tag must include an `integrity` hash. |
| Pinned major versions | ⚠️ | All deps use caret ranges (`^`); fresh installs may pull breaking minors of pre-1.0 packages (e.g. `lucide-react ^1.8.0`). |
| `.env` gitignored | ✅ | `.gitignore` includes `.env` and `.env.*` (with an allow-list exception for `.env.example`). |
| Production credentials in repo | ⚠️ | Seeded SQLite files (`database(FE)/users.db`, `database(FE)/platform.db`, `backend/database/poc.db`) are committed. Fine while they hold demo data; a leak vector if real PII ever lands there. |

**Action:** extend `dependabot.yml` with `package-ecosystem: "npm"` (directory `/frontend`) and `package-ecosystem: "pip"` for the relevant backend service `requirements.txt` paths.

### 7. Rate limiting and AI bot protection

In 2026 the threat surface includes scrapers and credential-stuffing bots, not just human attackers.

| Measure | Status | Where / Notes |
|---|---|---|
| Per-IP throttling on `/auth/login` | ❌ | None. Brute-force surface is wide open. |
| Per-IP throttling on expensive endpoints (upload, transcribe) | ❌ | None. A single client can saturate the orchestrator. |
| Login-failure lockout / exponential backoff | ❌ | None. |
| Behavioural CAPTCHA (e.g. CAPTCHA v3, Turnstile) | ❌ | None. The login form is a plain HTML form. |
| Bot allow-list / WAF / edge filtering | ❌ | No CDN/WAF in front of the stack. |

**Implementation hint:** in Next.js, rate limiting fits naturally in `middleware.ts` (e.g. with `@upstash/ratelimit` or a small in-memory token bucket for single-instance deployments). Behavioural CAPTCHA (Turnstile or reCAPTCHA v3) can be wired into the login route's POST handler.

---

## Detailed assessment — other categories

### 8. Authentication

| Measure | Status | Where / Notes |
|---|---|---|
| Passwords hashed with a slow KDF | ✅ | `bcryptjs` via `frontend/src/server/auth.js` (`verifyPassword`). Hashes live in `users.db.user.password_hash`. |
| Signed session tokens | ✅ | JWT (HS256) issued via `jose` in `issueJwt()` — 12-hour TTL, `sub` carries the user id. |
| JWT secret enforced at startup | ⚠️ | `JWT_SECRET` falls back to the literal string `dev-only-not-for-production-please-set-JWT_SECRET`. No assertion that the env var is set in non-dev — silent insecure default. |
| Session revocation / logout invalidation | ⚠️ | `clearAuthCookie()` removes the client cookie, but JWTs are stateless; a leaked token remains valid for up to 12h. No deny-list. |
| Brute-force protection on login | ❌ | See §7 above. |
| Multi-factor / SSO | ❌ | Not implemented. |

**Note:** The older doc `Docs/04 security/user authentication.md` describes a fake-JWT/`localStorage` mock — that has been **superseded**. Real cookie-based auth is now wired through Next.js API routes.

### 9. Authorization (access control)

| Measure | Status | Where / Notes |
|---|---|---|
| Server-side auth guard on protected routes | ✅ | `requireUser()` in `frontend/src/server/route-helpers.js` wraps API handlers and returns 401 if no session. Used by every `/api/*` route under audio-files, upload, etc. |
| Server-rendered pages re-check the user | ✅ | `app/(dashboard)/layout.jsx` calls `getServerUser()` per request. |
| Role-based authorization (RBAC) | ⚠️ | A `role` column exists on `user`, and a few pseudonymisation routes check it. **Most routes only check "logged in"**, not role — e.g. anyone can hit `/api/audio-files/[id]/approve`. |
| Object-level / ownership checks | ⚠️ | `listAudioFiles` filters by `ownerId === user.id` for `scope=submitted`, but most detail/edit endpoints (`writeEditsForFile`, `setAudioFileStatus`) accept any file id from any logged-in user. IDOR surface. |
| Trusted role propagation to backend services | ❌ | `app/api/audio-files/[id]/approve/route.js` sends `X-User-Role: reviewer` **hardcoded** to the orchestrator regardless of who is calling. The orchestrator's role check is therefore decorative. |

### 10. Input validation & injection

| Measure | Status | Where / Notes |
|---|---|---|
| Parameterised SQL everywhere | ✅ | All queries use `better-sqlite3` prepared statements (`db.prepare(...).get(?, ?)`). No string concatenation found. |
| Pydantic schema validation on FastAPI routes | ✅ | `backend/database/main.py`, pseudonymisation orchestrator etc. use `BaseModel`. |
| JSON body validation in Next.js routes | ⚠️ | Routes `try/catch` on `request.json()` and check that required keys exist, but there is no schema validation (zod/yup) — extra fields and wrong types pass through. |
| File upload validation (MIME / size / extension) | ❌ | `app/api/upload/route.js` accepts any `formData().get('file')` and forwards it. No size cap, no MIME allow-list, no extension check. A malicious upload is bounded only by what the orchestrator does. |
| ORM / SQL escape for user-controlled identifiers | ✅ | `audit.js` uses parameter placeholders even for `id LIKE` patterns. |

### 11. XSS / output encoding

| Measure | Status | Where / Notes |
|---|---|---|
| Default React/JSX escaping | ✅ | All UI rendering goes through JSX — no `dangerouslySetInnerHTML` found anywhere in `frontend/src`. |
| Content-Security-Policy header | ❌ | See §2 above. |

### 12. Transport & deployment

| Measure | Status | Where / Notes |
|---|---|---|
| HTTPS / TLS termination | ❌ | `compose.yaml` exposes raw HTTP on `:3000` (frontend) and `:8002`+ (backend) with no reverse proxy / no certs. |
| Internal services bound to localhost only | ❌ | All services in `compose.yaml` map ports to the host (`"${PORT}:${PORT}"`), so `database` (FastAPI on 8002) and `gliner-service` are reachable from anything that can reach the Docker host. |
| Backend service-to-service auth | ⚠️ | `gliner-service` checks a `GLINER_SHARED_SECRET` header (defence-in-depth, mTLS planned for prod per code comment). The `database` FastAPI service has **no auth at all** — anyone who reaches `:8002` can read/write every transcript. |

### 13. Secrets management

| Measure | Status | Where / Notes |
|---|---|---|
| Secrets via env vars, not source | ✅ | `JWT_SECRET`, `GLINER_SHARED_SECRET`, `PSEUDONYM_FERNET_KEY` all read from env. |
| No insecure defaults in production paths | ❌ | `JWT_SECRET`, `GLINER_SHARED_SECRET`, and `PSEUDONYM_FERNET_KEY` all silently fall back to dev values (the Fernet key is regenerated on each restart, which would render existing ciphertexts unreadable). |
| Secrets vault / rotation | ❌ | `.env` only. No KMS, no rotation policy. (`crypto.py` explicitly flags KMS rotation as an open item.) |
| `.env` gitignored | ✅ | Confirmed in `.gitignore` (`.env`, `.env.*` with `!.env.example`). |

### 14. Data protection

| Measure | Status | Where / Notes |
|---|---|---|
| PII pseudonymisation pipeline | ✅ | `backend/pseudonymization/` — gliner NER → orchestrator masks spans; original text encrypted at rest. |
| At-rest encryption of sensitive spans | ✅ | Fernet (AES-128-CBC + HMAC-SHA256) via `crypto.py`. |
| Database-level encryption | ❌ | SQLite files are plain on disk. No SQLCipher, no FDE assumption. |
| Backup / recovery policy | ❌ | None documented. |

### 15. Auditing & logging

| Measure | Status | Where / Notes |
|---|---|---|
| User-action audit trail | ✅ | `frontend/src/server/audit.js` writes to `platform.db.audit_event` for upload, edit, approve, request-changes, etc. Catalog enforced via FK to `audit_action`. |
| Authentication event logging | ❌ | No record of login attempts, failures, or token issuance. |
| Centralised log aggregation | ❌ | Backend services use `print()` / `console.warn`. No structured logging, no shipper. |
| Request tracing | ❌ | No correlation IDs across frontend → orchestrator → gliner. |

### 16. Other web-app hygiene

| Measure | Status | Where / Notes |
|---|---|---|
| `server-only` guard to keep server modules off the client bundle | ✅ | Used in `auth.js`, `db.js`, `route-helpers.js`, `audio-files.js`, `audit.js`. |
| Generic error responses (no stack-trace leakage) | ⚠️ | Some routes return raw `err.message` in `detail` (e.g. `setAudioFileStatus` errors, `writeEditsForFile`). Low risk today but should be sanitised before prod. |
| `X-Content-Type-Options: nosniff` | ❌ | Not set. |
| `Referrer-Policy` | ❌ | Not set. |
| `Permissions-Policy` | ❌ | Not set. |
| Account lockout / password policy | ❌ | No min length, no rotation, no lockout. |

---

## Top remediation priorities (if this were going to production tomorrow)

1. **Authenticate the backend `database` FastAPI service** (`backend/database/main.py`) — currently any process on the Docker host has unrestricted CRUD on transcripts.
2. **Refuse to boot when `JWT_SECRET` / `PSEUDONYM_FERNET_KEY` / `GLINER_SHARED_SECRET` are unset** outside dev. Silent insecure defaults are worse than a crash.
3. **Stop hardcoding `X-User-Role: reviewer`** in `approve/route.js`; pass the real role and have the orchestrator enforce it.
4. **Add ownership / role checks** on per-file mutation routes (edits, approve, request-changes) to close the IDOR surface.
5. **Add rate limiting and login-failure logging** on `/auth/login` (Next.js `middleware.ts` + token bucket).
6. **Validate uploads** in `/api/upload` (size cap, MIME allow-list).
7. **Set `Secure` on the auth cookie** when behind HTTPS, rename to `__Host-token`, and add the security-header bundle (`Content-Security-Policy` with nonces, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`) via `next.config.ts`'s `async headers()`.
8. **Add CSRF protection** for state-changing JSON routes — `SameSite=Lax` alone is not sufficient given modern browser quirks and any future subdomain exposure.
9. **Tighten CORS on the backend FastAPI services** — drop `allow_methods=["*"]`, restrict origins to the deployed frontend domain only, and never combine `allow_origins=["*"]` with `allow_credentials=True`.
10. **Extend Dependabot** to cover the `npm` ecosystem in `/frontend` and `pip` in each backend service directory; add an `npm audit --audit-level=high` step to CI.
