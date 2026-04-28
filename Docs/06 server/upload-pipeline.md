# Manual Upload Pipeline

> Source-of-truth trace of what happens when a user manually uploads an audio recording, plus the dimensions on which that recording gets allocated downstream. All file paths are relative to the repo root unless otherwise noted.

---

## 1. Pipeline (linear flow)

### 1.1 Upload form (browser)

`frontend/src/app/(dashboard)/upload/page.jsx`

The user provides:

| Field | Notes | Source line |
|---|---|---|
| Audio file | `accept="audio/*"`; client reads metadata to compute duration | L123 |
| Model adapter | dropdown, defaults to `base`; options come from `/api/adapters` | L141–152 |
| Language | `auto` / `en` / `zh` / `yue` / `ms` | L11–17, L159–168 |

Client-side gate: `MIN_DURATION_SECONDS = 120` — anything shorter is rejected before the POST (FR-U01, L7–9). Server is expected to re-validate.

On submit, `uploadAudio(file, { domain, language })` from `frontend/src/services/api.js` is called.

### 1.2 Next.js API route (proxy)

`frontend/src/app/api/upload/route.js` — **POST `/api/upload`**

1. Pulls `file`, `domain`, `language` out of the multipart FormData.
2. Forwards the multipart payload to the backend orchestrator at `http://transcription-orchestrator:8001/transcribe/`.
3. On 2xx, calls `registerUploadedFile()` in `frontend/src/server/audio-files.js` to mirror the result into `platform.db`. The mirror row stores the canonical backend identifiers (`backend_audio_file_id`, `backend_raw_transcript_id`, `backend_edited_transcript_id`) so the UI can address the recording without re-querying the orchestrator.

### 1.3 Backend orchestrator

`backend/transcription_orchestrator/transcription_orchestrator.py` — **POST `/transcribe/`**

Six sequential calls, each fully synchronous:

1. **Audio storage** → `audio_submission:8000/upload-audio/`
   - Validates extension (mp3, wav, m4a, flac, ogg, webm, mp4 — see `backend/audio_submission/audio_submission.py` L35).
   - Writes the file to `audio_files/` inside the container; serves it back at `http://audio_submission:8000/audio_files/{filename}`.
2. **Audio metadata row** → `database:8002/audio-files/` → returns `audio_file_id` (the canonical backend ID).
3. **Transcription** → `transcription-service-2:8005/transcribe` with the audio bytes + chosen domain (LoRA adapter) + language hint.
   - Returns `chunks` (mapped to `segments` in the orchestrator response for backward compatibility, L144).
4. **Raw transcript row** → `database:8002/raw-transcripts/`.
5. **Edited transcript row** → `database:8002/edited-transcripts/` (initialised as a copy of the raw transcript so reviewers can edit non-destructively).
6. Returns the bundle of IDs back up to the Next.js route.

Pseudonymisation is **not** invoked at upload time — see §1.5.

### 1.4 Mirror into `platform.db`

`frontend/src/server/audio-files.js` → `registerUploadedFile()`

Inserts a row into `audio_file` with:

- `owner_id` = the authenticated uploader's user ID
- `status = 'needs action'`, `stage = 'uploaded'` (L189)
- `audio_rel_path` = `http://localhost:8000/audio_files/{filename}` *(hardcoded — needs to become an env-driven URL before any non-local deploy)*
- `dataset_id` = NULL initially

### 1.5 Pseudonymisation (deferred until review)

Triggered later, not at upload, by `submitForReview(fileId, reviewerId)` in `frontend/src/services/api.js` (L378–443). Calls the pseudonymisation orchestrator (`:5002`) fire-and-forget, which in turn calls the GliNER service (`:5001`) to detect PII spans. Spans land in `pseudonymisation_spans`, awaiting reviewer accept/reject decisions.

### 1.6 Status lifecycle

Defined in `frontend/src/lib/statusFlow.js` L8–14:

```
uploaded ──▶ transcribing ──▶ transcribed ──▶ in review ──▶ completed
                                                  │
                                                  └──▶ needs action ──▶ in review (resubmit)
```

Every transition writes to `audit_event` with an `action_key` (`uploaded`, `submitted_for_review`, `approved`, `changes_requested`, …) and the actor.

---

## 2. Allocation

