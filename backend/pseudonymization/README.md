# Pseudonymisation Module

Implementation of the plan in `docs/06 server/pseudonymisation-module.md`.

## Layout

```
backend/pseudonymization/
├── gliner_service/          # Inference enclave — wraps urchade/gliner_medium-v2.1
│   ├── main.py              # FastAPI: POST /pseudonymise
│   ├── requirements.txt
│   └── Dockerfile
└── orchestrator/            # Submission worker + reviewer API
    ├── api.py               # FastAPI surface (§8 of the plan + /pseudonymise-now)
    ├── worker.py            # End-to-end run pipeline (async / DB-backed path)
    ├── masking.py           # Pure overlap/merge/placeholder logic
    ├── gliner_client.py     # HTTP client + retry policy
    ├── storage.py           # SQLite persistence
    ├── crypto.py            # Fernet envelope for original_text at rest
    ├── labels.py            # banking-v3 taxonomy (mirrors the FE mock)
    ├── schema.sql           # pseudonymisation_runs / _spans tables
    └── tests/                # test_masking.py + test_pseudonymise_now.py
```

## Why two services

The gliner service is a **separate enclave dependency** even on a laptop —
the submission service talks to it over HTTP. This invariant holds from
dev to prod, so the only thing that changes between environments is
`GLINER_URL`.

The orchestrator owns business logic: masking policy, persistence,
reviewer sign-off. It never imports `transformers` or `gliner` directly.

## Running locally

Both services are wired into the top-level `compose.yaml` and read their
ports from `backend/.env` (matching the convention of every other backend
service). From the repo root:

```bash
docker compose up gliner-service pseudonymisation-orchestrator
```

Or bring the whole stack up with `docker compose up`. Containers listen
on hard-coded ports `5001` (gliner) and `5002` (orchestrator) inside the
docker network — the env vars below only control the host-side mapping.

## Ports (in `backend/.env`)

| Variable                            | Default | Service                    |
|-------------------------------------|---------|----------------------------|
| `GLINER_SERVICE_PORT`               | `5001`  | gliner inference enclave   |
| `PSEUDONYMISATION_ORCHESTRATOR_PORT`| `5002`  | masking orchestrator + API |

## Environment

| Variable                           | Default                  | Notes                                         |
|------------------------------------|--------------------------|-----------------------------------------------|
| `GLINER_URL`                       | `http://localhost:5001`  | Inference endpoint the orchestrator dials.    |
| `GLINER_SHARED_SECRET`             | `dev-shared-secret`      | Header-auth between the two services.         |
| `GLINER_MAX_ATTEMPTS`              | `3`                      | Retries on 5xx with exponential backoff.      |
| `PSEUDONYM_DB_PATH`                | `/app/data/pseudonymisation.db` | SQLite file (named volume in compose). |
| `PSEUDONYM_FERNET_KEY`             | _(generated in dev)_     | At-rest encryption for `original_text`.       |
| `TRANSCRIPT_STATUS_URL`            | _(unset → log only)_     | Where to POST transcript status transitions.  |

## API contract

Two paths are exposed. The frontend MVP uses the **sync** path; the
**async / DB-backed** path is wired up but unused until the reviewer
span sign-off UI lands.

### Sync path (used by the FE today)

- `POST /pseudonymise-now` — body `{segments: [{id, text, lang?}]}`.
  Stateless: runs the masking pipeline (manual-mask precedence → drop
  overlaps → resolve longest-first → assign stable placeholders → render)
  and returns `{masked_segments, spans_count, model_version,
  label_set_version}`. No DB writes. Returns `503` on inference failure
  so the caller can decide whether to block or pass through unmasked.

### Async / DB-backed path (§8 of the plan)

- `POST /transcripts/:id/submit-for-review` — enqueue a run, return immediately.
- `GET  /transcripts/:id/pseudonymisation` — latest run + spans (originals only for reviewer/admin role).
- `POST /transcripts/:id/pseudonymisation/spans/:span_id/decision` — reviewer accept/reject.
- `POST /transcripts/:id/approve` — guarded on every span having a non-null decision.
- `POST /transcripts/:id/request-changes` — transitions to `needs action`.

Caller role is read from the `X-User-Role` header (and `X-User-Id` for
mutations); in prod an upstream auth proxy is responsible for setting it.

## Frontend integration

The submit-for-review button on the file detail page calls the sync
endpoint before flipping status to `'in review'`, so the reviewer always
opens an already-masked transcript. The integration is intentionally
lightweight (POC scope — manual verification is still the source of truth).

| Piece                                       | Role                                                                 |
|---------------------------------------------|----------------------------------------------------------------------|
| `frontend/src/services/pseudonymisation.js` | Tiny fetch client (15s timeout). Default URL `http://localhost:5002`, override via `NEXT_PUBLIC_PSEUDONYM_ORCHESTRATOR_URL`. |
| `submitForReview` in `services/api.js`      | Builds segments via `applyEdits`, POSTs them, then folds masked text into `file.edits` as **system-authored** edits via `recomputeSegmentEdits` so the existing diff/render machinery shows them automatically. |
| `runPseudonymisationForFile` helper         | Best-effort wrapper. On success → `file.pseudonymisationApplied = {spansCount, modelVersion, ...}`. On failure → `file.pseudonymisationWarning = {reason, attemptedAt, attemptedBy}` and the submission proceeds anyway. |
| Warning chip in `files/[id]/page.jsx`       | Red `⚠ AUTO-MASKING SKIPPED` badge next to the status badge, visible to reviewers/admins only when `pseudonymisationWarning` is set. Tooltip carries the failure reason. |

The async/DB-backed endpoints are still wired in `api.py` for when the
reviewer span-by-span sign-off UI lands — they're harmless if unused.

## Tests

```bash
cd backend/pseudonymization
python -m pytest orchestrator/tests/ -v
```

The unit tests cover the pure pipeline (overlap resolution, manual-mask
precedence, stable placeholder counters, full-segment rendering). gliner
client and HTTP layer are intentionally not unit-tested here — replay
fixtures will live alongside the prod deployment.

## What's NOT implemented yet

Phased rollout per §13 of the plan:

- **Shadow mode** wiring (auto-accept all spans, no status change) — the
  worker already produces decided=null spans; a feature flag at the
  `approve` guard is the only delta.
- **Known-entity fast path** — placeholder for the deterministic roster
  pass before gliner runs. Hook in `worker._execute` ahead of step 2.
- **Re-run on stale `label_set_version`** — diff tooling for model upgrade
  pipeline.
