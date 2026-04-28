# Transcript Edit Versioning — Design & Implementation Plan

_Last updated: 2026-04-27 (branch `ui_enhancement`)_

Pre-build spec for adding **append-only version history** to transcript edits. Today, every save in `writeEditsForFile()` does `DELETE FROM transcript_edit … then INSERT` — destroying prior edit state. This document plans the replacement: a versioned, never-deleting model where every submission is a permanent, addressable revision.

Sibling reading:
- `audio-to-edit-pipeline.md` — current write path (the thing being changed).
- `redis-cache-integration.md` — cache layer that has to invalidate on every new version.
- `backend_integration_status.md` — env-var conventions, integration scope.

---

## 0. Status

**Slice 1 landed on `ui_enhancement` (2026-04-28).** What landed:

- **Migration framework.** New `database(FE)/seed/migrate.py` runner — applies SQL files from `seed/migrations/<target>/` in lex order, tracks applied state + checksums in a `_schema_migrations` table, fails loudly on checksum drift. End-to-end verified: forward apply backfills, second run is no-op, edited applied file is detected. Fresh seeds via `seed_platform_db.py` call `stamp()` so migrations are recorded as applied without re-execution (alembic-style).
- **0001 migration.** `seed/migrations/platform/0001_add_transcript_versioning.sql` — creates `transcript_version`, adds `version_id` FK on `transcript_edit`, backfills any existing edit rows under a single frozen v1.
- **Schema parity.** `database(FE)/schema_platform.sql` updated for fresh-seed parity.
- **Write path.** `writeEditsForFile` rewritten to find-or-create the draft version (is_current=1), delete only that draft's edits, insert new ones tagged with `version_id = draft.id`. Frozen versions are protected by the WHERE clause and never touched. Audit detail now carries `versionNo`.
- **Freeze + co-write hook.** `setAudioFileStatus` is now async; on `submitted_for_review` / `approved` / `requested_changes` it freezes the current draft (label transition + `frozen_at` stamp) and co-writes the applied segment state to the backend `edited_transcript`. Co-write was moved out of `writeEditsForFile` so the retraining pipeline only sees committed corrections (Q2 decision below).
- **Read path.** `getAudioFileDetail` filters `transcript_edit` to the draft if one exists, else the most recent frozen version.
- **Tests.** 7 vitest cases in `src/__tests__/transcript-versioning.test.js` covering: first save creates a draft, frozen edits survive subsequent saves (the load-bearing invariant), only one is_current=1 row across many saves, approve/request-changes label mapping, freeze-with-no-draft no-op, read returns draft, read falls back to latest frozen.

**Decisions baked in (Q1–Q3 from the slice 1 sketch):**

- **Q1 — migration framework now, not later.** Built ahead of prod (Wave 4) so the convention is in place when the first un-wipeable DB lands. Postgres migration to F16 will reuse the same runner with a swapped driver.
- **Q2 — co-write only on freeze.** `coWriteEditedTranscriptToBackend` no longer fires on every save; it fires once per submit/approve/request-changes. Backend `edited_transcript` reflects committed corrections only — drafts stay FE-only. Welcome behavioural cleanup for the retraining pipeline.
- **Q3 — no hanging drafts on restore.** Slice 2's restore endpoint will refuse with HTTP 409 when a non-empty draft exists; UI modal forces "submit current first" or "discard current and restore." Slice 1 already records `versionNo` in the audit-event payload of every freeze so the chain is reconstructible.

**Slice 2 also landed on `ui_enhancement` (2026-04-28).** What landed:

