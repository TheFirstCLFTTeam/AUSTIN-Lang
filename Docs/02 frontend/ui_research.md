# ML Engineer UI Research

Research into ML observability and experiment tracking platforms to inform the design of AUSTIN-Lang's ML Engineer dashboard. Cross-references requirements FR-M01 through FR-M05 in the [Project Requirements Document](./Project_Requirements_Document.md).

---

## 1. What ML Engineers Actually Need

Based on analysis of six major platforms and ML engineering workflow literature, the following capabilities are universally expected:

### 1.1 Experiment Tracking & Reproducibility

- Record every factor influencing an experiment: model architecture, hyperparameters, training config, dataset version, code commit, environment, hardware used, and evaluation metrics.
- Enable full reproducibility — any past experiment should be re-runnable from its logged metadata.
- Track metrics across hundreds of training iterations for comparison.

### 1.2 Visual Experiment Comparison

- Compare metrics and parameters across experiments simultaneously.
- Side-by-side run comparisons with clear visualisation (overlay charts, diff tables).
- Parallel coordinates plots for hyperparameter analysis.
- Filter and sort experiments by any logged attribute.

### 1.3 Model Registry & Versioning

- Centralised model storage with automatic version numbering.
- Lifecycle staging: experimental → staging → production.
- Model aliases and tags (e.g., `@champion`, `@latest`) for easy reference.
- Full lineage tracking: which training run, dataset, and code produced each model version.

### 1.4 Training Job Management

- Initiate, monitor, queue, and cancel training jobs.
- View real-time training progress (loss, metrics, epoch count).
- Hardware/resource monitoring: GPU utilisation, VRAM usage, CPU load, memory.
- Async/scheduled job support (nightly batch runs, triggered retraining).

### 1.5 Dataset Management

- Dataset versioning and lineage tracking.
- Browse, preview, and quality-check training data before use.
- Filter and group experiments by dataset version.
- Synthetic data management alongside real data.

### 1.6 Alerting & Monitoring

- Alert on metric regression (e.g., WER increases after retraining).
- Anomaly detection on logged metrics (spikes, plateaus).
- Drift detection for incoming data distributions.

### 1.7 Collaboration & Sharing

- Shared dashboards and persistent links to experiments.
- Role-based access to experiment results.
- Reports and annotations for handoff between researchers and deployers.

### 1.8 Low-Friction Integration

- Minimal code changes to start logging (ideally 1–2 lines).
- Automatic capture of hyperparameters, system metrics, and framework-specific data.
- Framework-agnostic support (PyTorch, HuggingFace, etc.).

---

## 2. Platform-by-Platform Analysis

### 2.1 TensorBoard (Google)

**What it is:** Visualisation toolkit bundled with TensorFlow/PyTorch. Already in AUSTIN-Lang's `requirements.txt`.

**Key features:**

| Feature | Details |
|---|---|
| Scalars | Loss and metric curves over epochs/steps, learning rate tracking |
| Histograms | Weight/bias distributions over time — verify expected changes during training |
| Graphs | Computational graph visualisation — understand model architecture and layer structure |
| Images / Audio / Text | Multi-modal data display during training |
| Embeddings | Project embeddings to lower-dimensional space (t-SNE, PCA) |
| Profiler | Identify performance bottlenecks (GPU idle time, data loading stalls) |
| HParams | Basic hyperparameter comparison across runs |

**UI layout:** Tab-based navigation (Scalars, Images, Graphs, etc.) with a left sidebar for run selection. Runs are toggled on/off to overlay on the same chart.

**Strengths:** Free, already integrated into HuggingFace `Trainer` (1 line: `report_to=["tensorboard"]`), excellent real-time training visualisation.

**Limitations:** No model registry, no experiment versioning beyond folder naming, no collaboration features, no async job management, no dataset management.

**Relevance to AUSTIN-Lang:** High — already in the stack. Can be embedded via iframe or reverse-proxied through the backend for the ML dashboard. Good for real-time training monitoring but insufficient as the sole ML engineer interface.

---

### 2.2 Weights & Biases (W&B)

**What it is:** Commercial ML experiment tracking and collaboration platform. The industry standard for team-based ML projects.

**Key features:**

