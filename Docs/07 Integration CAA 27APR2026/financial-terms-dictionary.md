# Financial Terms Dictionary — Design

_Last updated: 2026-04-28 (branch `ui_enhancement`)_

Pre-build spec for a user-curated financial terms dictionary. Reviewers add/flag terms while editing transcripts; ML engineers query the dictionary for training + evaluation; the metrics service's `financial_term_accuracy` strategy draws on the approved list. Today the data lives as a 6,318-row CSV at `backend/Financial_terms_dictionary/financialTerms.csv`; this doc replaces that with a SQLite-backed microservice.

Sibling reading:
- [`backend_integration_status.md`](backend_integration_status.md) — broader integration surface this slots into.
- [`../06 server/metrics-service-module.md`](../06%20server/metrics-service-module.md) — where `financial_term_accuracy` lives.
- [`audio-to-edit-pipeline.md`](audio-to-edit-pipeline.md) — the transcript-edit save path that will gain a "submit term" affordance.

---

## 1. Goals & non-goals

### Goals

1. **One canonical, queryable list** of financial terms shared across the platform. ML engineers, the metrics service, and (eventually) the pseudonymisation allowlist all read from the same store.
2. **User-curated.** Reviewers editing transcripts can submit a term in one click — either explicitly via "Add to dictionary" or implicitly by correcting a word the model got wrong. New entries land as `pending` and an admin moderates.
3. **Auditable.** Every entry records who submitted it, when, and which transcript surfaced it. Every approval records the moderator. Soft-delete (`status='retired'`) replaces hard delete so the audit trail survives.
4. **Drives the `financial_term_accuracy` metric.** Eval-manifest builder pulls the approved list at build-time and stamps it on each `Sample` so the metric can compute "how many critical terms did the model get right" deterministically.
5. **Operational learning loop.** When the model gets a term wrong (reviewer corrects it during transcript editing), the dictionary records that occurrence. Admins see "top wrong terms" — direct feedback on what training data the model needs.

### Non-goals

- Not a multi-language synonym graph. v1 treats `"EBITDA"` and `"Earnings Before Interest, Taxes, Depreciation and Amortization"` as separate entries; merging them is a v2 concern.
- Not a hierarchical taxonomy. A flat list with a free-form `category` column is enough to start; no SNOMED-style parent/child.
- Not a glossary. We don't maintain prose definitions — `definition` is an optional URL pointing at an authoritative source (Investopedia, Loughran-McDonald, etc.).
- Not real-time collaborative editing. Submissions are individual; moderation is a queue, not a chat.
- Not crypto-versioned. Append-only audit on the occurrence ledger is sufficient; tamper-evident hash chaining is over-engineering for this domain.

---

## 2. The integration shape

```
┌── Reviewer editing /files/[id] ─────────────────────────────────┐
│  Word edit popover ── "💼 Add to dictionary" ──┐                 │
│  (auto-trail when correcting + dictionary hit) │                 │
└─────────────────────────────────────────────────│────────────────┘
                                                  │ POST /api/financial-terms
                                                  ▼
┌── frontend (Next.js) ────────────────────────────────────────────┐
│  src/app/api/financial-terms/route.js   (+ [id], /admin, /moderate)│
└──────────────────────────────────────────│───────────────────────┘
                                            │ X-User-Id, X-User-Role
                                            ▼
┌── backend/Financial_terms_dictionary (NEW microservice :8009) ───┐
│   POST /terms          ── pending submission                     │
│   GET  /terms          ── list w/ filters                        │
│   PATCH /terms/{id}    ── moderate (admin only)                  │
│   POST /occurrences    ── append-only ledger                     │
│   GET  /dictionary/snapshot ── bulk approved-list (manifest-time) │
│   GET  /occurrences/stats   ── trending / top-wrong reports      │
│                                                                  │
│   SQLite: financial_terms.db                                     │
│     financial_term, financial_term_occurrence                    │
└──────────────────────────────────────────────────────────────────┘
                                            ▲
                                            │ snapshot at manifest-build
                                            │
┌── retraining-pipeline / dataset_builder.py ─────────────────────┐
│  Stamps Sample.tags["critical_terms"] = [...]                   │
└──────────────────────────────────────────│───────────────────────┘
                                            ▼
┌── metrics-service:8006 ─────────────────────────────────────────┐
│   strategies/financial_term_accuracy.py                         │
│   Reads pre-stamped tags, scores per sample, macro-averages.    │
└──────────────────────────────────────────────────────────────────┘
```

