# AUSTIN-Lang: Project Requirements Document

## Audio Transcription Service for Financial Compliance

**Version:** 1.0
**Date:** 23 March 2026
**Project Sponsor:** UBS
**Document Status:** Draft

---

## 1. Executive Summary

AUSTIN-Lang is an Automatic Speech Recognition (ASR) platform designed to transcribe financial services call recordings for compliance review. The system serves a banking environment where customer-agent calls (investment, payment, trading) must be reviewed by compliance/risk teams to verify regulatory adherence. The platform provides accurate multilingual transcription with domain-specific financial terminology support, user-editable transcripts, administrative oversight with privacy controls, and a machine learning pipeline for continuous model improvement.

The system operates under strict data privacy constraints (PDPA), including a 7 calendar day maximum retention period for audio recordings and Client Identifying Data (CID) segregation across security zones.

---

## 2. Stakeholders & User Roles

### 2.1 User (Commercial User / Editor)

Standard end-users who interact with the transcription service to process and review call recordings.

### 2.2 Admin (Verifier / Risk Team)

Compliance personnel who vet transcripts and recordings for regulatory completeness, flag privacy issues, and manage user access privileges and data sensitivity levels.

### 2.3 ML Engineer (Backend Engineer / Developer)

Technical users who monitor model performance, manage the retraining pipeline, define custom training experiments, and create synthetic training data. ML Engineers operate under least-privilege access and do not have access to CID in the red zone.

---

## 3. Functional Requirements

### 3.1 User Requirements

#### FR-U01: Audio Upload

- Users SHALL be able to upload audio recordings (minimum 2 minutes in length) for transcription.
- The system SHALL support common audio formats (WAV, MP3, FLAC, M4A).
- The system SHALL support batch upload of multiple files.
- Upload limits SHALL be governed by the user's assigned access level tier (basic, standard, premium), which defines `max_uploads_per_day` and `max_storage_mb`.

#### FR-U02: Transcription

- Upon upload, the system SHALL invoke the ASR model to generate a text transcript.
- Transcripts SHALL include timestamp-aligned segments so that users can navigate between audio playback position and corresponding transcript text.
- The system SHALL support multilingual transcription, including Mandarin-English code-switching (interleaved language use within a single recording).
- The system SHALL accurately transcribe domain-specific financial terminology in both English and Mandarin (e.g., "derivatives", "repo rate", "衍生工具", SWIFT codes).

#### FR-U03: Transcript Review & Editing

- Users SHALL be able to view the generated transcript alongside audio playback controls.
- Users SHALL be able to edit any segment of the transcript to correct transcription errors.
- Clicking on a transcript segment SHALL seek the audio player to the corresponding timestamp, and vice versa.
- Edits SHALL be stored as diffs (corrections) applied on top of the original transcription, preserving the original output for model evaluation.
- The system SHALL compute and display a Word Error Rate (WER) based on user corrections vs. the original transcription.

#### FR-U04: File Management (Google Drive-style Interface)

- The file management experience SHALL follow the look and feel of Google Drive, acting as the central interface for organising, browsing, and managing transcripts and recordings.

**Layout & Navigation:**

