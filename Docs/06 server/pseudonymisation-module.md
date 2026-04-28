# Pseudonymisation Module — Implementation Plan

## Overview

Backend module that runs a Named-Entity Recognition pass on transcripts at
submission time, masks detected PII with typed placeholders, and gates the
reviewer's approval on per-span sign-off. Designed to plug into the
existing status lifecycle
(`transcribing → transcribed → in review → completed | needs action`) and
the Alt+G manual-mask convention already exposed in the transcript editor.

Model: [`urchade/gliner_medium-v2.1`](https://huggingface.co/urchade/gliner_medium-v2.1)
served inside the on-premise enclave. No transcript text ever leaves the
enclave.

---

## 1. Placement in the pipeline

A new intermediate status `pseudonymising` slots between `transcribed` and
`in review`:

```
transcribing → transcribed → pseudonymising → in review → completed
                                ↓                  ↓
                          (auto-retry)       needs action → in review
```

Why intermediate:
- gliner inference takes 1–5s per transcript; submit button should return
  immediately without blocking the UI.
- Reviewers must not see a file in their queue until masking has completed
  — otherwise they could audit un-masked text.
- Distinct status gives the submitter a clear "still processing" state.

Update `lib/statusFlow.js` `VALID_TRANSITIONS`:

```js
'transcribed':     ['pseudonymising'],
'pseudonymising':  ['in review', 'needs action'],   // needs action on failure
'in review':       ['completed', 'needs action'],
```

## 2. Module boundary

New backend service: `services/pseudonymisation/`. Owns:

- Inference client (thin wrapper over the gliner service)
- Masking policy (entity → placeholder rules)
- Persistence (spans + decisions)
- Hooks into the submission endpoint

Submission endpoint calls `pseudonymise_transcript(transcript_id)` and
returns. Everything else is internal.

## 3. gliner service — separate enclave dependency

gliner is a **separate enclave service** from day one, even while it's
running on a laptop in dev. The submission service talks to it over HTTP.

### Interface

```
POST http://gliner-service/pseudonymise
  headers: { X-Austin-Internal: <shared-secret> }     # mTLS in prod
  body:    { segments: [{id, text, lang?}], labels: [...], thresholds: {...} }
  returns: { runId, spans: [{segmentId, start, end, text, label, score}] }
```

Single endpoint. HTTP/JSON (not gRPC) — simpler stubs, easier to replay
from the audit trail.

### Dev setup (laptop)

Separate Python process alongside the main backend:

```bash
uvicorn gliner_service:app --host 127.0.0.1 --port 9001
```

Main backend config: `GLINER_URL=http://localhost:9001`.

When moving to the real enclave, only the env var changes — the code path
stays identical.

### Enclave setup (prod)

- Dedicated service in the same enclave network, no public ingress.
- mTLS between submission service and gliner service.
- gliner process loads the model at boot and logs a `ready` line before
  accepting requests (cold load is ~20s; don't put that on the critical
  path).
- The `labels` array is sent on every request, not baked into the service
  image. This makes `label_set_version` on the run record meaningful — you
  can evolve the taxonomy without a redeploy.

### Failure contract

- 4xx: bad input (unsupported language, empty text). Flag immediately for
  admin review — these indicate schema drift.
- 5xx: model/GPU failure. Retry with exponential back-off (3 attempts).
  After final failure, transition to status `pseudonymising_failed` and
  surface in an admin-only retry queue.
- Main backend **never** calls HuggingFace directly. This invariant holds
  from laptop to production.

## 4. Entity taxonomy

Labels passed to gliner at inference time, pinned to a versioned label set
(`banking-v3`):

| Entity                           | Threshold |
|----------------------------------|-----------|
| person name                      | 0.6       |
| phone number                     | 0.5       |
| email address                    | 0.5       |
| bank account id                  | 0.45      |
| customer reference id            | 0.45      |
| trading account id               | 0.45      |
| address                          | 0.55      |
| date of birth                    | 0.6       |
| national id                      | 0.5       |
| passport number                  | 0.5       |
| monetary amount tied to individual | 0.55    |
| internal project codename        | 0.65      |

Thresholds per label rather than global — account ids have distinctive
patterns so a lower threshold is safer; project codenames are common English
words and need a higher bar to avoid false positives.

Segment-level batching: one call per transcript segment keeps speakers
scoped.

## 5. Masking policy

### Placeholder format

Matches the convention already on the privacy page: `[MASKED_NAME_01]`,
`[BANK_ID_02]`, `[PHONE_01]`. Monotonic counter per entity type per run —
a recurring entity (same customer mentioned three times) gets the **same**
token. This is load-bearing for downstream training: the model learns
that `[MASKED_NAME_01]` is stable within a transcript.

### Merge with manual Alt+G masks

The transcript editor already inserts raw `[MASK]` for user-selected words
(`files/[id]/page.jsx:1904`). When the pseudonymiser runs:

1. Tokenise the submitted text, keeping existing `[MASK]` and any typed
   `[MASKED_*_NN]` as pre-masked regions.
2. Run gliner on the remaining un-masked spans only.
3. Merge results: any gliner span that overlaps a manual mask is skipped
   (user intent wins).
4. Any leftover manual `[MASK]` gets upgraded in-place — the pseudonymiser
   infers the entity type from segment context and replaces `[MASK]` with
   `[MASKED_<TYPE>_NN]`.

### Overlap handling

When gliner returns overlapping spans (e.g. "Jonathan V. Sterling" as a
full name, "V." as an initial), pick longest-first and discard enclosed
overlaps.

### Known-entity fast path (Phase 3)

Before gliner runs, do a deterministic pass against the client roster for
the submitter's user-group. Known PII doesn't need ML detection — faster
and more reliable for known-known cases. gliner then picks up the unknowns.

## 6. Actor attribution

All model-driven masking (gliner detections) and upgraded Alt+G masks
attribute to a shell `system` persona (`AUSTIN System`). This matches the
existing audit trail's `SYSTEM_ACTOR`. `source: 'manual'` on the span
record is reserved for when we later want per-author attribution.

## 7. Data model

Two new tables:

```sql
pseudonymisation_runs (
  id                    uuid primary key,
  transcript_id         uuid not null references transcripts(id),
  model_version         text not null,        -- 'gliner_medium-v2.1'
  label_set_version     text not null,        -- 'banking-v3'
  started_at            timestamptz not null,
  completed_at          timestamptz,
  status                text not null,        -- queued | running | done | failed
  actor_id              text not null,        -- 'system'
  attempts              int not null default 1,
  error_code            text,
  error_message         text
);

pseudonymisation_spans (
  id                    uuid primary key,
  run_id                uuid not null references pseudonymisation_runs(id),
  segment_id            uuid not null,
  start_char            int not null,
  end_char              int not null,
  original_text         bytea not null,       -- encrypted at rest
  entity_type           text not null,
  placeholder           text not null,
  confidence            real not null,
  source                text not null,        -- 'model' | 'manual'
  decision              text,                 -- null | accepted | rejected
  reviewer_id           text,
  reviewer_decided_at   timestamptz,
  reviewer_note         text
);
```

### Retention

- **Raw ASR transcript**: kept forever. Source of truth.
- **`pseudonymisation_spans.original_text`**: kept forever. Useful for
  re-running the model, reviewer context, audit trail. No tombstoning.
- Both encrypted at rest; decryption key accessible to reviewer + admin
  roles only. Submitters only see the masked version via API.

Matches the "append-only immutable ledger" line already on the audit
footer.

### Why this shape

- **Reviewer can see and override** — per-span `decision` supports partial
  acceptance. A rejected span means "un-mask this, false positive."
- **Re-runnable** — if gliner is upgraded, re-run against transcripts with
  stale `label_set_version` and diff the results without losing history.

## 8. API surface

```
POST /transcripts/:id/submit-for-review
  → enqueues pseudonymisation job
  → transitions status to 'pseudonymising'
  → returns { run_id, status: 'pseudonymising' }

GET /transcripts/:id/pseudonymisation
  → returns latest run:
    {
      run_id, status, model_version, label_set_version,
      started_at, completed_at, attempts, error,
      spans: [
        { span_id, segment_id, start_char, end_char,
          original_text,                 # only if caller.role in [reviewer, admin]
          entity_type, placeholder, confidence,
          source, decision, reviewer_id, reviewer_decided_at, reviewer_note }
      ]
    }

POST /transcripts/:id/pseudonymisation/spans/:span_id/decision
  → body: { decision: 'accepted' | 'rejected', note? }
  → reviewer-only
  → mutates reviewer_decision, reviewer_id, reviewer_decided_at

POST /transcripts/:id/approve
  → reviewer-only
  → guard: run.status == 'done' AND every span has a non-null decision
  → transitions transcript status to 'completed'

POST /transcripts/:id/request-changes
  → reviewer-only
  → transitions transcript status to 'needs action'
  → optionally includes spans the reviewer flagged as insufficient masking
```

The `approve` guard is load-bearing: it enforces "every detected span has
been reviewed" before compliance sign-off.

## 9. Async processing

Use an existing job queue (Celery / RQ / whatever transcription already
uses). Worker flow:

1. Load transcript text + existing manual masks.
2. Call gliner service with custom labels + thresholds.
3. Merge results, apply overlap resolution, run known-entity fast path.
4. Write `pseudonymisation_spans` in a single transaction.
5. Transition status to `in review`.
6. Fire `addReviewActionNotification(reviewerId, 'pseudonymisation_done')`.

Retry policy: 3 attempts with exponential back-off (1s, 4s, 16s). On final
failure → status `pseudonymising_failed`, admin retry queue.

## 10. Reviewer UI contract

The frontend file detail page already has a side panel pattern. Backend
returns the shape described in §8. Reviewer clicks a span to see original
vs. placeholder, then marks accepted/rejected. The existing
`buildDiffView` helper can be adapted for side-by-side rendering.

## 11. Audit integration

Every span decision emits an event that the existing audit trail picks up:

- `action: 'pseudonymised'` on run completion, detail
  `{ spansMasked: N, modelVersion }`
- `action: 'privacy_flagged'` on each span rejected as insufficient
- Existing `access_granted` / `approved` actions keep their meaning

These already render in `/files/<id>/audit` so no frontend changes are
needed for the log view.

## 12. Edge cases

- **Overlapping spans**: longest-first, discard enclosed.
- **CJK text**: gliner handles multilingual but needs threshold tuning on
  `mixed` (Cantonese+English code-switch). Validate before rollout.
- **Known-entity fast path**: deterministic pass against client roster for
  the submitter's user-group before gliner. Reduces false positives.
- **Round-trip through needs-action**: if reviewer requests changes and
  author edits again, preserve accepted spans. Only re-run on segments
  whose text actually changed.

## 13. Phased rollout

1. **Shadow mode.** Pseudonymiser runs on every submission but spans are
   auto-accepted; no status change. Collect data to tune thresholds.
2. **Reviewer loop.** Introduce `pseudonymising` status + reviewer decision
   UI. Gate `approve` on span decisions.
3. **Known-entity fast path.** Client roster pre-scan. Measure
   false-positive drop.
4. **Model upgrade pipeline.** Enable re-runs on stale `label_set_version`,
   diff tooling for high-severity deltas.

---

## Appendix A — Mock data

Frontend mock at `frontend/src/services/mock_data-pseudonymisation.js`
exports the shape the backend should eventually produce. Pinned test
fixtures:

| File                        | Status             | Scenario                                  |
|-----------------------------|--------------------|-------------------------------------------|
| `root-spgispeech-0007`      | `done`             | All spans accepted — reviewer demo fixture |
| `root-spgispeech-0012`      | `pseudonymising`   | Mid-flight, spans empty                   |
| `root-spgispeech-0019`      | `done`             | One rejected span + reviewer un-mask note |
| `root-spgispeech-0024`      | `failed`           | 3× gliner 5xx, sitting in admin retry queue |

When the real backend lands, `GET /transcripts/:id/pseudonymisation`
should return the same shape so frontend wiring doesn't need to distinguish
mock vs. real.

## Appendix B — Open items

- Retention on the key used to encrypt `original_text` — key rotation
  strategy needs a call with security.
- Whether Alt+G manual-mask author attribution surfaces in v2 (currently
  rolled up under `system`).
- Known-entity roster source — does it come from `MOCK_CLIENTS` (via
  mock_data-users.js today) or a dedicated client-PII registry?