**Why a microservice, not Next.js routes:** the dictionary has **two non-FE consumers** — `metrics-service` reads it at eval-manifest build time, `retraining-pipeline` reads it when packaging training data. A sibling Python service is the right call (same pattern as `pseudonymisation-orchestrator`). If the dictionary lived in `platform.db` only, those callers would either need a FE proxy or duplicate the read logic. SQLite microservice + thin HTTP API is one place to maintain it.

---

## 3. Why a DB, not the CSV

A CSV survives reads. It does not survive **concurrent writes** (two reviewers submitting at the same time will race through any flock-based scheme), carries no metadata (who added what, when, was it approved?), can't model a moderation workflow, and doesn't support the "where has this term appeared" queries the occurrence ledger needs. Every issue compounds with scale.

Spot-check of the existing CSV (6,318 rows): a non-trivial fraction are not actually terms — row 4 is `"10-K Wrap: What It Is, How It Works, Elements"` (an Investopedia article title, not a term). Importing this verbatim populates the dictionary with noise. The DB import path needs cleaning + a `pending` quarantine for likely-bad rows.

**Choice: SQLite, sibling pattern to `meeting_webhooks` and `training_orchestrator`.** Migrates to Postgres in Wave 4 along with everything else (F16) — no special-case decision today.

---

## 4. How others maintain controlled vocabularies — research summary

What we considered, what we're stealing, what we're explicitly skipping:

| Approach | Example | Fit for us |
|---|---|---|
| Heavyweight curation w/ versioning + hierarchy | MeSH (medical), SNOMED CT (clinical) | Overkill. Quarterly releases, parent/child relations, formal review boards. Skip. |
| Crowdsourced + curated, revisions table | Wiktionary, Wikidata | Right idea (open submission, moderation backbone) at the wrong scale (wiki engine, banned editors). Steal: pending-queue + soft-delete + submitter attribution. |
| Static public lists | Loughran-McDonald financial dict, FinBERT vocab | Right starting point — seed from these. They're maintained by domain experts and refreshed every few years. |
| Per-organisation custom dictionaries | Google Cloud Speech `phrase hints`, Azure Speech `custom phrase lists` | Same shape as ours: flat list of strings + optional weight, queryable as a snapshot. Steal: snapshot-at-eval-time pattern. |

**What this means for us:**
1. **Seed from a static public source.** The CSV in-repo today looks Investopedia-derived; treat it as a one-off seed and bulk-import with cleaning. After v1 lands, the DB is authoritative; the CSV stays as the CI-reproducible starting state.
2. **Open submission, gated moderation.** Anyone with reviewer/engineer role can submit (lands `pending`); admins approve. Matches the existing role gates on transcript edits.
3. **Soft-delete, not hard-delete.** `status='retired'` keeps the audit trail. The metric only ever sees `status='approved'`.
4. **Define-by-link, not define-by-prose.** Optional `definition` column carries a URL (Investopedia, SEC filing, internal wiki). Don't try to maintain prose definitions ourselves — that's where every glossary project goes to die.
5. **Append-only occurrence ledger** for "where has this term appeared and did the model get it right." Drives both the metric (eval-time, against the approved list) and the operational dashboard ("top wrong terms" — direct training-priority signal).
6. **Skip:** synonym/acronym graph, hierarchical categories, multi-language, prose definitions, hash-chained tamper evidence. All v2+ if they ever matter.