| Feature | Details |
|---|---|
| Experiment Tracking | Automatic logging of hyperparameters, metrics, code, system info per run |
| Dashboard | Customisable panels: line charts, bar charts, scatter plots, parallel coordinates, tables |
| Run Comparison | Side-by-side metric/parameter diffs; toggle run sets on/off |
| Sweeps | Built-in hyperparameter optimisation (grid, random, Bayesian) |
| Model Registry | Versioned model storage with staging and aliases |
| Artifacts | Dataset and model artifact tracking with lineage |
| Reports | Interactive shareable documents mixing text, charts, and experiment data |
| System Metrics | GPU/CPU/memory utilisation tracked automatically per run |
| Alerts | Custom metric-based alerts (e.g., "notify if WER > 0.3") |

**UI layout:**

- **Left sidebar**: Workspace → Project → Runs navigation
- **Main area**: Tabular runs list with sortable columns (run name, state, metrics, created date)
- **Run detail**: Tabs for Overview, Charts, System, Logs, Files, Artifacts
- **Comparison view**: Overlay multiple runs on same chart; parallel coordinates for hyperparameters

**Strengths:** Best-in-class UI/UX, excellent collaboration, comprehensive feature set, 2-line integration.

**Limitations:** Commercial (free tier available but limited), data leaves your infrastructure unless self-hosted.

**Relevance to AUSTIN-Lang:** W&B's UI patterns are the gold standard to emulate. The runs table, comparison charts, and system metrics panels are directly applicable to the ML Engineer dashboard design.

---

### 2.3 MLflow (Databricks, Open Source)

**What it is:** Open-source ML lifecycle platform. 30M+ monthly downloads. Apache 2.0 licence.

**Key features:**

| Feature | Details |
|---|---|
| Tracking | Log parameters, metrics, artifacts, code versions per run via Python/REST API |
| Experiments | Organise runs into named experiments; search API for querying |
| Model Registry | Centralised model store with version numbering, aliases (`@champion`), lifecycle stages |
| Metrics Dashboard | Visualise metrics across runs; parallel coordinates for hyperparameters |
| Artifacts | Store and version datasets, model files, configs |
| Serving | FastAPI-based model serving with tracing |
| LLM Support | Prompt management, evaluation metrics, AI Gateway |

**UI layout:**

- **Left sidebar**: Experiments list, Models registry, Datasets
- **Experiment view**: Table of runs with sortable/filterable columns (params, metrics, tags, date)
- **Run detail**: Parameters, Metrics (charts), Artifacts, Tags
- **Model Registry**: Model list → versions → aliases → lineage

**Strengths:** Fully open source, no vendor lock-in, comprehensive, strong model registry, wide framework support.

**Limitations:** UI less polished than W&B, requires self-hosting for full control, limited real-time system metrics.

**Relevance to AUSTIN-Lang:** MLflow's model registry pattern (versions + aliases + stages) maps directly to FR-M05 (Model Version Management). Its experiment/runs table is a clean pattern for FR-M03 (Custom Experiment Definition).

---

### 2.4 Neptune.ai

**What it is:** ML metadata store and experiment tracker focused on visual analytics.

**Key features:**

| Feature | Details |
|---|---|
| Experiment Database | Visual interface over structured experiment metadata |
| Anomaly Detection | Automatic spike detection on metric charts |
| Comparison Charts | Render 100s of experiments in a single visualisation |
| Run Trees | Visualise training lineage (parent → child runs) |
| Dashboards | Highly customisable; persistent shareable links |
| Dataset Versioning | Compare datasets or group experiments by dataset version |

**UI layout:**

- **Left sidebar**: Projects, Runs, Models, Datasets
- **Main area**: Customisable dashboard with draggable/resizable chart panels
- **Comparison**: Multi-run overlay charts with auto-anomaly highlighting

**Strengths:** Excellent for large-scale experiment comparison (100s of runs), anomaly detection is unique, highly customisable dashboards.

**Limitations:** Model registry being deprecated (2025-04-01). Less comprehensive than W&B/MLflow for full lifecycle.

**Relevance to AUSTIN-Lang:** Neptune's anomaly detection on WER metrics is relevant for detecting model regression after retraining (FR-M01). Its comparison charts pattern is useful for the experiment comparison view.

---

### 2.5 ClearML (Open Source)

**What it is:** Open-source MLOps platform with strong pipeline orchestration.

**Key features:**

| Feature | Details |
|---|---|
| Auto-Logging | 2 lines of code to capture everything: config, datasets, params, code, environment, Git commit |
| Pipeline Orchestration | Create training pipelines from Python decorators; chain tasks; conditional execution |
| Resource Monitoring | GPU/CPU/memory utilisation tracked per experiment |
| Visualisations | Matplotlib, Plotly, images, audio, HTML — all rendered in browser |
| Remote Execution | Execute experiments on remote machines with automatic environment reproduction |
| Data Management | Dataset versioning and management |