- **Server module.** `frontend/src/server/transcript-versions.js` — `listVersions` (newest-first, with creator names resolved against `users.db`), `getVersion` (full edits + applied segments + raw segments), `diffVersions` (symmetric difference keyed on segmentId/wordIndex/op/before→after, plus a `shared` bucket), `restoreVersion` (handles 409 DIRTY_DRAFT + `existingDraft: 'save' | 'discard'` dispositions).
- **API routes.** Four `requireOwnerOrRole`-gated routes under `frontend/src/app/api/audio-files/[id]/versions/` — `GET /` (list), `GET /[vNo]` (fetch), `GET /[vNo]/diff/[b]` (diff vs another version), `POST /[vNo]/restore` (restore). The diff path collapsed under `[vNo]` rather than its sibling letter to satisfy Next.js's "dynamic segments must agree at each level" rule.
- **Service-layer helpers.** `frontend/src/services/api.js` — `fetchVersions`, `fetchVersion`, `diffVersions`, `restoreVersion`. Mock-mode branches reading from `MOCK_FILE_STORE`; the real-mode `restoreVersion` propagates the 409 with `code: 'DIRTY_DRAFT'` so the UI can surface the choice modal.
- **Mock parity.** `frontend/src/services/mock-data.js` — three of the seeded files now carry version histories (one with three frozen versions including a `changes_requested` cycle, one with a single `approved`, one with a frozen+current draft pair) so the chip + panel + diff viewer have something to render in dev.
- **UI.** `frontend/src/app/(dashboard)/components/TranscriptVersioning.jsx` — self-contained component placed next to the file's status badge on `/files/[id]`. Renders a chip (`v3 · submitted · 2h ago`) that opens a right-side slide-out panel listing every version with author + relative time + per-version `Compare` and `Restore` buttons. `Compare with current` expands an inline diff (red removed-in-target / green added-in-target) under the row. `Restore` on a clean state rebuilds the draft transparently; on a dirty draft the 409 surfaces a `<Dialog>` with three buttons: "Save current as a snapshot, then restore" / "Discard current and restore" / "Cancel" — Q3's no-hanging-drafts rule baked in.
- **Audit.** New `version_restored` audit-action key — runtime-upserted via `audit.js` so existing seeded DBs don't need a re-seed, and added to `seed/fixtures/audit_actions.json` for fresh seeds. Carries `{ from, to, existingDraftDisposition }` in `details_json`.
- **Bug fixed during slice 2.** First implementation of `restoreVersion`'s discard path was reusing the discarded draft's `version_no` because `MAX(version_no)+1` was computed AFTER the delete. Reordered: nextNo is locked in BEFORE any draft mutation, so version numbers monotonically increase even across discards.
- **Tests.** 9 new vitest cases in `src/__tests__/transcript-versioning-slice2.test.js`: list-newest-first + creator-name resolution, getVersion shape, getVersion 404, diffVersions symmetric (including shared bucket + reverse-direction), restore-empty-draft, restore-DIRTY_DRAFT throw, restore-with-save freezes + preserves, restore-with-discard deletes + monotonic version_no, restore unknown vNo. Slice 1's 7 tests still pass — total 16 versioning tests on the branch.

---

## 1. Goals & non-goals

### Goals

1. **Never delete a committed edit row.** A transcript that was edited 3 days ago, submitted, then re-edited today must preserve both edit sets verbatim. If v1 had word `"Foo"` corrected to `"Bar"` and v2 reverts it back to `"Foo"`, both ops live in the table forever.
2. **Each "submit for review" creates a new addressable version.** Users (and reviewers, and auditors) can answer "what did v2 look like?" by primary key.
3. **Diff between any two versions** is a cheap query.
4. **Restore a previous version** by spawning a new draft seeded from any historical version's edit set.
5. **Compliance-friendly trail.** PDPA + UBS audit posture demands tamper-evident history of corrections to recordings that touched CID.

### Non-goals

- Not real-time collaborative editing (no OT/CRDT). Single-editor, save-on-button-press model stays.
- Not branching/merging. Versions form a linear chain per transcript.
- Not tamper-proof in the cryptographic sense (no Merkle / hash-chain) — just append-only at the application layer. Add hash-chaining later if regulators demand it.
- Not dropping the existing `transcript_edit.content` JSON encoding — that quirk stays (see §6.1 of `audio-to-edit-pipeline.md`).

---

## 2. Research summary

Three industry patterns informed this plan:

### 2.1 Document-versioning pattern (MongoDB / Azure Cosmos DB)

Current document lives in collection A; every prior revision lives in a parallel collection B. Best when **versions are infrequent and queried separately from current state**. Maps cleanly to RDBMS as "current row + history table."

### 2.2 Google Docs revision history