---

## 5. Schema

```sql
CREATE TABLE financial_term (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    term            TEXT NOT NULL,                      -- canonical form, e.g. "EBITDA"
    term_normalized TEXT NOT NULL,                      -- lower(term), trimmed; for dedupe
    category        TEXT,                               -- 'ratio' | 'instrument' | 'regulation' | …
    definition      TEXT,                               -- usually a URL, optional
    status          TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','retired')),
    submitted_by    TEXT,                               -- users.db user.id; NULL for seed
    submitted_at    TEXT NOT NULL DEFAULT (datetime('now')),
    approved_by     TEXT,                               -- users.db user.id; NULL until approved
    approved_at     TEXT,
    source_file_id  TEXT,                               -- audio_file.external_id when surfaced from a transcript
    notes           TEXT,                               -- free-form moderator note
    UNIQUE(term_normalized)
);
CREATE INDEX ix_financial_term_status   ON financial_term(status);
CREATE INDEX ix_financial_term_category ON financial_term(category);

-- Append-only ledger: each row records "term X appeared in transcript Y,
-- and the model got it right (1) / wrong (0)". Drives the
-- financial_term_accuracy metric AND the "top wrong terms" admin view.
CREATE TABLE financial_term_occurrence (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    term_id                INTEGER NOT NULL REFERENCES financial_term(id) ON DELETE CASCADE,
    audio_file_external_id TEXT NOT NULL,
    appeared_at            TEXT NOT NULL DEFAULT (datetime('now')),
    correctly_transcribed  INTEGER NOT NULL CHECK (correctly_transcribed IN (0,1)),
    UNIQUE(term_id, audio_file_external_id)
);
CREATE INDEX ix_term_occurrence_file ON financial_term_occurrence(audio_file_external_id);
CREATE INDEX ix_term_occurrence_term ON financial_term_occurrence(term_id);
```

Two tables, deliberate split: `financial_term` is editable state (status flips through the moderation lifecycle); `financial_term_occurrence` is append-only audit. No history table needed in v1 — the FE-side `audit_event` log already records who pressed approve/reject.

**Why `term_normalized` is unique, not `term`:** prevents `"EBITDA"`, `" EBITDA "`, `"ebitda"` from creating three entries. Display always uses `term` (preserves casing); dedupe + lookup always uses `term_normalized`.

**Why `status='retired'` instead of DELETE:** an approved term that gets retired must not silently vanish from old audit trails or eval results. The metric filters on `status='approved'` so retired terms drop out automatically; rows persist for audit.

---

## 6. Microservice — `backend/Financial_terms_dictionary/`

Same FastAPI/SQLite pattern as `meeting_webhooks` (port 8007) and `training_orchestrator` (port 8008). **Propose port 8009.**

### 6.1 Module layout

```
backend/Financial_terms_dictionary/
├── financialTerms.csv          # existing seed CSV (6318 rows; stays in-repo)
├── app/
│   ├── main.py                 # FastAPI bootstrap
│   ├── config.py               # pydantic-settings env reader
│   ├── db.py                   # SQLite open + helpers + idempotent schema init
│   ├── schema.sql              # DDL (the §5 tables)
│   ├── models.py               # pydantic request/response shapes
│   ├── routes_terms.py         # /terms CRUD + moderation
│   ├── routes_occurrences.py   # /occurrences ledger + stats
│   ├── routes_admin.py         # /terms/bulk-import (CSV ingest)
│   ├── matching.py             # tokenise + phrase-match algorithm
│   └── seed.py                 # CSV → DB importer with cleaning heuristics
├── tests/
│   ├── test_routes_terms.py
│   ├── test_matching.py
│   └── test_seed_cleaning.py
├── Dockerfile
├── requirements.txt
└── README.md
```