**UI layout:**

- **Left sidebar**: Projects, Tasks (experiments), Pipelines, Datasets, Models
- **Task detail**: Execution tab (logs, resource plots), Results tab (metrics/plots), Configuration tab (hyperparameters), Artifacts tab
- **Pipeline view**: DAG visualisation of pipeline steps with status indicators

**Strengths:** Best pipeline orchestration of any platform, automatic logging reduces manual effort, open source, strong resource monitoring.

**Limitations:** UI less intuitive than W&B, steeper learning curve, smaller community.

**Relevance to AUSTIN-Lang:** ClearML's pipeline orchestration pattern is directly applicable to the synthetic data pipeline (FR-M04: text gen → TTS → noise augmentation → pair registration). Its resource monitoring panel is relevant for training job management (FR-M02).

---

### 2.6 Comet ML

**What it is:** Commercial experiment management platform focused on quick setup and collaboration.

**Key features:**

| Feature | Details |
|---|---|
| Auto-Logging | Framework-specific automatic metric capture (PyTorch, HuggingFace, etc.) |
| Panels Marketplace | Library of reusable visualisation components |
| Comparison | Side-by-side code, hyperparameters, metrics, predictions diff |
| Reports | Interactive reports mixing text, panels, experiment data |
| System Metrics | GPU/CPU tracking per experiment |
| Model Registry | Model versioning with production monitoring |

**UI layout:**

- **Left sidebar**: Projects list
- **Project view**: Experiments table (sortable by any metric), Panels (charts), Notes
- **Experiment detail**: Charts, System Metrics, Code, Hyperparameters, Output, Assets

**Strengths:** Very quick setup (1 line), good collaboration/reporting features, panels marketplace for reusable visualisations.

**Limitations:** Commercial, less comprehensive model registry than MLflow.

**Relevance to AUSTIN-Lang:** Comet's interactive reports pattern is useful for generating shareable WER analysis summaries for stakeholders.

---

## 3. Cross-Platform Feature Matrix

| Capability | TensorBoard | W&B | MLflow | Neptune | ClearML | Comet |
|---|---|---|---|---|---|---|
| Metric Logging | Yes | Yes | Yes | Yes | Yes | Yes |
| Real-time Charts | Yes | Yes | Limited | Yes | Yes | Yes |
| Hyperparameter Comparison | Basic | Excellent | Good | Good | Good | Good |
| Model Registry | No | Yes | Excellent | Deprecated | Yes | Yes |
| Experiment Versioning | No | Yes | Yes | Yes | Yes | Yes |
| Training Job Management | No | Limited | Limited | No | Excellent | No |
| Pipeline Orchestration | No | No | Limited | No | Excellent | No |
| GPU/CPU Monitoring | Profiler only | Automatic | No | No | Automatic | Automatic |
| Dataset Management | No | Artifacts | Artifacts | Yes | Yes | Yes |
| Alerting / Regression | No | Yes | No | Anomaly detect | No | No |
| Collaboration / Sharing | No | Excellent | Good | Good | Good | Good |
| Open Source | Yes | No | Yes | No | Yes | No |
| HuggingFace Integration | Native | Native | Yes | Yes | Yes | Yes |

---

## 4. Common UI / Layout Patterns

Every platform converges on a similar layout structure:

### 4.1 Navigation (Left Sidebar)

All platforms use a persistent left sidebar for workspace-level navigation:

- **Projects / Workspaces** — top-level grouping of experiments
- **Experiments / Runs** — list of training runs within a project
- **Models** — model registry view
- **Datasets** — data management (where available)
- **Pipelines** — orchestration view (ClearML)

### 4.2 Runs Table (Main Content)

The central view is always a **tabular list of experiment runs** with:

- Sortable columns: run name, status (running/completed/failed), key metrics (loss, WER), hyperparameters, date, duration
- Checkbox selection for multi-run comparison
- Search/filter bar above the table
- Status badges (colour-coded: green=success, yellow=running, red=failed)
- Quick-action buttons: compare selected, delete, archive

### 4.3 Run Detail View

Clicking a run opens a detail view with tabbed sections:

- **Overview**: Summary card with key metrics, status, duration, commit hash
- **Charts / Metrics**: Interactive line charts of metrics over steps/epochs; multiple metrics overlaid
- **Hyperparameters / Config**: Table or JSON view of all training parameters
- **System / Resources**: GPU utilisation, memory, CPU charts (W&B, ClearML, Comet)
- **Artifacts / Outputs**: Model files, checkpoints, logs, generated data
- **Logs**: Raw stdout/stderr from the training job