Records *every* keystroke continuously, periodically collapses them into named versions, allows up to ~40 named versions per doc; older changes may be merged to save storage. Supports "see what changed between versions A and B" + "restore to version X" UX. Editor identity and timestamp on every revision.

### 2.3 SQL system-versioned temporal tables (SQL Server / Postgres equivalents)

A current table + an automatic history table with `ValidFrom` / `ValidTo` (`9999-12-31` = open period). On `UPDATE`/`DELETE`, the engine moves the prior row into the history table — i.e. **logical (not physical) delete**. Provides `AS OF` time-travel queries. SQLite has no native support, but the pattern is straightforward to implement at the application layer.

### 2.4 What we're stealing from each

| From | Idea | Why it fits AUSTIN-Lang |
|---|---|---|
| MongoDB DocVersioning | One canonical "current edits" view + immutable historical sets | Read-path stays cheap; history is ignorable when you don't need it |
| Google Docs | Named, human-meaningful checkpoints (submit/approve/etc.) — not every keystroke is a version | Avoids version explosion from autosaves while keeping submission boundary explicit |
| Temporal tables | `valid_from` / `valid_to` semantics, never physically deleting | Aligns with PDPA + UBS audit posture; matches "DO NOT DELETE" requirement literally |

---

## 3. Recommended model

A **two-table, append-only, version-pointer** model. Mutations only ever `INSERT`. Reads filter by `version_id` (or by "is_current" flag) instead of by `raw_transcript_id` alone.

### 3.1 Mental model

```
raw_transcript (id=42, immutable, ASR output)
        │
        ├── transcript_version v1 (label='submitted',         created 3 days ago)
        │     └── transcript_edit rows × N — frozen, never touched again
        │
        ├── transcript_version v2 (label='changes_requested', created 2 days ago)
        │     └── transcript_edit rows × M — frozen
        │
        ├── transcript_version v3 (label='submitted',         created 1 hour ago)
        │     └── transcript_edit rows × P — frozen
        │
        └── transcript_version v4 (label='draft', is_current=1, created 2 min ago)
              └── transcript_edit rows × Q — the working set, mutates in place
```

- Frozen versions are **immutable**: their `transcript_edit` rows are never updated or deleted.
- Exactly one version per `raw_transcript_id` has `is_current=1`. That's the working draft. When the user clicks Submit-for-Review, the current version flips to `is_current=0` and gets a new `label`, and a fresh `is_current=1` version is created lazily on the next edit.
- The current transcript text the user sees = applying the edits in the latest version (current or last-frozen) against the raw segments.

### 3.2 Why not also append-only inside the draft?

We considered making **every save**, including draft autosaves, a new version. The user's directive ("DO NOT DELETE ANY TRANSCRIPT EDITS") taken to its strictest reading would require this.

**Decision: keep the draft mutable.** Reasoning:

- A user typing in the editor produces one save per blur event. Over a 30-minute editing session that's 50+ saves. Forcing each into a permanent version produces ~50 rows in `transcript_version` per session — noisy for the audit UI, expensive at scale.
- The user's example was framed around *submissions* ("edit and submit … and all changes are recorded"). Submissions are the human-meaningful checkpoint. Draft churn isn't.
- Audit log already exists (`audit_event` with `action_key='edited'`) and can carry the draft-save trail without polluting `transcript_version`.

If compliance later mandates strict append-only at the row level, the upgrade path is small: drop the `is_current` mutability and create a new version on every save. Schema doesn't change.

---

## 4. Schema changes

### 4.1 New table

```sql
CREATE TABLE transcript_version (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_transcript_id   INTEGER NOT NULL REFERENCES raw_transcript(id) ON DELETE CASCADE,
    version_no          INTEGER NOT NULL,         -- 1, 2, 3 within the transcript
    parent_version_id   INTEGER REFERENCES transcript_version(id),
    label               TEXT NOT NULL CHECK (label IN (
                            'draft', 'submitted', 'approved',
                            'changes_requested', 'restored'
                        )),
    is_current          INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
    created_by          TEXT NOT NULL,            -- ref to users.db user.id
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    frozen_at           TEXT,                     -- NULL while draft, ISO on freeze
    note                TEXT,                     -- optional reviewer/editor note
    UNIQUE (raw_transcript_id, version_no)
);

-- Exactly one current version per transcript.
CREATE UNIQUE INDEX ux_transcript_version_current
    ON transcript_version (raw_transcript_id)
    WHERE is_current = 1;

CREATE INDEX ix_transcript_version_rt
    ON transcript_version (raw_transcript_id, version_no);
```