### 6.2 Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/healthz` | liveness | — |
| POST | `/terms` | submit a term (lands as `pending`) | reviewer / engineer / admin |
| GET | `/terms` | list w/ filters (`status`, `category`, `q` substring, `limit`, `offset`) | any authenticated |
| GET | `/terms/{id}` | fetch one | any authenticated |
| PATCH | `/terms/{id}` | moderate (approve / reject / retire / edit category / edit definition) | admin |
| POST | `/terms/bulk-import` | run the CSV cleaner + importer (admin utility) | admin |
| POST | `/occurrences` | record `(term, audio_file, correct?)` | service-internal (FE save path) |
| GET | `/occurrences/stats` | aggregations (`trending`, `top_wrong`, per-file) | any authenticated |
| GET | `/dictionary/snapshot` | bulk approved-terms list + `version` (latest `approved_at`) | service-internal (metrics + retraining-pipeline) |

Auth pattern matches `meeting_webhooks` and the training orchestrator: trust `X-User-Id` / `X-User-Role` headers from the FE proxy on the internal compose network. Harden when ops splits the network.

### 6.3 Snapshot semantics

`GET /dictionary/snapshot` returns `{ version, terms: [{ id, term, category }, ...] }` where `version` is the most recent `approved_at` timestamp across all approved terms. The eval-manifest builder records this version on each manifest so reruns are reproducible — same version, same critical-term set, same metric value.

---

## 7. Frontend integration

> **Doc correction (2026-04-28).** An earlier version of this section described attaching the affordance to a "per-word edit popover." That popover doesn't exist — the real editor at `/files/[id]/page.jsx:1875` is segment-level `contentEditable`: a click makes the entire segment editable, the user types corrections inline, and `updateText` diffs the result against the original. There's nothing per-word to attach a button to. The corrected design uses **selection-based floating buttons** instead.

### 7.1 Inline submission during transcript editing

Wired into `/files/[id]/page.jsx`, two paths — one explicit (UI), one implicit (instrumentation).

**(a) Explicit — selection-based floating button.** When the user highlights a word or phrase anywhere in the transcript (works in view *and* edit modes), a small floating "💼 Add to financial dictionary" button appears near the selection. Click → small modal pre-fills the term, asks for an optional category, asks "was the model correct?" (default: yes — selecting a term you can read clearly means it transcribed fine), Save. Same UX shape as Google Docs / Notion selection toolbars — discoverable, matches reading flow, doesn't clutter the editor when nothing is selected.

Why selection-based, not per-word or context-menu:
- Selection works in both view and edit modes. Per-word affordances only fire while editing. A reviewer skim-reading a finished transcript can still flag a term.
- Selection scopes naturally to multi-word terms (`"earnings per share"`, `"S&P 500"`). Per-word would require Shift-click semantics or similar.
- The browser's native selection event fires for free; conditional rendering ("only show the button when selection is plausibly a term: 1-5 words, no sentence-internal punctuation") keeps it from being visual noise.

Two alternative shapes considered and rejected for slice 1:
- **Right-click context menu on a word.** Cheaper but less discoverable; also word-scoped, doesn't handle multi-word terms cleanly.
- **Save-time review modal** ("you corrected these words — tick any that should go in the dictionary"). High-friction at the save moment; better as a v2 power-user mode if the inline button proves clutter-y.

The button POSTs to `/api/financial-terms` (FE proxy → microservice) which lands the term as `status='pending'` and creates an `occurrence` row simultaneously. Both writes fail-quiet — a dictionary outage doesn't break transcript editing.

**(b) Implicit auto-trail.** Independent of the explicit button. After `writeEditsForFile` commits the SQLite tx (in slice 1 of the cache-invalidation hooks per `redis-cache-integration.md` §4.1), the FE save path looks up each edit's `before` text against the dictionary's approved-terms snapshot (cached client-side for ~5 min). If `before` matches an approved term, the path POSTs `/occurrences` with `correctly_transcribed=0` — the model got this term wrong, the reviewer fixed it. Zero UI, zero friction, captures the volume signal that drives the **top wrong terms** admin view.