A recording gets allocated along **five orthogonal dimensions**. Each is set at a different point in the pipeline.

### 2.1 Owner — set at upload

- Column: `audio_file.owner_id` (FK to `user.id` in `users.db`).
- Set by `registerUploadedFile()` from the session cookie.
- Determines which user sees the file in their personal `Files` view and who appears as the "submitter" downstream.

### 2.2 Organisation / region group — implicit, via membership

- Source: `database(FE)/seed/fixtures/group_assignments.json` (user → group IDs).
- Groups follow a `<region>-<role>-file-organisation` naming convention, e.g. `hk-user-file-organisation`, `hk-reviewer-file-organisation`, `hk-engineer-file-organisation`, `hk-admin-file-organisation`.
- The recording inherits the uploader's region implicitly through `owner_id`. There is **no** `region_id` column on `audio_file` today — the join is `audio_file.owner_id → user_group_membership.user_id → group.id`.
- A reviewer in `hk-reviewer-file-organisation` therefore sees the queue of HK-region recordings; a Singapore reviewer would not.

### 2.3 Reviewer — manual assignment

- API: `frontend/src/app/api/audio-files/[id]/submit-for-review/route.js`.
- Caller passes `reviewerId` explicitly into `submitForReview(fileId, reviewerId)`.
- Persisted as: `setAudioFileStatus(id, 'in review', user, { actionKey: 'submitted_for_review', details: { reviewerId } })` — i.e. the reviewer is recorded inside the audit event's `details` JSON, not as a first-class column on `audio_file`.
- **There is no auto-assignment / round-robin / load-balancing logic.** A reviewer is picked manually from the eligible reviewer pool.

### 2.4 Dataset — optional, post-approval

- Column: `audio_file.dataset_id` (FK to `dataset`).
- Not set at upload (it stays NULL).
- Populated when a recording is curated into a training/eval dataset for the retraining pipeline. Dataset metadata (`language`, `tags`) lives in `dataset` (see `database(FE)/schema_platform.sql`).

### 2.5 Model adapter — chosen at upload

- Field: `domain` from the form, sent through to `transcription-service-2`.
- Selects which Whisper LoRA adapter (`backend/retraining-pipeline/adapters/<name>/`) is loaded for inference.
- Default `base` = no adapter (vanilla Whisper).
- This is the *inference-time* allocation — it does not change which adapter a future correction feeds back into; that's a separate decision in the retraining pipeline.

---

## 3. Storage today vs. cloud

| Artifact | Today | Implication for cloud (Azure) |
|---|---|---|
| Raw audio | `backend/audio_submission/audio_files/` inside the `audio_submission` container | Must move to Blob Storage with 7-day lifecycle (PDPA). `audio_rel_path` hardcoded to `localhost:8000` — needs env var. |
| Audio metadata + transcripts | SQLite `database(FE)/platform.db` (mirror) + backend `poc.db` (canonical) | Both → Azure Database for PostgreSQL. Mirror pattern can stay; canonical IDs stay authoritative. |
| Pseudonymisation spans | `pseudonymisation_data` Docker volume + `pseudonymisation_spans` table | Encrypted column (Fernet) → Postgres + Key Vault-managed key. |
| LoRA adapters | `backend/retraining-pipeline/adapters/` bind mount | Azure ML Model Registry or Blob, tagged with `data_zone`. |

---

## 4. Known gaps

1. **`audio_rel_path` hardcoded** to `http://localhost:8000/...` in `registerUploadedFile()`. Will not survive a non-local deploy.
2. **No reviewer auto-assignment.** Every recording requires a human to pick a reviewer ID. If volume scales toward the 3,000-tapes/day target in the PRD, this becomes a bottleneck.
3. **No `region_id` / `org_id` on `audio_file`.** Region scoping is inferred from `owner_id`'s group membership; if a user moves region or a recording is transferred, allocation breaks silently.
4. **No `data_zone` tag on the audio_file row.** Required before red-zone / green-zone separation can be enforced (cross-reference: `azure-deployment-requirements.md`).
5. **Pseudonymisation runs at submit-for-review, not at upload.** That's a deliberate choice (no point pseudonymising drafts), but means an unsubmitted recording can sit in storage with raw PII for arbitrarily long. The 7-day deletion clock should start at *upload*, not at *submit*.