`label` values:

| Label | When set |
|---|---|
| `draft` | Default for a working version while user is editing |
| `submitted` | On `submit-for-review` — freezes the draft |
| `approved` | On approve action — freezes whatever was in review |
| `changes_requested` | On reviewer "request changes" — freezes the in-review version |
| `restored` | When the user opens "Restore version X" — a new draft seeded from X's edits |

### 4.2 Modified table

```sql
ALTER TABLE transcript_edit ADD COLUMN version_id INTEGER
    REFERENCES transcript_version(id) ON DELETE CASCADE;

CREATE INDEX ix_transcript_edit_version ON transcript_edit(version_id);
```

The existing columns (`raw_transcript_id`, `start_char`, `content`, `operation`, `editor_id`, `edited_at`) stay untouched. The JSON-in-`content` encoding stays. Only the new `version_id` discriminates which version a row belongs to.

### 4.3 Audit hooks

Existing `audit_event` table already records `action_key='edited'`. Extend the `details_json` payload to include `{ versionNo, label }` so the audit timeline shows a "submitted v3" entry without needing to join.

---

## 5. Behaviour changes

### 5.1 Write path — `writeEditsForFile(fileId, edits, actor)`

Replaces `frontend/src/server/audio-files.js:281–344`. New algorithm:

```
1.  Find or create the current draft version:
    - SELECT * FROM transcript_version
       WHERE raw_transcript_id = ? AND is_current = 1
    - If none exists: create one (label='draft', is_current=1, version_no=MAX+1)

2.  Within a single SQLite transaction, for the draft only:
    - DELETE FROM transcript_edit WHERE version_id = <currentDraftId>
    - INSERT new edit rows tagged with version_id = <currentDraftId>

3.  Frozen versions are NEVER touched.

4.  Co-write the latest draft's applied segments to the backend
    edited_transcript (existing coWriteEditedTranscriptToBackend).

5.  Audit event: action_key='edited', details={ versionNo, editCount }.
```

Critical: step 2's DELETE only matches the draft `version_id`. Frozen versions' rows are protected by the WHERE clause; there's no path that touches them.

### 5.2 Submit-for-review — `setAudioFileStatus(id, 'in review', …)`

In addition to the existing status update, **freeze the current draft**:

```
1.  Find the current version (is_current=1, label='draft').
2.  UPDATE transcript_version
       SET label='submitted', is_current=0, frozen_at=datetime('now')
     WHERE id = <currentId>.
3.  Do NOT immediately create a new draft; the next call to
    writeEditsForFile lazily creates one when the user starts editing again.
4.  Audit event: action_key='submitted_for_review', details={ versionNo }.
```

Approve / request-changes follow the same shape with different `label` values.

### 5.3 Read path — `getAudioFileDetail(id)`

Today returns `{ ..., edits: [...] }` from a `SELECT FROM transcript_edit`. New read:

```sql
SELECT te.content
  FROM transcript_edit te
  JOIN transcript_version tv ON tv.id = te.version_id
 WHERE tv.raw_transcript_id = ?
   AND (tv.is_current = 1                      -- the draft, if any
        OR tv.id = (SELECT id FROM transcript_version
                     WHERE raw_transcript_id = ?
                       AND is_current = 0
                  ORDER BY version_no DESC LIMIT 1))   -- else latest frozen
 ORDER BY te.edited_at, te.id;
```

In English: prefer the working draft if it exists; otherwise show the most recent frozen version. The applied transcript the user sees is unchanged from today.

Add a sibling field to the response payload so the UI can show the version chip:

```ts
currentVersion: {
  id, versionNo, label, createdAt, createdBy, isDraft: boolean
}
versions: [
  { id, versionNo, label, createdAt, createdBy, frozenAt, note }
]
```