- The application SHALL use a persistent **left sidebar** as the primary navigation element, visible on all pages.
- The sidebar SHALL contain:
    - **Navigation links**: Home / My Transcripts, Shared with Me, Starred / Pinned, Recent, Trash (soft-deleted within retention window)
    - **Storage usage indicator**: Visual bar showing used vs. available storage quota (per access level tier)
    - **Quick upload button**: Prominent "New" or "+" button at the top of the sidebar to initiate audio upload (mirroring Google Drive's "New" button)
    - **Role-specific sections**: Admins see additional links (User Management, Compliance Review, Statistics); ML Engineers see links to Metrics Dashboard, Training Jobs, Experiments, Synthetic Data
- The sidebar SHALL be collapsible to a narrow icon-only rail on smaller viewports.

**File Browser View:**

- The main content area SHALL display transcripts and recordings in a **file browser grid/list view** similar to Google Drive:
    - **Grid view**: Card-based layout showing file thumbnail/icon, filename, transcription status badge, date, and duration
    - **List view**: Table layout with sortable columns (Name, Status, Date Uploaded, Duration, Language, WER, Last Modified)
    - Users SHALL be able to toggle between grid and list views
- Each file item SHALL display a **status badge** indicating its transcription state (e.g., Uploading, Transcribing, Ready for Review, Edited, Approved)
- Files SHALL be colour-coded or icon-differentiated by status and type

**File Interactions:**

- **Single click** on a file SHALL select it and show a details/preview panel (right-side info panel, similar to Google Drive's side panel) displaying metadata: duration, upload date, transcription status, WER score, language detected, call category, retention countdown
- **Double click** or "Open" SHALL navigate to the full File Detail page with audio player and editable transcript
- **Right-click / context menu** SHALL provide actions: Open, Download transcript, Star/Pin, Rename, Move to Trash, Share (if permitted), View history
- **Multi-select** SHALL be supported (checkbox selection or Shift/Ctrl+click) for batch operations: bulk download, bulk delete, bulk re-transcribe
- **Drag and drop** SHALL be supported for uploading new audio files directly into the file browser

**Search & Filtering:**

- A **search bar** SHALL be present at the top of the main content area, supporting full-text search across file names and transcript content
- **Filter chips/dropdowns** SHALL allow filtering by: date range, transcription status, language, call category, flagged items, WER threshold
- **Sort options** SHALL include: name, date uploaded, date modified, duration, WER (ascending/descending)

**Folder Organisation:**

- Users SHALL be able to create folders/categories to organise their transcripts (e.g., by date, by client type, by call category)
- Breadcrumb navigation SHALL indicate the current folder path

**Responsive Design:**

- The file browser SHALL be responsive, adapting gracefully from desktop (sidebar + main content + optional details panel) to tablet (collapsible sidebar) to mobile (bottom navigation or hamburger menu)

### 3.2 Admin Requirements

#### FR-A01: Transcript & Recording Review

- Admins SHALL be able to view all transcripts and recordings across users within their verification scope (e.g., payments, orders, market controls).
- Admins SHALL be able to listen to audio recordings and read corresponding transcripts for compliance verification.
- Admins SHALL have access to a compliance checklist/form interface to verify that required terms and conditions were discussed during the call, consistent with current risk team workflows.

#### FR-A02: Privacy Flagging & CID Management

- Admins SHALL be able to flag transcripts or recordings that contain privacy concerns or unmasked Client Identifying Data (CID).
- The system SHALL indicate whether a recording/transcript has had CID stripped (`is_cid_stripped` flag).
- Admins SHALL be able to trigger or verify CID masking on recordings and transcripts (e.g., banking relationship numbers, personal identifiers).
- The system SHALL maintain a deletion log recording `recording_id`, `deleted_at`, and `deleted_by` for all recording deletions.

#### FR-A03: User Privilege Management

- Admins SHALL be able to create, modify, and deactivate user accounts.
- Admins SHALL be able to assign users to roles (User, Admin, ML Engineer).
- Admins SHALL be able to assign and modify commercial user access level tiers, controlling upload limits and storage quotas.
- Admins SHALL be able to restrict which data sensitivity level a user can access (green zone vs. red zone data).

#### FR-A04: Missing Terms Detection

- The system SHALL provide an algorithm to flag missing compliance terms in transcripts (terms that compliance requires but are absent from the conversation).
- Admins SHALL be able to review flagged missing terms for each transcript.
- The system SHALL reference a configurable Financial Term Dictionary (`FINANCIAL_TERM_DICTIONARY`) containing domain-specific terms, their categories, and supported languages.

#### FR-A05: Call Categorisation & Metadata

- Admins SHALL be able to categorise recordings using a flexible lookup-table system:
    - **Call Type Category** (e.g., purpose, transaction type, risk level)
    - **Call Type Value** (e.g., bank transfer, large investment, elevated risk)
- The system SHALL store call metadata including call origin (internal/external) and phone number.
- Admins SHALL have access to daily call statistics including total calls, average/min/max duration, standard deviation, total corrections, and total flagged violations.

### 3.3 ML Engineer Requirements

#### FR-M01: Model Performance Metrics Dashboard

- ML Engineers SHALL have access to a metrics dashboard displaying:
    - Overall Word Error Rate (WER) and Character Error Rate (CER)
    - WER breakdown by language (English, Mandarin, code-switched segments)
    - Domain-specific term accuracy (financial terminology recognition rate)
    - Trends over time (pre- and post-retraining comparisons)
- The dashboard SHALL integrate with TensorBoard for detailed training metrics visualisation (loss curves, gradient norms, learning rate schedules).

#### FR-M02: Training Job Management

- ML Engineers SHALL be able to initiate retraining jobs manually via the UI (e.g., a "Retrain" button).
- The system SHALL also support scheduled asynchronous fine-tuning (e.g., nightly batch jobs) that aggregate user corrections collected during the day.
- ML Engineers SHALL be able to view the status of running, queued, and completed training jobs.
- ML Engineers SHALL be able to cancel or stop a running training job.

#### FR-M03: Custom Experiment Definition

- ML Engineers SHALL be able to define and configure custom training experiments with the following parameters:
    - **Base model selection**: Choose from available ASR models (e.g., Whisper Tiny, Whisper Large-v3, MERaLiON, Qwen3-ASR)
    - **LoRA configuration**: Rank (`r`), alpha, target modules (e.g., `q_proj`, `v_proj`), dropout
    - **Training hyperparameters**: Learning rate, batch size, number of epochs/steps, learning rate scheduler (including super-convergence / cyclical LR discovery)
    - **Continual learning strategy**: EWC lambda, replay buffer size, rehearsal mixing ratio
    - **Privacy settings**: Differential privacy noise multiplier, max gradient norm (Opacus integration)
    - **Dataset selection**: Choose between real data pairs, synthetic data pairs, or a mix
- Experiments SHALL be versioned, and ML Engineers SHALL be able to compare results across experiment runs.
- ML Engineers SHALL be able to roll back to a previous LoRA adapter checkpoint if a retraining run causes WER regression.

#### FR-M04: Synthetic Data Pipeline

- ML Engineers SHALL be able to create synthetic training data through the following pipeline:
  1. **Text generation**: Generate financial conversation scripts using an LLM, leveraging the Financial Term Dictionary for domain-specific vocabulary
  2. **Audio synthesis**: Convert generated text to speech via TTS (e.g., Azure TTS), producing audio in target languages and accents
  3. **Noise augmentation**: Add background noise to synthetic audio to simulate live call conditions
  4. **Pair registration**: Register the resulting synthetic audio + transcript pair in the system (`SYNTHETIC_DATA_PAIR` entity), linked to the originating real data pair if applicable
- The system SHALL track synthetic data generation module version for reproducibility.
- ML Engineers SHALL be able to browse, preview, and quality-check generated synthetic data before using it for training.

#### FR-M05: Model Version Management

- The system SHALL maintain a registry of model weights and LoRA adapter versions.
- Each model version SHALL be tagged with its `data_zone` (green or red) indicating whether it was trained on CID-containing data.
- ML Engineers SHALL be able to deploy a selected model version to the inference endpoint.
- ML Engineers SHALL be able to compare inference outputs across model versions on the same audio sample.

---

## 4. Non-Functional Requirements

### 4.1 Data Privacy & Compliance (PDPA)

#### NFR-P01: Data Retention

- Audio recordings SHALL be automatically deleted within **7 calendar days** of upload (`delete_at = upload_timestamp + 7 days`).
- The system SHALL maintain an auditable deletion log for all recording deletions.
- The retraining pipeline SHALL NOT retain raw audio beyond the retention window.

#### NFR-P02: Security Zones

- The system SHALL enforce a two-zone data architecture:
    - **Red Zone**: Contains CID. Accessible only to deployed services and authorised Admins (verifiers). The ASR model and application backend run here.
    - **Green Zone**: CID-free data only. Accessible to ML Engineers and developers.
- ML Engineers SHALL NOT have direct access to CID or red zone data. Training pipelines must operate on CID-stripped data, synthetic data, or compressed feature representations (mel spectrograms, embeddings).

#### NFR-P03: Model Weight Privacy

- Model weights trained on CID-containing data SHALL be treated as potentially containing private information.
- The system SHALL support "exact unlearning" — the ability to remove the influence of specific training data from model weights, or use synthetic data that cannot be traced to individuals.
- LoRA adapter weights associated with expired data SHALL be retired or replaced according to the retention policy.
- Differential privacy (DP-SGD via Opacus) SHALL be applied during training to provide formal privacy guarantees.

#### NFR-P04: Replay Buffer Privacy

- The experience replay buffer SHALL store compressed features (mel spectrograms or encoder embeddings), NOT raw audio.
- Stored features SHALL be encrypted at rest.
- Re-identification from buffer contents SHALL be computationally infeasible.

### 4.2 Performance

#### NFR-PE01: Transcription Throughput

- The system SHALL handle a current load of approximately 50 calls/day, with architecture designed to scale to 3,000 tapes/day.
- Average call duration is approximately 5 minutes.
- Transcription turnaround (upload to transcript available) SHALL be reasonable for the user workflow; target is under 2x real-time for audio processing.

#### NFR-PE02: Retraining Efficiency

- Fine-tuning jobs SHALL be designed to run on a single GPU (e.g., RTX 4090 or Azure GPU instance).
- LoRA-based fine-tuning SHALL keep trainable parameters under 1% of the base model (~10M params for Whisper Large-v3).
- Batch size and memory consumption SHALL be validated against available GPU VRAM before training starts.

### 4.3 Security & Authentication

#### NFR-S01: Authentication

- The system SHALL implement real backend authentication using signed JWTs (e.g., via `python-jose`).
- Passwords SHALL be stored as salted hashes, never in plaintext.
- Session tokens SHALL be validated server-side on every protected API request.

#### NFR-S02: Role-Based Access Control (RBAC)

- The system SHALL enforce role-based access control with at minimum three roles: User, Admin, ML Engineer.
- API endpoints SHALL be protected with role-appropriate guards.
- Access to recordings and transcripts SHALL be scoped by role and data zone.

### 4.4 Frontend Design & User Experience

#### NFR-UX01: Visual Design Language

- The frontend SHALL adopt a **Google Drive-inspired design language**: clean, minimal, with generous whitespace, subtle shadows for elevation, and a neutral colour palette (white/grey surfaces with a brand accent colour).
- Typography SHALL use a sans-serif font stack for readability.
- Interactive elements SHALL provide clear hover, focus, and active states.

#### NFR-UX02: Sidebar-Driven Layout

- The application SHALL use a **persistent left sidebar + main content area** layout as its primary navigation pattern across all views.
- The sidebar SHALL remain consistent across page transitions (no full-page reloads or layout shifts).
- The sidebar width SHALL be approximately 240–280px expanded, collapsible to ~64px icon rail.
- The top bar SHALL contain the search bar, user avatar/profile menu, and notification indicators.

#### NFR-UX03: Role-Adaptive Interface

- The sidebar and available views SHALL adapt based on the authenticated user's role:
    - **User**: My Transcripts, Shared, Starred, Recent, Trash, Upload
    - **Admin**: All of the above, plus: All Users' Files, User Management, Compliance Review Queue, Statistics Dashboard, Privacy Flags
    - **ML Engineer**: All of the above, plus: Metrics Dashboard, Training Jobs, Experiments, Synthetic Data, Model Registry
- Unauthorised navigation items SHALL be hidden (not greyed out) to avoid confusion.

#### NFR-UX04: Accessibility

- The frontend SHALL meet WCAG 2.1 Level AA accessibility standards.
- All interactive elements SHALL be keyboard-navigable.
- Colour alone SHALL NOT be used to convey status; icons and labels SHALL supplement colour indicators.

### 4.5 Deployment & Infrastructure

#### NFR-D01: Containerisation

- All services (frontend, backend, ASR model server) SHALL be containerised using Docker.
- A dev container configuration SHALL be provided for local development (Ubuntu 24.04, Node.js, Python).

#### NFR-D02: Cloud Deployment

- The production system SHALL be deployable on Azure WebApp (red zone).
- GPU compute for training SHALL be provisioned via RunPod, Azure ML, Google Colab, or equivalent, with cost managed under available SMU/UBS cloud credits.

---

## 5. Data Model Summary

The system database (PostgreSQL) SHALL implement the following core entities:

| Entity | Purpose |
|---|---|
| `USER` | Base user entity with authentication credentials |
| `COMMERCIAL_USER` | Users who upload and edit transcripts; linked to `COMMERCIAL_USER_ACCESS_LEVEL` |
| `VERIFIER` | Admin/risk team users with `department` and `verification_scope` |
| `BACKEND_ENGINEER` | ML Engineers with `data_zone` attribute (green/red) |
| `RECORDING` | Audio file metadata, retention dates, `is_cid_stripped` flag |
| `RECORDING_METADATA` | Extended metadata: `call_origin`, `phone_number` |
| `TRANSCRIPTION` | Model output text, `corrected_content`, `missing_terms` |
| `CORRECTION` | Stored diffs of user edits on transcripts |
| `MODEL_WEIGHTS` | Versioned model/adapter weights with `data_zone` tag |
| `DELETION_LOG` | Audit trail for recording deletions |
| `REAL_DATA_PAIR` | Links recording to transcription for training use |
| `SYNTHETIC_DATA_PAIR` | Generated training pairs with module version tracking |
| `FINANCIAL_TERM_DICTIONARY` | Domain-specific terms by category and language |
| `CALL_TYPE_CATEGORY` / `CALL_TYPE_VALUE` | Flexible call categorisation lookup tables |
| `RECORDING_CALL_TYPE` | Associates recordings with call type values |
| `DAILY_CALL_STATISTICS` | Rollup table for operational reporting |
| `COMMERCIAL_USER_ACCESS_LEVEL` | Defines upload/storage tiers |

---

## 6. Technical Architecture Overview

### 6.1 ASR Model

- **Baseline**: OpenAI Whisper (variants: Tiny through Large-v3)
- **Alternatives evaluated**: MERaLiON (Singlish-optimised), Qwen3-ASR (1.7B params), Whisper-X (speaker diarization), VibéVoice (Microsoft)
- **Fine-tuning approach**: LoRA adapters on frozen base model weights
- **Continual learning**: EWC regularisation + compressed experience replay + differential privacy

### 6.2 Stack

| Layer | Technology |
|---|---|
| Frontend | React |
| Backend API | FastAPI (Python), port 8003 |
| Database | PostgreSQL, port 5432 |
| ASR Models | HuggingFace Transformers, PEFT (LoRA) |
| ML Monitoring | TensorBoard, WandB/MLflow |
| Privacy | Opacus (DP-SGD), encrypted feature storage |
| Deployment | Docker, Azure WebApp |
| GPU Training | RunPod / Azure ML / Google Colab |

### 6.3 Retraining Pipeline Flow

```
[User uploads audio]
        |
        v
[ASR Model generates transcript]
        |
        v
[User reviews and corrects transcript]
        |
        v
[Corrections stored as diffs]
        |
        v
[Nightly async fine-tuning job triggered]
   |-- Apply LoRA update on base model
   |-- Mix in replay buffer samples (compressed features)
   |-- Evaluate WER on held-out validation set
   |-- If WER regresses, roll back to previous checkpoint
        |
        v
[Updated LoRA adapter deployed]
        |
        v
[Raw audio deleted after 7 calendar days]
```

---

## 7. Constraints & Assumptions

1. **Data retention**: 7 calendar days maximum for audio recordings and associated CID.
2. **Developer access**: ML Engineers/developers operate in the green zone and SHALL NOT access CID directly.
3. **Model deployment**: The ASR model runs in the red zone (Azure WebApp with CID access).
4. **Code-switching**: The primary language pair is Mandarin-English, reflecting the Singapore/Hong Kong banking context. Cantonese support is a stretch goal.
5. **Call volume**: Current volume is ~50 calls/day (~4,000 hours total daily across the organisation), with potential scale to 3,000 sampled tapes/day.
6. **Call duration**: Average 5 minutes per call.
7. **Compliance workflow**: Risk team currently samples calls heuristically; not all calls are referred for verification.
8. **Budget**: $500 SMU budget + UBS cloud credits available. Azure preferred but not mandatory.
9. **User authentication**: Real backend auth is a required deliverable but was deprioritised during early MVP development (currently frontend-only mock).
10. **Speaker diarization**: Distinguishing multiple speakers in a call is desirable but not a hard requirement for MVP.

---

## 8. Success Metrics

| Metric | Target |
|---|---|
| Transcription WER (general) | Measurable improvement over baseline Whisper on financial domain audio |
| Transcription WER (financial terms) | Significant reduction in misrecognition of domain-specific terminology |
| Compliance review time | Reduction in average time for risk team to complete a call review form (baseline: ~5 min/call) |
| Retraining pipeline | Demonstrated end-to-end: user correction → LoRA fine-tuning → improved model deployment |
| Synthetic data pipeline | Functional generation of text → TTS audio → noise-augmented training pairs |
| Data retention compliance | 100% of recordings deleted within 7 calendar days with auditable deletion logs |

---

## 9. Document References

| Document | Location |
|---|---|
| Meeting Minutes (Sponsor) | `docs/00 Meeting minutes/` |
| ERD Changes Implementation Plan | `docs/ZZ ER diagrams/ERD_CHANGES_IMP_PLAN.md` |
| ML Research Progress | `docs/ZZ ML Research/00 Research Progress.md` |
| Online Learning Pipeline Design | `docs/ZZ ML Research/03 Designing an Online learning pipeline.md` |
| User Authentication Status | `docs/04 security/user authentication.md` |
| Server Setup Guide | `docs/06 server/running-the-server.md` |
