# Audio → Editable Transcript Pipeline

> Scope: the path a manually-uploaded audio recording takes from the upload form through Whisper transcription to the moment a user can edit the transcript on the **Files** page of their dashboard. This doc stops there. Pseudonymisation, reviewer assignment, and approval are out of scope (see `upload-pipeline.md` for those).
>
> All paths are repo-relative.

---

## At a glance

```
┌────────────────────┐        ┌──────────────────────┐
│   /upload (UI)     │  POST  │  /api/upload         │
│   user picks file  │ ─────▶ │  (Next.js route)     │
└────────────────────┘        └──────────┬───────────┘
                                         │ multipart proxy
                                         ▼
                              ┌──────────────────────┐
                              │ transcription_       │
                              │ orchestrator :8001   │
                              └──────────┬───────────┘
                  ┌──────────────────────┼──────────────────────┐
                  ▼                      ▼                      ▼
        ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
        │ audio_submission │  │ database :8002   │  │ transcription-       │
        │ :8000            │  │ writes audio +   │  │ service-2 :8005      │
        │ stores .wav/.mp3 │  │ raw + edited rows│  │ Whisper inference    │
        └──────────────────┘  └──────────────────┘  └──────────────────────┘
                                         │
                                         ▼
                              ┌──────────────────────┐
                              │ platform.db          │
                              │ audio_file row       │
                              │ stage='uploaded'     │
                              │ status='needs action'│
                              └──────────┬───────────┘
                                         │
                       user navigates to /files
                                         ▼
                              ┌──────────────────────┐
                              │ /files (list)        │
                              │ /files/[id] (editor) │
                              │ contentEditable      │
                              │ → PUT /api/audio-    │
                              │   files/[id]/edits   │
                              └──────────────────────┘
```

---

## Stage 1 — User submits the form

`frontend/src/app/(dashboard)/upload/page.jsx`

The form collects three fields:

| Field | Source | Notes |
|---|---|---|
| Audio file | `<input accept="audio/*">` (L123) | mp3, wav, m4a, flac, ogg, webm, mp4 |
| Model adapter | dropdown of LoRA names from `/api/adapters` (L141–152) | `base` = vanilla Whisper, no adapter |
| Language | `auto` / `en` / `zh` / `yue` / `ms` (L11–17) | hint passed to Whisper |

A client-side guard rejects anything shorter than `MIN_DURATION_SECONDS = 120` (FR-U01, L7–9). On submit, `uploadAudio(file, { domain, language })` from `frontend/src/services/api.js` is called.

---

## Stage 2 — Next.js proxy

`frontend/src/app/api/upload/route.js` — **POST `/api/upload`**

1. Pulls `file`, `domain`, `language` out of the multipart body.
2. Forwards the multipart payload to `http://transcription-orchestrator:8001/transcribe/`.
3. Awaits the orchestrator's response containing the canonical backend IDs.
4. Calls `registerUploadedFile()` in `frontend/src/server/audio-files.js` to mirror the recording into `platform.db` so the dashboard can render it without re-querying the backend.

The route is a thin proxy — no transcription logic lives here.

---

## Stage 3 — Backend orchestrator (six sequential calls)

`backend/transcription_orchestrator/transcription_orchestrator.py` — **POST `/transcribe/`**

| # | Target | Purpose | Returns |
|---|---|---|---|
| 1 | `audio_submission:8000/upload-audio/` | Validates extension, writes the file to `audio_files/` inside the container | URL of stored file |
| 2 | `database:8002/audio-files/` | Inserts the canonical `audio_file` row in the backend `poc.db` | `audio_file_id` |
| 3 | `transcription-service-2:8005/transcribe` | Runs Whisper large-v3-turbo with the chosen LoRA adapter and language hint | `chunks` (re-mapped to `segments` for backward compatibility, L144) |
| 4 | `database:8002/raw-transcripts/` | Inserts the immutable `raw_transcript` + `raw_transcript_segment` rows | `raw_transcript_id` |
| 5 | `database:8002/edited-transcripts/` | Creates the *editable copy* the user will modify (initialised as a verbatim copy of the raw transcript) | `edited_transcript_id` |
| 6 | — | Returns `{ audio_file_id, raw_transcript_id, edited_transcript_id, segments, ... }` | bundle to the Next.js route |

Each call is fully synchronous; the user waits for all six to complete before the upload modal closes.

**Why two transcripts?** The raw transcript is the source-of-truth model output and is never mutated. The edited transcript is a working copy that the user (and later the reviewer) edits. Diffing the two reveals every correction — the data feedstock for the retraining pipeline.

---

## Stage 4 — Mirror into `platform.db`

`frontend/src/server/audio-files.js` → `registerUploadedFile()`

Inserts one row into `audio_file` (schema in `database(FE)/schema_platform.sql`):