### 5.4 New endpoints

| Method + path | Purpose | Server function |
|---|---|---|
| `GET /api/audio-files/{id}/versions` | List all versions for a file (lightweight, no edit payloads) | `listTranscriptVersions(fileId)` |
| `GET /api/audio-files/{id}/versions/{vNo}` | Fetch a specific version's full edit set + applied segments | `getTranscriptVersion(fileId, vNo)` |
| `GET /api/audio-files/{id}/versions/{a}/diff/{b}` | Compute diff between two versions | `diffTranscriptVersions(fileId, a, b)` |
| `POST /api/audio-files/{id}/versions/{vNo}/restore` | Create a new draft seeded from version vNo's edits | `restoreTranscriptVersion(fileId, vNo, actor)` |

Restore semantics: copies vNo's edits into a brand-new draft version (label='restored', parent_version_id=vNo's id). Original vNo stays untouched.

### 5.5 Diff algorithm

Per-version edit sets are bags of `{ segmentId, op, wordIndex, before, after }` objects. Diff between version A and version B = symmetric difference, grouped by `segmentId`. Pseudo-code:

```js
const setA = new Set(versionA.edits.map(canonicalKey));
const setB = new Set(versionB.edits.map(canonicalKey));
const onlyInA = [...setA].filter(k => !setB.has(k));   // reverted in B
const onlyInB = [...setB].filter(k => !setA.has(k));   // introduced in B
```

`canonicalKey(edit) = ${segmentId}:${wordIndex}:${op}:${before}→${after}`.

For UI: render onlyInA as red strike-through, onlyInB as green inserted, unchanged ops omitted.

### 5.6 Restore flow

```
User clicks "Restore version 2"
   → POST /api/audio-files/{id}/versions/2/restore
   → Server:
       1. Load version 2's transcript_edit rows.
       2. Freeze any current draft (rare — restore from a clean state usually).
          If a current draft exists:
            – Save it as label='draft' frozen, OR
            – Discard via the audit log (configurable; default = freeze, never lose).
       3. Create new transcript_version row:
            label='restored', is_current=1, parent_version_id=v2.id
       4. Copy v2's transcript_edit rows into new rows tagged with the
          new version_id (NOT pointer-shared — full physical copy so the
          original rows stay attached to v2 only).
       5. Audit: action_key='version_restored', details={ from: 2, to: newVersionNo }
   → Client reloads detail page, sees the restored draft.
```

---

## 6. Migration plan

Single-shot migration script run once before the new code paths ship. Idempotent — running twice is a no-op.

```sql
BEGIN TRANSACTION;

-- 1. Create the new table.
CREATE TABLE IF NOT EXISTS transcript_version (...);
CREATE UNIQUE INDEX IF NOT EXISTS ux_transcript_version_current ON ...;
CREATE INDEX IF NOT EXISTS ix_transcript_version_rt ON ...;

-- 2. Add version_id column if not present.
ALTER TABLE transcript_edit ADD COLUMN version_id INTEGER
    REFERENCES transcript_version(id) ON DELETE CASCADE;
-- (SQLite tolerates this on existing tables; the column will be NULL for legacy rows.)

-- 3. For every raw_transcript that has any transcript_edit rows,
--    create a "legacy" version_no=1 and tag all existing rows with it.
INSERT INTO transcript_version
    (raw_transcript_id, version_no, label, is_current, created_by, created_at, frozen_at, note)
SELECT
    rt.id,
    1,
    'submitted',
    0,
    COALESCE((SELECT editor_id FROM transcript_edit te
              WHERE te.raw_transcript_id = rt.id
              ORDER BY te.edited_at DESC LIMIT 1), 'unknown'),
    COALESCE((SELECT MIN(edited_at) FROM transcript_edit te WHERE te.raw_transcript_id = rt.id),
             datetime('now')),
    datetime('now'),
    'Imported from pre-versioning data'
FROM raw_transcript rt
WHERE EXISTS (SELECT 1 FROM transcript_edit te WHERE te.raw_transcript_id = rt.id);

UPDATE transcript_edit
   SET version_id = (SELECT id FROM transcript_version
                     WHERE raw_transcript_id = transcript_edit.raw_transcript_id
                       AND version_no = 1)
 WHERE version_id IS NULL;

-- 4. Tighten the constraint once everything is backfilled.
-- (SQLite can't easily ALTER to NOT NULL; document that all writes must set version_id.
--  Rely on application code + a CHECK trigger if paranoia is warranted.)

COMMIT;
```

