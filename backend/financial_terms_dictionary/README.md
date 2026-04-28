# financial-terms-dictionary

A FastAPI microservice that maintains a user-curated financial-terms dictionary. Reviewers add or flag terms while editing transcripts; admins moderate via a queue; ML engineers consume the approved list at eval-manifest build time and at training-data packaging time.

Design background: [`docs/07 Integration CAA 27APR2026/financial-terms-dictionary.md`](../../docs/07%20Integration%20CAA%2027APR2026/financial-terms-dictionary.md).

## Status

**Slices 1 + 2 (this directory):** microservice scaffold — schema + helpers + routes + tests + Docker + compose wiring (slice 1) **plus** CSV bulk-import + cleaner (slice 2). On a fresh container with `SEED_ON_BOOT=true` (default) and the bundled CSV, the dictionary auto-populates with **6,013 approved terms + 303 pending** for admin triage (95.2% / 4.8% split against the real Investopedia-derived seed; remaining 2 rows were in-CSV duplicates).

The matching algorithm (`app/matching.py`) is still pending — it ships with slice 4 when the metric strategy lands. FE proxy + admin UI in slice 3; metrics integration in slice 4; auto-trail occurrence hook in slice 5.

## Layout

```
app/
├── main.py                # FastAPI bootstrap; mounts the route modules + seeds-on-boot
├── config.py              # pydantic-settings, env-driven
├── db.py                  # SQLite — terms + occurrences + snapshot helpers
├── schema.sql             # idempotent DDL
├── models.py              # pydantic request / response shapes
├── routes_terms.py        # POST/GET/PATCH /terms with role gates
├── routes_occurrences.py  # POST /occurrences + /occurrences/stats + /dictionary/snapshot
├── routes_admin.py        # POST /terms/bulk-import (admin only)
└── seed.py                # CSV cleaner + importer (idempotent; encoding-tolerant)
financialTerms.csv         # 6,318-row Investopedia-derived seed
tests/
├── test_dictionary.py     # 26 unittest cases (storage + HTTP)
└── test_seed.py           # 21 unittest cases (cleaner + importer + bulk-import route)
```

## Adding a route module

```python
# app/routes_synonyms.py
from fastapi import APIRouter
router = APIRouter()
@router.get("/synonyms/{term_id}") ...

# app/main.py
from .routes_synonyms import router as synonyms_router
app.include_router(synonyms_router)
```

## Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/healthz` | liveness | — |
| POST | `/terms` | submit a term (lands as `pending`) | reviewer / engineer / admin |
| GET | `/terms` | list w/ filters (`status`, `category`, `q`, `limit`, `offset`) | any authenticated |
| GET | `/terms/{id}` | fetch one | any authenticated |
| PATCH | `/terms/{id}` | moderate (status / category / definition / notes) | admin |
| POST | `/occurrences` | record `(term, audio_file, correct?)` | service-internal |
| GET | `/occurrences/stats?kind={top_wrong\|trending}` | aggregations for the admin UI | any authenticated |
| GET | `/dictionary/snapshot` | bulk approved-list + version stamp (manifest-time consumers) | service-internal |
| POST | `/terms/bulk-import` | re-run the CSV importer (or import a different file by `csv_path`) | admin |

Auth pattern: trust `X-User-Id` / `X-User-Role` headers from the FE proxy on the internal compose network. Same convention as `meeting_webhooks` and `training_orchestrator`.

## Roles

- **Submitter roles** (`reviewer`, `engineer`, `admin`) can `POST /terms`.
- **Moderator roles** (`admin` only) can `PATCH /terms/{id}`.
- All authenticated users can read terms + stats + snapshot.

Submissions land as `status='pending'` regardless of submitter role. Admins flip them to `approved` / `rejected` via PATCH.

## Term status lifecycle

```
   ┌─────────┐                ┌──────────┐
   │ pending │─── approve ───▶│ approved │
   └─────────┘                └────┬─────┘
        │                          │
        │ reject                   │ retire
        ▼                          ▼
   ┌──────────┐               ┌─────────┐
   │ rejected │               │ retired │
   └──────────┘               └─────────┘
```