The two paths produce different signals: the explicit button captures *intent* ("admins, please consider this term"), the auto-trail captures *behaviour* ("the model is making mistakes here"). Both feed the same admin moderation surface.

### 7.2 Modal shape for the explicit path

```
┌── Add to financial dictionary ─────────────────────────┐
│                                                        │
│  Term            [ EBITDA                          ]   │
│                                                        │
│  Category        [ ratio          ▾ ] (optional)       │
│                                                        │
│  Source          ✓ This transcript (auto-filled)       │
│                                                        │
│  Did the model    ◉ Yes, it got this right             │
│  transcribe it    ○ No, I'm correcting it              │
│  correctly?                                            │
│                                                        │
│  Note            [ optional, for admins        ]       │
│                                                        │
│  [Cancel]                              [💼 Submit]     │
└────────────────────────────────────────────────────────┘
```

Pre-fills:
- `Term` — the user's selection, trimmed.
- `Category` — null; admin can set during moderation.
- `Source` — the current `audio_file.external_id`, locked.
- `Did the model transcribe it correctly?` — defaults to "yes" because if the user is selecting clean text, that's usually true. Flipping to "no" creates an `occurrence` with `correctly_transcribed=0` immediately, which is what the auto-trail would have done anyway — explicit is strictly more informative than implicit.

Submission: `POST /api/financial-terms` with the term + category + note; on success, `POST /api/financial-terms/occurrences` with the term_id + audio_file_external_id + was_correct. One round-trip pair, both fail-quiet.

### 7.2 Admin moderation page

New route `/admin/financial-terms`, role-gated to admin via the existing `requireOwnerOrRole` helper.

Three tabs:
- **Pending queue** (oldest first) — approve / reject / edit-category bulk actions, source transcript link if `source_file_id` is set.
- **Approved list** — sortable by `submitted_at`, `approved_at`, or "occurrences in the last 30 days" (joined query against `financial_term_occurrence`). Search + filter by category.
- **Top wrong terms** — `correctly_transcribed=0` aggregated by term, descending count. **This is the genuinely valuable surface** for the engineering team: direct, real-world feedback on what training data the model needs more of. Click a term → list of files where it appeared wrong → click into transcript.

### 7.3 Cross-cuts to existing UI

- **Files list** can show a small "✓ N terms" badge per row (count of approved-term occurrences in this transcript) — defer to v2.
- **Pseudonymisation panel** — a financial term that's *also* a person's name (rare but happens — `"Dow"` is both an index and a surname) needs to interact with the redaction allowlist. Out of scope for v1; flagged as a v2 concern.

---

## 8. Metrics integration — `financial_term_accuracy`

### 8.1 The strategy

```python
@register_strategy
class FinancialTermAccuracy(MetricStrategy):
    """Fraction of approved financial terms in the reference that also
    appear correctly in the hypothesis. Macro-averaged across samples
    that contain at least one term; samples with no terms contribute
    nothing (excluded from the denominator, not scored 1.0)."""

    name = "financial_term_accuracy"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        scores, total_terms_seen, total_correct = [], 0, 0
        for sample in samples:
            terms = sample.tags.get("critical_terms") or []
            if not terms:
                continue
            correct = sum(1 for t in terms if _phrase_in(t, sample.hypothesis))
            scores.append(correct / len(terms))
            total_terms_seen += len(terms)
            total_correct += correct
        n = len(scores)
        if n == 0:
            return StrategyResult(strategy_name=self.name, value=0.0)
        return StrategyResult(
            strategy_name=self.name,
            value=sum(scores) / n,                       # macro-average
            breakdown={
                "terms_seen": float(total_terms_seen),
                "terms_correct": float(total_correct),
                "samples_with_terms": float(n),
            },
            sample_count=n,
        )
```