Backend `poc.db` stores the canonical edited transcript via `coWriteEditedTranscriptToBackend()`. That table is **not** versioned by this plan — it always reflects the latest committed (frozen or current) state. If retraining wants version-aware data later, replicate the same versioning model server-side; out of scope here.

---

## 7. UI implications

This is a backend-first plan, but the frontend needs to surface versions or the feature is invisible. Suggested minimal UI:

1. **Version chip on the file detail page** — top-right of the transcript editor, e.g. `v3 · submitted · 2h ago`. Clicking opens a panel.
2. **Version panel** — vertical list of versions, newest first, each with author + label + relative timestamp. Click a version → routes to `/files/{id}?v=2`, which loads the historical view (read-only, no edit handles).
3. **"Compare with current"** affordance on each historical version — opens a side-by-side view rendering the diff (§5.5).
4. **"Restore this version"** button on any frozen version. Confirms with the user that a new draft will be created.

Loading a historical version routes through the same Lottie spinner as today's load (see `audio-to-edit-pipeline.md` §5.2) — no new loading affordance needed.

---

## 8. Edge cases

| Case | Handling |
|---|---|
| User submits without ever editing (raw transcript was already correct) | Still create v1 with zero edits. Empty edit set is a valid version. |
| User restores v2 after submitting v3, then submits | New version is v4, label='submitted', `parent_version_id` points at v2's id (not v3's). Linear `version_no` order, but `parent_version_id` records the lineage. |
| Race: two writes to the same draft within the same second | The `UNIQUE (raw_transcript_id, is_current=1)` partial index serializes draft creation. The DELETE-then-INSERT inside the draft is one transaction — last writer wins for the draft set, but no frozen version is ever touched. Acceptable today (single-editor); revisit if multi-edit ships. |
| Migration runs twice | All `INSERT INTO transcript_version` and `UPDATE transcript_edit` are idempotent because they filter on `WHERE version_id IS NULL` / `WHERE NOT EXISTS`. |
| Frozen version's `transcript_edit` rows accidentally get a UPDATE/DELETE in code | Add a `BEFORE UPDATE` / `BEFORE DELETE` trigger that fails when `OLD.version_id` belongs to a frozen version. Belt-and-braces — application code is the primary guard. |
| Reviewer rejects via "request changes" — what happens to in-review version? | Frozen with `label='changes_requested'`. Next user edit lazily creates a new draft (parent_version_id = the changes_requested version). |
| File deleted (PDPA 7-day window) | `ON DELETE CASCADE` on both new FKs ensures version + edit rows go with the audio file. Audit log already records the deletion separately. |

---

## 9. Implementation steps

In recommended order:

1. **Migration script** — `database(FE)/seed/migrations/0001_add_transcript_versioning.sql`. Run via the existing seed harness or a new `npm run migrate` script.
2. **Schema in `database(FE)/schema_platform.sql`** — add `transcript_version` table + `version_id` column so fresh seeds match the migrated state.
3. **`src/server/audio-files.js`** — refactor `writeEditsForFile` to find-or-create-draft + insert. Refactor `getAudioFileDetail` to filter by latest version.
4. **`src/server/transcript-versions.js`** (new) — `listVersions`, `getVersion`, `diffVersions`, `restoreVersion`.
5. **API routes** — add the four endpoints in §5.4 under `src/app/api/audio-files/[id]/versions/`.
6. **Cache invalidation** — in `src/server/cache.js` (per `redis-cache-integration.md`), call `invalidateDetail` whenever a version is created, frozen, or restored.
7. **Frontend** — version chip + panel + diff view in `src/app/(dashboard)/files/[id]/page.jsx`. New service helpers in `src/services/api.js`: `fetchVersions`, `fetchVersion`, `diffVersions`, `restoreVersion`.
8. **Mock parity** — extend `MOCK_FILE_STORE` shape with `versions[]` and `currentVersion` so dev mode renders the version chip.
9. **Tests** — unit tests on `writeEditsForFile` confirming frozen rows are never touched; integration test that submits twice and asserts both edit sets exist verbatim.
10. **Update docs** — extend `audio-to-edit-pipeline.md` §6 (Stage 6) with the new write path, and update the "tables touched" matrix to include `transcript_version`.