### 4.4 Comparison View

When multiple runs are selected:

- **Overlay mode**: Same chart with multiple run curves in different colours
- **Diff table**: Side-by-side parameter/metric comparison highlighting differences
- **Parallel coordinates**: Each axis is a hyperparameter or metric; each run is a line connecting its values

### 4.5 Model Registry View

Platforms with model registries share a pattern:

- Model list → click model → version list
- Each version shows: creation date, source run, metrics at registration, stage/alias, download link
- Promote between stages (experimental → staging → production) via dropdown or drag

---

## 5. Current AUSTIN-Lang ML Tooling State

### What's Built

| Component | Status | Location |
|---|---|---|
| LoRA retraining pipeline | Working | `backend/retraining-pipeline/train.py` |
| 8-bit quantisation (bitsandbytes) | Working | `train.py` line ~50 |
| TensorBoard logging | Configured in Trainer args | `train.py` line 125: `report_to=["tensorboard"]` |
| MERaLiON dataset prep | Working | `backend/retraining-pipeline/meralion_test_prepper.py` |
| Adapter loading/swapping | Working | `backend/transcription-service-2/main.py` |
| Pre-trained adapter (meralion_v1) | Stored | `backend/retraining-pipeline/adapters/meralion_v1/` |
| WER/CER computation libraries | In requirements | `jiwer`, `evaluate` (not actively surfaced) |
| PII scrubbing module | Skeleton only | `backend/retraining-pipeline/pii_scrubbing.py` |

### What's Missing

| Component | Gap | Relevant Requirement |
|---|---|---|
| Metrics dashboard UI | No frontend for ML metrics | FR-M01 |
| Experiment tracking | No logged metadata for training runs | FR-M03 |
| Training job queue | No async job management; runs are manual scripts | FR-M02 |
| Hyperparameter config UI | Hardcoded in `train.py` | FR-M03 |
| Model version registry | Adapters in local folders, no version metadata | FR-M05 |
| Synthetic data pipeline | TTS integration and noise augmentation not built | FR-M04 |
| EWC / replay buffer | Documented in design doc, not in code | FR-M03 |
| Differential Privacy (Opacus) | Documented, not implemented | NFR-P03 |
| WER validation after retraining | No eval_strategy in training args | FR-M01 |

### What the Team Has Explicitly Asked For (from meeting notes)

- TensorBoard visualisation accessible from the UI (18 Mar 2026 meeting)
- A "Retrain" button for manual retraining (05 Mar 2026 meeting)
- WER metrics on the frontend, broken down by language (05 Mar 2026 meeting)
- Hardware monitoring during training — GPU vs CPU usage visibility (18 Mar 2026 meeting)
- Model comparison across versions (05 Mar 2026 meeting)

---

## 6. Recommendations for the AUSTIN-Lang ML Engineer Dashboard

Based on the platform analysis and the project's specific constraints (small team, academic timeline, existing TensorBoard integration), here is the recommended approach:

### 6.1 Dashboard Layout

Follow the universal sidebar + runs table pattern:

```
┌──────────────┬──────────────────────────────────────────────┐
│              │  Search / Filter bar                         │
│  SIDEBAR     ├──────────────────────────────────────────────┤
│              │                                              │
│  Metrics     │  RUNS TABLE                                  │
│  Training    │  ┌─────┬────────┬──────┬─────┬────┬───────┐ │
│  Experiments │  │ Name│ Status │ WER  │ LR  │ r  │ Date  │ │
│  Models      │  ├─────┼────────┼──────┼─────┼────┼───────┤ │
│  Synth Data  │  │ ... │ ✓ Done │ 0.18 │ 3e-4│ 16 │ 03/22 │ │
│  Dictionary  │  │ ... │ ● Run  │ 0.21 │ 1e-4│ 32 │ 03/23 │ │
│              │  └─────┴────────┴──────┴─────┴────┴───────┘ │
│              │                                              │
│              │  [Compare Selected]  [New Experiment]        │
└──────────────┴──────────────────────────────────────────────┘
```

### 6.2 Core Views (Priority Order)

**P0 — Must Have:**

1. **Metrics Overview** (FR-M01)
   - WER / CER summary cards (overall + by language)
   - Trend chart: WER over time across retraining runs
   - Embedded TensorBoard panel (iframe or proxy) for real-time training curves
   - Link: compare current model vs. baseline Whisper