Soft-delete only — rows are never `DROP`ped, so the audit trail and old `evaluation_metric` references survive. The `dictionary_snapshot` endpoint filters to `approved` only; retired terms drop out automatically.

## Snapshot semantics

`GET /dictionary/snapshot` returns:

```json
{
  "version": "2026-04-28T11:14:33",
  "term_count": 4217,
  "terms": [
    { "id": 1, "term": "EBITDA", "term_normalized": "ebitda", "category": null, "definition": null },
    ...
  ]
}
```

`version` is the most-recent `approved_at` across approved rows. Eval manifests record this so reruns are reproducible — same version, same critical-term set, same metric value. Empty approved set returns `version: null`.

## Env vars (set in `backend/.env` or compose)

```
PORT=8009
DB_PATH=/app/data/financial_terms.db
SEED_CSV_PATH=/app/financialTerms.csv
SEED_ON_BOOT=true   # slice 2 reads this on first boot of an empty DB
```

## Local dev

```bash
docker compose up financial-terms-dictionary
# or, ad-hoc, from this folder:
pip install -r requirements.txt
PORT=8009 DB_PATH=$(pwd)/.data/financial_terms.db \
  python -m uvicorn app.main:app --reload --port 8009
```

## Tests

```bash
cd backend/Financial_terms_dictionary
python -m unittest discover -s tests
```

26 stdlib `unittest` cases covering: schema idempotency, term dedupe on `term_normalized` (case + whitespace), moderation lifecycle (pending → approved stamps approver + timestamp; retire keeps original approver), filter combinations on `list_terms`, occurrence dedupe on `(term, file)`, `top_wrong` ranking + perfect-term exclusion, `trending` aggregation, snapshot only-approved + retired-drops-out + null-version-on-empty, plus HTTP role-gate cases for submitter / moderator separation, `/healthz`, `/terms/{id}` 404, `/occurrences` 404 on unknown term, `/dictionary/snapshot` round-trip.

## What still has to happen

All five slices shipped on this branch. The dictionary workstream is **end-to-end functional** — submission, moderation, snapshot, auto-trail, the metric strategy, and the eval-manifest stamping helpers are all in place.

The remaining work belongs to the broader §3.1 metrics push, not this workstream:

1. **Eval-manifest writer** — today's `dataset_builder.py` produces *training* manifests only. The eval-manifest writer (which would call `eval_manifest_helpers.fetch_dictionary_snapshot()` + `stamp_critical_terms()` per row) doesn't exist yet. When it lands, the loop closes from `POST /evaluations/run` straight through to the dashboard.
2. **Multi-word matching in slice 5's auto-trail.** Currently uses simple normalised exact-token lookup (single-word matches only). The contiguous-subsequence algorithm from `eval_manifest_helpers._phrase_in_tokens` can move into `frontend/src/server/financial-terms-cache.js` if multi-word match rate becomes a real signal in the auto-trail data.

## Production hardening (after slice 1-5)

- **Auth between FE and this service:** today we trust `X-User-Id` headers. Replace with mTLS or a shared service-secret in prod (matches the F1 "authenticate the database service" thread in the security triage).
- **CSRF token validation:** the FE proxy already adds `X-CSRF-Token` per F8; this service doesn't currently verify it (the proxy verifies, then forwards). Add belt-and-braces verification if this service ever becomes externally reachable.
- **Term scrub on retire:** if PDPA compliance ever requires a hard delete (e.g. someone submitted a personal name as a "term"), add `DELETE /terms/{id}/scrub` that nulls the term text but keeps the row id for audit-trail integrity.
- **Snapshot caching at the FE:** the dictionary doesn't change per request; metrics-service and the manifest builder can cache it for ~5 minutes safely.
- **Postgres cutover:** SQLite is fine for ≤100K rows; if the dictionary ever grows past that or wants concurrent writers, this gets folded into the F16 SQLite→Postgres workstream.