| Column | Value at this point |
|---|---|
| `owner_id` | uploader's user ID (from session) |
| `external_id` | UI-facing string ID (e.g. `upl-123`) |
| `display_name`, `file_name` | from the upload |
| `audio_rel_path` | `http://localhost:8000/audio_files/{filename}` *(hardcoded — needs env var before any non-local deploy)* |
| `detected_language`, `duration_sec` | from Whisper / client-side metadata |
| `status` | `'needs action'` (L189) |
| `stage` | `'uploaded'` (L189) |
| `backend_audio_file_id`, `backend_raw_transcript_id`, `backend_edited_transcript_id` | from Stage 3 |
| `dataset_id` | NULL |

An `audit_event` row is also written with `action_key = 'uploaded'`.

**At this point the pipeline is "done" from the upload perspective.** The user sees the upload modal close and the new file appear under their Files dashboard.

---

## Stage 5 — User opens the recording from the Files dashboard

### 5.1 Files list

`frontend/src/app/(dashboard)/files/page.jsx`

On mount, calls `fetchSubmittedFiles()` / `fetchAllFilesMetadata()` from `services/api.js`, which hit `GET /api/audio-files?scope=...`. The response is built by `frontend/src/server/audio-files.js` (L38–61):

```
{ id, name, audioUrl, uploaded_at, ownerId, ownerName,
  duration, detectedLanguage, dataset, status, stage,
  wer, reviewerId, submittedForReviewAt, transcriptHeader }
```

Clicking a row navigates to `/files/${file.id}` (L1343).

### 5.2 Detail / editor page

`frontend/src/app/(dashboard)/files/[id]/page.jsx`

On mount, calls `fetchFileDetail(id)` → **GET `/api/audio-files/[id]`** (`route.js` L6). The response extends the list shape with:

```
rawTranscript: { id, audio_file_id, transcript_segments: [{ id, start, end, text }, ...] }
edits:         [ ...prior edit objects... ]
```

The editor renders each segment as a `contentEditable` `<p>` (L1842–1890). User actions:

- **Click to edit** a segment — local state only.
- **Enter** splits a segment; **Escape** cancels (L1873–1876).
- **Blur** triggers `updateText(rawSeg.id, newText)` (L1850–1860), which runs `recomputeSegmentEdits()` (L465–484) to build a word-level diff against the raw segment and pushes operations into the `edits[]` state.
- **Save** (`handleSubmit`, L623–636) calls `saveEdits(fileData.id, edits)` — explicit button click, **not debounced, not auto-saved**.

---

## Stage 6 — Edits persist

`frontend/src/app/api/audio-files/[id]/edits/route.js` — **PUT `/api/audio-files/[id]/edits`**

Body: `{ edits: [...] }`. Each edit object:

```
{ id, segmentId, op: 'insert'|'delete'|'replace',
  wordIndex, before, after, editedBy, editedAt }
```

Server-side, `writeEditsForFile()` in `frontend/src/server/audio-files.js` (L281–344):

1. Deletes all existing rows for that `raw_transcript_id` (L306) — the table holds the *latest* edit set, not an append-only log.
2. Re-inserts each edit object as one row in `transcript_edit`:
   ```sql
   INSERT INTO transcript_edit
     (raw_transcript_id, start_char, content, operation, editor_id, edited_at)
   VALUES (?, ?, ?, ?, ?, ?)
   ```
   `content` = `JSON.stringify(edit)`, `operation` = `'add'` or `'delete'` (L318–319).
3. Calls `coWriteEditedTranscriptToBackend()` to push the same edits to the backend's canonical `edited_transcript` (L339).
4. Writes an `audit_event` with `action_key = 'edited'` and `editCount`.

**Status side-effect: none.** Saving an edit does **not** transition `audio_file.status`. The file stays in `'needs action'` / `'transcribed'` until the user explicitly submits it for review (out of scope here).

This is where the pipeline ends for the purpose of this document — the user has an editable transcript, edits persist round-trip, and the recording is parked in the Files dashboard awaiting whatever the user does next.

---

## Tables touched, in order

| Order | Table | Stage | What gets written |
|---|---|---|---|
| 1 | `audio_file` *(backend `poc.db`)* | 3.2 | canonical metadata |
| 2 | `raw_transcript`, `raw_transcript_segment` *(backend)* | 3.4 | immutable model output |
| 3 | `edited_transcript` *(backend)* | 3.5 | editable copy (= raw at first) |
| 4 | `audio_file` *(`platform.db` mirror)* | 4 | UI-facing row, status=`needs action`, stage=`uploaded` |
| 5 | `audit_event` | 4 | `action_key = 'uploaded'` |
| 6 | `transcript_edit` *(`platform.db`)* | 6 | full latest edit set, JSON in `content` |
| 7 | `audit_event` | 6 | `action_key = 'edited'` |

---

## Caveats

- `audio_rel_path` in `registerUploadedFile()` is hardcoded to `http://localhost:8000/...`. Won't survive a deploy — must become env-driven.
- `transcript_edit` is **rewritten in full on every save** (delete-then-insert), not appended. If two clients edit the same recording concurrently, last write wins. Not a problem today (single-user editing) but worth flagging before any multi-editor feature.
- The backend `edited_transcript` is updated via `coWriteEditedTranscriptToBackend()`. If that call fails, `platform.db` and the backend can drift — there is no transaction spanning both.