### 8.2 Pre-stamping at manifest-build time

`backend/retraining-pipeline/dataset_builder.py` (when it materialises the eval manifest) adds one HTTP call to `GET /dictionary/snapshot`, then per sample computes `terms_in_reference = approved_terms ∩ tokenise(reference)` and writes `tags.critical_terms = [...]` into the JSONL row.

```jsonl
{"audio_path": "data/eval/clip_001.wav", "reference": "EBITDA up 12 percent in Q1", "hypothesis": "earnings up 12 percent in cuban", "tags": {"critical_terms": ["EBITDA", "Q1"], "dictionary_version": "2026-04-28T10:14:33Z"}}
```

**Why pre-stamp instead of look up at compute time:**
- Eval reproducibility — re-running the metric a month later gives the same number even if the dictionary has grown.
- Decouples the metrics service from the dictionary service.
- One snapshot HTTP call per eval run, not one per sample.

The `dictionary_version` field captures *which* snapshot was used, so the audit trail is intact.

### 8.3 Two distinct data flows

The dictionary feeds **two non-overlapping pipelines**:

| Flow | Trigger | Writes | Reads |
|---|---|---|---|
| **Eval-time metric** | post-train hook → `/evaluations/run` | nothing | `/dictionary/snapshot` once per run |
| **Operational learning loop** | reviewer correcting transcript at `/files/[id]` | `/occurrences` (was_correct=0) | nothing during the edit |

The metric uses the *curated* approved list against *eval datasets* (controlled). The operational loop captures *real-world* errors and surfaces them in the admin panel for prioritisation. Different inputs, different outputs, both meaningful.

---

## 9. Term match algorithm

Naive `term in reference` substring match is wrong: `"EPS"` matches inside `"steps"`, `"PE"` matches inside `"perks"`, etc.

**Algorithm:**
1. Tokenise both reference and term using the existing `_text.tokenise_words()` from `metrics_service/strategies/_text.py` (whitespace + punctuation split, lowercase, NFKC normalise — the same normalisation `wer.py` uses).
2. For multi-word terms (`"earnings per share"`), look for the term tokens as a **contiguous subsequence** in the reference tokens.
3. Single-word terms become a contiguous subsequence of length 1 — same algorithm.
4. Acronyms with embedded punctuation (`"S&P"`, `"10-K"`) need the tokeniser to keep them whole. Augment `_text.tokenise_words` with an "atomic acronym" pass: if a token matches `^[A-Z][A-Z0-9&.-]+$` after lowercase-folding the original, keep it as one token.

This lives in `app/matching.py` of the dictionary service so it can be reused both by the eval pre-stamping pass and by the per-edit auto-trail at write time.

**Limitations to flag:**
- No fuzzy match. `"EBITDAs"` (plural) vs `"EBITDA"` won't match. v2: stem before matching.
- No context awareness. `"Apple"` the company vs `"apple"` the fruit are the same token here. Out of scope; the curated dictionary should use disambiguating context in the term itself (`"Apple Inc."`).

---

## 10. Slice breakdown

Five slices, independently mergeable. Slice 1 alone gives ML engineers something to query.

