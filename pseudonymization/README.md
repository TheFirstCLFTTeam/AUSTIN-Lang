# Pseudonymisation Module

Implementation of the plan in `docs/06 server/pseudonymisation-module.md`.

## Layout

```
pseudonymization/
├── gliner_service/          # Inference enclave — wraps urchade/gliner_medium-v2.1
│   ├── main.py              # FastAPI: POST /pseudonymise
│   ├── requirements.txt
│   └── Dockerfile
└── orchestrator/            # Submission worker + reviewer API
    ├── api.py               # FastAPI surface (§8 of the plan)
    ├── worker.py            # End-to-end run pipeline
    ├── masking.py           # Pure overlap/merge/placeholder logic
    ├── gliner_client.py     # HTTP client + retry policy
    ├── storage.py           # SQLite persistence
    ├── crypto.py            # Fernet envelope for original_text at rest
    ├── labels.py            # banking-v3 taxonomy (mirrors the FE mock)
    ├── schema.sql           # pseudonymisation_runs / _spans tables
    └── tests/test_masking.py
```

## Why two services

The gliner service is a **separate enclave dependency** even on a laptop —
the submission service talks to it over HTTP. This invariant holds from
dev to prod, so the only thing that changes between environments is
`GLINER_URL`.

The orchestrator owns business logic: masking policy, persistence,
reviewer sign-off. It never imports `transformers` or `gliner` directly.

## Running locally

```bash
# In one terminal
docker compose up gliner-service

# In another
docker compose up pseudonymisation-orchestrator
```

Or via the top-level compose (both come up alongside the existing stack).

## Environment

| Variable                           | Default                  | Notes                                         |
|------------------------------------|--------------------------|-----------------------------------------------|
| `GLINER_URL`                       | `http://localhost:9001`  | Inference endpoint the orchestrator dials.    |
| `GLINER_SHARED_SECRET`             | `dev-shared-secret`      | Header-auth between the two services.         |
| `GLINER_MAX_ATTEMPTS`              | `3`                      | Retries on 5xx with exponential backoff.      |
| `PSEUDONYM_DB_PATH`                | `/app/data/pseudonymisation.db` | SQLite file (volume-mounted in compose). |
| `PSEUDONYM_FERNET_KEY`             | _(generated in dev)_     | At-rest encryption for `original_text`.       |
| `TRANSCRIPT_STATUS_URL`            | _(unset → log only)_     | Where to POST transcript status transitions.  |

## API contract

Matches §8 of the implementation plan:

- `POST /transcripts/:id/submit-for-review` — enqueue a run, return immediately.
- `GET  /transcripts/:id/pseudonymisation` — latest run + spans (originals only for reviewer/admin role).
- `POST /transcripts/:id/pseudonymisation/spans/:span_id/decision` — reviewer accept/reject.
- `POST /transcripts/:id/approve` — guarded on every span having a non-null decision.
- `POST /transcripts/:id/request-changes` — transitions to `needs action`.

Caller role is read from the `X-User-Role` header (and `X-User-Id` for
mutations); in prod an upstream auth proxy is responsible for setting it.

## Tests

```bash
cd pseudonymization
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