---

## 10. Open questions / decisions deferred

1. **Pruning policy.** Forever-retention is the default. PDPA is silent on the trail of *corrections* (the audio is the regulated artifact; the transcript is derived). If retention pressure shows up, propose a soft-archive strategy (move frozen rows older than N years to `transcript_edit_archive`, never delete).
2. **Hash chaining for tamper-evidence.** Add `prev_version_hash` + `content_hash` columns on `transcript_version` if regulators ever ask for cryptographic proof. Cheap to add later; non-invasive to the read path.
3. **Auto-merge of consecutive draft saves.** Today's plan keeps the draft mutable. If we ever want every keystroke as a version (Google Docs strict mode), the change is local to `writeEditsForFile`.
4. **Backend `edited_transcript` versioning.** Currently mirrors only the latest. The retraining pipeline reads from this table — if we ever want to feed *historical* corrections into training (counterexamples), version it server-side.
5. **Draft auto-save vs. explicit save.** Out of scope for this plan; if auto-save is added, it lands in the draft version and doesn't change anything in this design.

---

## 11. Files added / modified

**New:**
- `database(FE)/seed/migrations/0001_add_transcript_versioning.sql`
- `frontend/src/server/transcript-versions.js`
- `frontend/src/app/api/audio-files/[id]/versions/route.js`
- `frontend/src/app/api/audio-files/[id]/versions/[vNo]/route.js`
- `frontend/src/app/api/audio-files/[id]/versions/[a]/diff/[b]/route.js`
- `frontend/src/app/api/audio-files/[id]/versions/[vNo]/restore/route.js`

**Modified:**
- `database(FE)/schema_platform.sql` — add `transcript_version`, `version_id` column on `transcript_edit`, the partial unique index, and the FK indexes.
- `frontend/src/server/audio-files.js` — `writeEditsForFile` (versioned write), `getAudioFileDetail` (filter by latest version, return `currentVersion` + `versions[]`), `setAudioFileStatus` (freeze on submit/approve/request-changes).
- `frontend/src/server/cache.js` — call `invalidateDetail` on version freeze + restore (already on edit save per `redis-cache-integration.md` §5).
- `frontend/src/services/api.js` — `fetchVersions`, `fetchVersion`, `diffVersions`, `restoreVersion`.
- `frontend/src/services/mock-data.js` — extend mock files with `versions[]`, `currentVersion`.
- `frontend/src/app/(dashboard)/files/[id]/page.jsx` — version chip, panel, diff view, restore confirm.
- `docs/06 server/audio-to-edit-pipeline.md` — update Stage 6 + the "tables touched" matrix.
- `docs/07 Integration CAA 27APR2026/redis-cache-integration.md` — note the additional invalidation hooks (version freeze, restore).

---

## Sources

- [Document Versioning Pattern — MongoDB Docs](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/data-versioning/document-versioning/)
- [Schema Versioning Pattern — MongoDB Docs](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/data-versioning/schema-versioning/)
- [Azure Cosmos DB design pattern: Document Versioning — Microsoft Learn](https://learn.microsoft.com/en-us/samples/azure-samples/cosmos-db-design-patterns/document-versioning/)
- [Temporal Tables — Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal-tables)
- [Modify data in a system-versioned temporal table — Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/tables/modifying-data-in-a-system-versioned-temporal-table)
- [Using Google Docs Version History — Teton Science Schools IT Helpdesk](https://it-helpdesk.tetonscience.org/support/solutions/articles/5000718670-using-google-docs-version-history-for-good-and-evil-)
- [Find what's changed in a file — Google Docs Editors Help](https://support.google.com/docs/answer/190843)