| # | Slice | What lands | Effort |
|---|-------|------------|--------|
| **1** | **Microservice scaffold** | `backend/Financial_terms_dictionary/` FastAPI app, `schema.sql`, `db.py`, `routes_terms.py` (CRUD + moderation), `routes_occurrences.py` (POST + stats), `/dictionary/snapshot`, `/healthz`. compose.yaml block on port 8009. README. | 0.5d |
| **2** | **CSV bulk-import + cleaning** | `app/seed.py` — heuristic cleaner that drops likely-noise rows (contains `"What It Is"`, `"How It Works"`, more than ~6 words for a non-quoted entry, suspicious colon position). Dedupes by `term_normalized`. Reports kept/dropped counts. POST `/terms/bulk-import` exposes it as an admin endpoint. Suspicious rows imported as `pending` for admin triage rather than dropped silently. | 0.5d |
| **3** | **FE proxy + admin UI** | `frontend/src/app/api/financial-terms/route.js` (+ `[id]`, `/occurrences`, `/admin/moderate`). New page `frontend/src/app/(dashboard)/admin/financial-terms/page.jsx` with three tabs (pending / approved / top-wrong). Inline "💼 Add to dictionary" affordance on the existing edit popover at `/files/[id]/page.jsx`. | 1d |
| **4** | **Metrics integration** | `metrics_service/strategies/financial_term_accuracy.py` + manifest-builder change in `retraining-pipeline/dataset_builder.py` to pre-stamp `tags.critical_terms`. The strategy is in slice 4 of the metrics outline (group D); this is the cross-service plumbing. | 0.5d |
| **5** | **Auto-trail occurrence write** | Hook into `frontend/src/server/audio-files.js::writeEditsForFile` after the SQLite tx commits — for each edit, look up `before` against `/dictionary/snapshot` (cached), POST `/occurrences` with `correctly_transcribed=0` if it matches. Fail-quiet. | 0.5d |

**Total: ~3 days.**

Slices 1–2 are pure backend (no FE work) and unblock ML engineers immediately. Slice 3 is FE-heavy. Slices 4–5 cross services and need slice 1's snapshot endpoint live.

---

## 11. Open questions / decisions deferred