2. **Training Jobs** (FR-M02)
   - "Retrain" button (sponsor-requested, highest visibility)
   - Jobs table: name, status badge (queued/running/completed/failed), start time, duration, triggering user
   - Active job detail: real-time loss chart, progress bar (epoch X/N), GPU utilisation gauge
   - Cancel/stop button for active jobs

3. **Experiment Runs Table** (FR-M03)
   - Tabular list of all past training runs
   - Columns: run name, status, WER (before/after), base model, LoRA rank, learning rate, dataset used, date, duration
   - Checkbox multi-select → "Compare" button
   - Click row → detail view with full config, metrics charts, artifacts

**P1 — Should Have:**

1. **Model Registry** (FR-M05)
   - List of model versions (base model + LoRA adapter pairs)
   - Each version: WER score, data zone tag (green/red), creation date, source experiment
   - "Deploy" button to push selected version to inference
   - "Compare Inference" button: run same audio through two model versions side-by-side

2. **Experiment Comparison View** (FR-M03)
   - Side-by-side metric overlay charts
   - Hyperparameter diff table (highlight differences)
   - Parallel coordinates plot for multi-dimensional comparison

**P2 — Nice to Have:**

1. **Synthetic Data Browser** (FR-M04)
   - Table of synthetic data pairs: source real pair, synthetic audio player, transcript preview, generation module version, date
   - "Generate" button to kick off synthetic data pipeline (text → TTS → noise → register)
   - Quality indicators: audio length, noise level, term coverage

2. **Financial Term Dictionary Manager** (supports FR-A04, FR-M04)
   - Searchable/filterable table of terms by category and language
   - Add/edit/delete terms
   - Usage stats: how often each term appears in transcripts, recognition accuracy per term

### 6.3 Key UI Patterns to Adopt

| Pattern | Inspired By | Application in AUSTIN-Lang |
|---|---|---|
| Runs table with sortable metric columns | W&B, MLflow, Comet | Experiment list view |
| Status badges (colour-coded) | All platforms | Training job status, model deployment state |
| Embedded TensorBoard | TensorBoard native | Real-time training curves in Metrics view |
| Parallel coordinates plot | W&B, MLflow, Neptune | Hyperparameter exploration in comparison view |
| Model version timeline | MLflow registry | Model Registry version history |
| Pipeline DAG visualisation | ClearML | Synthetic data generation pipeline status |
| System resource gauges | W&B, ClearML | GPU/memory utilisation during active training |
| Metric anomaly highlighting | Neptune | WER regression detection after retraining |

### 6.4 Integration Strategy

Given the existing stack (React frontend, FastAPI backend, TensorBoard in requirements):

1. **TensorBoard**: Expose via backend reverse proxy (`/api/tensorboard/`) and embed in an iframe within the Metrics view. TensorBoard is already configured in `train.py` — this is the fastest path to training visualisation.

2. **Experiment Metadata**: Store experiment configs and results in PostgreSQL (extend MODEL_WEIGHTS or add an EXPERIMENT_RUN entity). No need for a separate MLflow/W&B instance at this scale.

3. **Training Jobs**: Use a simple job queue (e.g., Celery + Redis, or even a database-backed queue) to manage async training. The backend triggers `train.py` with configured parameters and polls for completion.

4. **WER Computation**: `jiwer` is already in requirements. Compute WER server-side when user submits corrections, store in TRANSCRIPTION entity, and surface in the dashboard.

---

## 7. Sources

- [TensorBoard Documentation](https://www.tensorflow.org/tensorboard)
- [Weights & Biases Documentation](https://docs.wandb.ai/guides)
- [MLflow Documentation](https://mlflow.org/docs/latest/)
- [Neptune.ai Blog: Best ML Experiment Tracking Tools](https://neptune.ai/blog/best-ml-experiment-tracking-tools)
- [ClearML GitHub Repository](https://github.com/clearml/clearml)
- [Comet ML Documentation](https://www.comet.com/docs/v2/)
- [Microsoft Engineering Playbook: ML Observability](https://microsoft.github.io/code-with-engineering-playbook/observability/ml-observability/)
- AUSTIN-Lang Meeting Notes: 05 Mar 2026, 18 Mar 2026 (sponsor meetings)
- AUSTIN-Lang: `docs/ZZ ML Research/03 Designing an Online learning pipeline.md`
- AUSTIN-Lang: `docs/02 frontend/Project_Requirements_Document.md` (FR-M01–M05)