1. **Categories.** Free-form column for v1 (per spot-check, the existing CSV doesn't have category data we could auto-cluster). After ~3 months of admin-tagged data we can propose a fixed enum. Don't pre-enumerate — guessing wrong is worse than waiting.

2. **CSV cleaning aggressiveness.** Import suspicious rows as `pending` rather than drop. Heuristics for "suspicious": contains `"What It Is"` / `"How It Works"` / `"Elements"` / `"Definition"`, more than 8 tokens for a non-acronym entry, contains `:` in a non-acronym position. Admin triages — they have UI for this in slice 3.

3. **Term submission auth.** Reviewers + engineers + admins can submit (lands `pending`). Generic users (whatever the catch-all role is) — read-only. Matches the existing role gates on transcript edits.

4. **Term match algorithm — see §9.** Phrase-as-contiguous-subsequence on tokenised + case-folded text, with atomic-acronym handling. Documented limitations: no stemming, no context awareness. v2 if needed.

5. **Synonyms / acronyms.** v1 treats `"EBITDA"` and `"Earnings Before Interest, Taxes, Depreciation and Amortization"` as separate entries. v2: add a `synonym_of` self-FK so admins can link them, and have `/dictionary/snapshot` expand each canonical entry into all surface forms.

6. **What does "model got it right" mean for the occurrence ledger?** Two paths, both wired:
   - **Implicit** — reviewer's edit `before` is in the dictionary. Auto-trail writes `correctly_transcribed=0`.
   - **Explicit** — reviewer ticks "💼 Add to dictionary" with a "was the model correct?" checkbox.
   The implicit path is zero-friction and high-volume; the explicit path is for when the model got the term right but the reviewer wants to add it anyway (it's a new term not yet in the dictionary).

7. **Microservice or FE-side?** Microservice. Two non-FE consumers (metrics service + retraining pipeline) make a sibling service the cleanest call. Same pattern as `pseudonymisation-orchestrator`, `meeting_webhooks`, `training_orchestrator`.

8. **Seeding the production DB.** Keep `financialTerms.csv` in-repo as the CI-reproducible starting state. Fresh containers re-seed from it via the lifespan hook (`SEED_ON_BOOT=true`, default). The DB is authoritative once seeded; the CSV is read-only.

9. **Cross-talk with pseudonymisation.** A financial term that's also a person's name (`"Dow"`, `"Sterling"`) intersects the redaction allowlist. v1 keeps the two systems decoupled. v2 might let admins flag a term as `pseudonymisation_safe=true` so the redactor leaves it alone. Out of scope here but worth noting.

10. **Versioning of the snapshot.** `GET /dictionary/snapshot` returns a `version` field (`max(approved_at)` across approved rows). Eval manifests record this; reruns are reproducible. If a term is retired between manifest build and metric recompute, the snapshot version differs and the run is flagged as "non-canonical." Acceptable behaviour; surfaces drift.

---

## 12. Files added / modified

**New (microservice):**
- `backend/Financial_terms_dictionary/app/__init__.py`
- `backend/Financial_terms_dictionary/app/main.py`
- `backend/Financial_terms_dictionary/app/config.py`
- `backend/Financial_terms_dictionary/app/db.py`
- `backend/Financial_terms_dictionary/app/schema.sql`
- `backend/Financial_terms_dictionary/app/models.py`
- `backend/Financial_terms_dictionary/app/routes_terms.py`
- `backend/Financial_terms_dictionary/app/routes_occurrences.py`
- `backend/Financial_terms_dictionary/app/routes_admin.py`
- `backend/Financial_terms_dictionary/app/matching.py`
- `backend/Financial_terms_dictionary/app/seed.py`
- `backend/Financial_terms_dictionary/Dockerfile`
- `backend/Financial_terms_dictionary/requirements.txt`
- `backend/Financial_terms_dictionary/README.md`
- `backend/Financial_terms_dictionary/tests/test_routes_terms.py`
- `backend/Financial_terms_dictionary/tests/test_matching.py`
- `backend/Financial_terms_dictionary/tests/test_seed_cleaning.py`

**New (FE):**
- `frontend/src/app/api/financial-terms/route.js`
- `frontend/src/app/api/financial-terms/[id]/route.js`
- `frontend/src/app/api/financial-terms/occurrences/route.js`
- `frontend/src/app/api/financial-terms/snapshot/route.js`
- `frontend/src/app/(dashboard)/admin/financial-terms/page.jsx`
- `frontend/src/services/financial-terms.js`

**New (metrics + retraining):**
- `backend/metrics_service/strategies/financial_term_accuracy.py`
- `backend/metrics_service/tests/test_financial_term_accuracy.py`
- (modify) `backend/retraining-pipeline/dataset_builder.py` — pre-stamp `tags.critical_terms` per sample.

**Modified:**
- `compose.yaml` — add `financial-terms-dictionary` service block on port 8009 + mount + healthcheck. Frontend `depends_on` adds it; new `FINANCIAL_TERMS_URL` env injected.
- `backend/.env` — `FINANCIAL_TERMS_PORT=8009`.
- `frontend/src/app/(dashboard)/files/[id]/page.jsx` — add the per-edit "💼 Add to dictionary" affordance.
- `frontend/src/server/audio-files.js` — auto-trail hook in `writeEditsForFile`.
- `backend/metrics_service/strategies/__init__.py` — add the new strategy import.

**Touched but not changed (reference only):**
- `backend/Financial_terms_dictionary/financialTerms.csv` — stays in-repo as the CI-reproducible seed.

---

## 13. References

- **Loughran-McDonald Master Dictionary** — domain standard for finance NLP, freely available, regularly updated. <https://sraf.nd.edu/loughranmcdonald-master-dictionary/>
- **Investopedia financial terms index** — what the existing CSV looks scraped from. Public, browsable. <https://www.investopedia.com/terms-beginning-with-num-1-7754003>
- **MeSH controlled vocabulary process** — reference for "how do you maintain a curated list at scale" (we steal the moderation queue, drop the hierarchy). <https://www.nlm.nih.gov/mesh/meshhome.html>
- **Google Cloud Speech `phrase hints` / Azure Speech `custom phrase lists`** — what "snapshot at eval time" looks like in production speech systems.
- **Wikidata revisions model** — soft-delete + audit-trail patterns in a user-curated vocabulary at internet scale.
