# Model Leaderboard UI Research

Research into ML-competition leaderboard UI patterns (Kaggle, Codabench, HuggingFace, AIcrowd, Papers with Code) to inform the design of an internal model leaderboard for AUSTIN-Lang. Cross-references `ui_research.md` §6.2 (Experiment Runs Table) and `Project_Requirements_Document.md` FR-M03 (Custom Experiment Definition) and FR-M05 (Model Version Management).

The scope here is narrower than a public competition platform: engineers **within the same user group** rank their model iterations against a **shared dataset** that the group owns. It is a structured comparison, not a public contest.

---

## 1. Why a Leaderboard (Not Just Another Runs Table)

The existing `ui_research.md` already recommends a **runs table** (W&B / MLflow style) as the core experiment-tracking surface. A leaderboard is deliberately different:

| Dimension | Runs Table (per-engineer workspace) | Leaderboard (per-group, per-dataset) |
|---|---|---|
| **Sort key** | Arbitrary (timestamp, any metric) | Fixed primary metric (WER) with a canonical direction |
| **Scope** | One engineer's entire history | One engineer's **best** submission per dataset, side-by-side with peers |
| **Identity** | Run names and hyperparameter diffs | Engineer (or team) name, position, delta |
| **Emotional weight** | Neutral inventory | Competitive — position changes motivate iteration |
| **Reproducibility signal** | Code commit, config | Same + peer-visible ("this is what I claim beat yours") |

A leaderboard is the surface where an engineer sees their standing **relative to peers on a fixed problem**, not the surface where they analyse their own sweeps. Both surfaces are needed; conflating them produces either a cluttered leaderboard or a motivation-free runs list.

---

## 2. Platform-by-Platform Findings

### 2.1 Kaggle

**What it is:** The reference public ML competition platform. Most leaderboard conventions in the industry originated here.

**Leaderboard layout:**

| Element | Behaviour |
|---|---|
| Rank column | Fixed-width numeric; positions 1–3 show a **gold/silver/bronze medal** disc next to the number |
| Team/User column | Avatar + display name. Team icon distinguishes team submissions from solo |
| Score column | Right-aligned, tabular-numerals, bolded for the visible score |
| Entries count | Small muted badge (e.g., "52 entries") — signals effort invested |
| Last submission | Relative time ("3h ago") with absolute timestamp on hover |
| Delta (Δ) column | `▲ 4` / `▼ 2` / `—` relative to the previous reveal |

**Distinctive patterns:**

- **Public vs Private split.** A toggle at the top switches between the held-out public score (what competitors see live) and the private score (revealed at competition end). Drives the "shake-up" storytelling.
- **Sticky "Your Best Entry" row.** The current user's row is pinned at the bottom when it's not visible in the top-N range, and tinted in the main table when it is.
- **Score-over-time sparkline.** Per-user profile view shows a small line chart of the engineer's best-score trajectory. Much more useful than a single scalar for ML iteration.
- **Submission banner.** When a user hasn't submitted, a full-width CTA above the table says "Make your first submission". Disappears after the first submission.

**Relevance to AUSTIN-Lang:** The own-row highlight and the score-over-time sparkline are directly applicable. The public/private split is **not** — there is no held-out reveal mechanic in an internal workflow.

### 2.2 Codabench / CodaLab

**What it is:** Academic benchmark platform. Stronger on multi-phase / multi-track competitions than on polish.

**Distinctive patterns:**

- **Multi-phase tabs.** A competition can have `Development` / `Test` / `Final` phases, each with its own separate leaderboard. Implemented as top-of-page tabs.
- **Organizer-configurable columns.** A single competition often shows 10+ metric columns (horizontal scroll). Engineers toggle column visibility.
- **Multiple tracks via dropdown.** Switch task (e.g., English ASR ↔ Code-switch ASR) via a dropdown that rewires the entire table. This is effectively "leaderboard per (dataset, metric-set)".

**Relevance to AUSTIN-Lang:** The **dropdown-switched track** pattern is exactly what's needed here — one dropdown to pick the dataset, and the table recomputes. Multi-phase tabs and configurable columns are overkill for a small group.

### 2.3 HuggingFace Open LLM Leaderboard

**What it is:** A Gradio-powered Space ranking open LLMs across several benchmarks (ARC, HellaSwag, MMLU, etc.).

**Distinctive patterns:**

- **Left-sidebar filters.** Unusual for leaderboards — filters include model size (buckets), model type (base / fine-tuned / instruction-tuned), precision (fp16 / int8 / int4), submission date. Unlike a column sort, these **hide** rows that don't match.
- **Model-family badges.** Small colored chips on the model name indicating lineage (base vs. fine-tuned). Lightweight, readable.
- **No "team" concept.** All entries are org/user handles — fine for an open leaderboard, not for our internal use where engineer identity matters.
- **Aggregate score as primary, sub-benchmarks as columns.** Every sub-benchmark uses identical numeric formatting so the eye can compare across columns without re-calibrating.

**Relevance to AUSTIN-Lang:** The model-family badge pattern is worth stealing — engineers iterate on multiple base models (Whisper-large-v3, MERaLiON, wav2vec2) and a badge disambiguates lineage in one glance.

### 2.4 AIcrowd

**What it is:** Kaggle-like platform with stronger community / gamification features.

**Distinctive patterns:**

- **XP points and level badges** on profile avatars.
- **Discussion-thread count inline** next to each team's name.
- **"Community" tab separate from official standings** — unofficial submissions that don't affect ranking.

**Relevance to AUSTIN-Lang:** Gamification is overkill for an internal ~5-engineer group. Skip. The separate "community / official" split is similarly irrelevant; every submission here is official.

### 2.5 Papers with Code

**What it is:** Benchmark tables indexed by paper — not really a submissions leaderboard, but influential.

**Distinctive patterns:**

- **Paper link** alongside each entry.
- **Code-availability badge** (green check / red X).
- **Year column** for the paper.
- **SOTA row** bolded with a small crown/star.

**Relevance to AUSTIN-Lang:** The code-availability / reproducibility signal translates well — we can surface "training notebook linked" / "adapter checkpoint stored" / "config reproducible" as small icons per row.

---

## 3. Recurring Patterns Across Platforms

Every platform that has a leaderboard converges on the same spine:

| Pattern | Presence | Notes |
|---|---|---|
| Rank leftmost, fixed-width | Universal | Always numeric; medal is additive, not a replacement |
| Primary metric right-aligned, tabular numerals | Universal | Monospaced numeric fonts so columns align |
| Secondary metrics as extra columns, lower-contrast | Universal | Readable but doesn't compete with primary |
| Relative timestamp, absolute on hover | Universal | "3h ago" scales better than dates when most activity is recent |
| Own-row highlight + sticky "your best" card | Kaggle, AIcrowd | Strongest motivator when outside top-N |
| Row-click → detail side drawer or page | Universal | Config, submission file, metric breakdown |
| Delta (▲ / ▼ / —) column | Kaggle, AIcrowd | Scoped to "since last reveal" or "since last visit" |
| Sticky "Submit" CTA top-right | Universal | Primary action on the page, never buried |
| Crown / medal for top ranks | Kaggle, PwC, AIcrowd | Gold-silver-bronze for big leaderboards; single crown for small ones |

---

## 4. What's Overkill for an Internal Small-Group Leaderboard

With ≤10 engineers per group on a fixed dataset, several big-platform patterns add visual noise without benefit:

| Pattern | Why skip |
|---|---|
| Gold/silver/bronze medals for top 3 | Noisy when there are 5 rows; a single crown on rank 1 is enough |
| Public/private score split | No held-out-reveal mechanic internally |
| Team vs. solo distinction | Every entry is an individual engineer in one group |
| Timeframe tabs (All / Week / Today) | Sparse submissions make "all time" the only useful view |
| Search box | 5–10 rows don't need search |
| XP / levels / badges | Gamification mismatched with internal engineering culture |
| Discussion threads inline | Wrong surface — use the existing review / comments system |

---

## 5. Recommended UI for AUSTIN-Lang

### 5.1 Navigation

Sits alongside `Training Jobs` and `Datasets` under the `engineer`/`admin`-only `NAV_TOOLS` section in `SidebarShell.jsx`. Route: `/leaderboard`.

### 5.2 Page Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│  BREADCRUMB: Engineering / Leaderboard                                │
│                                                                        │
│  LEADERBOARD                                 [ Dataset ▾ ] [+ SUBMIT] │
│  4 engineers · 17 submissions · locked to engineer-file-org group     │
│  ───────────────────────────────────────────────────────────────────  │
│                                                                        │
│  ┌─ YOUR BEST ────────────────────────────────────────────────────┐   │
│  │ #3  •  WER 8.1%  •  CER 4.2%  •  2 submissions  •  3h ago      │   │
│  │ Δ ▲ 1 since last submission                       [VIEW RUN →] │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  SORT: [ WER ▾ lower is better ]    FILTER: [ Base model ▾ ]          │
│  ─────────────────────────────────────────────────────────────────    │
│  #  ENGINEER         MODEL              WER ↓   CER   RTF   Δ    LAST │
│  ♛1 Priya Rangan     whisper-lg + lora  7.4%   3.9%  0.41   —    2h  │
│  2  Andreas Keller   meralion v2        7.9%   4.1%  0.38   ▲1   1d  │
│  3  You              whisper-lg + lora  8.1%   4.2%  0.44   ▲1   3h  │
│  4  James Whitmore   wav2vec2-xls-r     9.3%   5.0%  0.29   ▼2   4d  │
│  ─────────────────────────────────────────────────────────────────    │
│                                                                        │
│  (Row click → right-side drawer: full config, metric breakdown,       │
│   per-utterance worst examples with audio playback, reproducibility   │
│   badges.)                                                             │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.3 Columns

| Column | Width | Notes |
|---|---|---|
| `#` (rank) | 32px | Fixed. Crown glyph on rank 1 only. |
| Engineer | flex | Avatar + name. "You" badge on the current user's row. |
| Model | flex | Short model lineage string + a family badge (`whisper`, `meralion`, `wav2vec2`). |
| WER ↓ | 80px | Primary, right-aligned, tabular-nums, bolded. Header shows `↓` to mark lower-is-better. |
| CER | 64px | Secondary, lower contrast. |
| RTF | 64px | Real-time factor. Tooltip on header hover. |
| Δ | 40px | `▲n` green / `▼n` red / `—`. Scoped to "since last submission by any engineer on this dataset". |
| Last run | 80px | Relative time; absolute on hover. |

### 5.4 Patterns to Adopt

| Pattern | Source | Implementation |
|---|---|---|
| Fixed primary metric with direction indicator | Kaggle, PwC | `WER ↓` in header; sort locked unless user explicitly re-sorts |
| Dataset switcher as a dropdown that recomputes the table | Codabench | Top-right dropdown; URL query param `?dataset=<id>` |
| Own-row tint + sticky "Your best" card | Kaggle | `rgba(178, 1, 0, 0.05)` row tint matching sidebar active state |
| Crown on rank 1 (single, not full medal set) | PwC | Small gold crown; no silver/bronze in a 5-row table |
| Delta column scoped to "since your last submission" | Kaggle | Computed from the previous snapshot stored per-user |
| Row click → right-side drawer | Codabench (modal), W&B (drawer) | Drawer fits the dashboard shell better than a modal |
| Reproducibility badges | PwC | Small icons: `config` (training config stored), `ckpt` (adapter checkpoint), `notebook` (training notebook linked) |
| Model-family badge | HF | Small chip: `whisper`, `meralion`, `wav2vec2`, `custom` |
| Score-over-time sparkline | Kaggle profiles | Per-engineer row, small inline sparkline of their last N submissions |

### 5.5 Patterns Deliberately Skipped

- **Medal set (gold/silver/bronze).** Rank 1 gets a crown; rest are plain numbers.
- **Public/private toggle.** No held-out reveal.
- **Team column.** Everyone is an individual; the "same user group" framing handles scope.
- **Search box.** ≤10 rows per dataset.
- **Timeframe tabs.** Single `All time` view; filter by base model handles slicing.
- **Gamification (XP, levels, streaks).**

### 5.6 Group Scoping

The leaderboard is scoped to the current user's group (`getGroupIdForRole(user.role)` — already used by the folders service). For `engineer` role → `engineer-file-org` group. Only submissions by engineers in the same group appear. Dataset options are likewise filtered to datasets owned by or shared with that group.

The page is gated to `engineer` and `admin` roles (same gate as `Training Jobs` in `SidebarShell.jsx`).

### 5.7 Submission Flow (Out of Scope for This UI Pass)

The `+ SUBMIT` CTA routes to a future submission form (`/leaderboard/submit`) where an engineer uploads an adapter checkpoint + config and points at a dataset. For the current UI pass, the button is rendered but the destination is stubbed — scoring would be computed server-side once the backend retraining pipeline is wired.

---

## 6. Implementation Plan

### 6.1 Files to Add / Modify

| File | Purpose |
|---|---|
| `src/services/mock_data-leaderboard.js` | Mock submissions per (engineer, dataset). Includes rank, WER/CER/RTF, sparkline trajectory, delta vs. previous, reproducibility badges |
| `src/app/(dashboard)/leaderboard/page.jsx` | The leaderboard screen itself |
| `src/app/(dashboard)/leaderboard/SubmissionDrawer.jsx` | Right-side drawer rendered on row click |
| `src/app/(dashboard)/components/SidebarShell.jsx` | Add `Leaderboard` entry to `NAV_TOOLS` with a medal icon |

### 6.2 Mock Data Shape

```js
{
  datasetId: 'mixed',
  submissions: [
    {
      id: 'sub-07',
      engineerId: 'u2',
      engineerName: 'Andreas Keller',
      modelName: 'meralion v2',
      baseFamily: 'meralion',
      wer: 0.079,
      cer: 0.041,
      rtf: 0.38,
      submissionCount: 4,
      submittedAt: '2026-04-16T09:11:00Z',
      deltaRank: 1, // position change since last submission on this dataset
      trajectory: [0.132, 0.11, 0.094, 0.079], // best WER over submissions
      reproducibility: { config: true, checkpoint: true, notebook: false },
    },
    // ...
  ],
}
```

### 6.3 Wiring to the Rest of the App

- The dataset switcher uses the existing `SAMPLED_DATASET_FOLDERS` catalogue from `sampled-datasets.js` (same source as `/datasets`).
- Engineer identities come from `mock_data-users.js` (current user from `api.js` `getCurrentUser`).
- Group scoping goes through `getGroupIdForRole` in `folders.js` — same pattern already used by the metric-details page to gate edits.

### 6.4 Out of Scope (Future Work)

- **Backend-computed scores.** Presently mocked. A real `POST /leaderboard/submissions` would accept an adapter + dataset ref, queue an evaluation job, compute WER/CER/RTF against the dataset's held-out split, and write a submission row.
- **Submission form.** Stubbed CTA in this pass.
- **Score history per-engineer view.** The sparkline is on the row; a full history view (like Kaggle's profile page) is a separate screen.
- **Cross-dataset aggregate.** An "overall standing across all datasets" view is meaningful once there are multiple datasets with multiple submissions each — premature now.

---

## 7. Sources

- [Kaggle — How Competitions Work](https://www.kaggle.com/docs/competitions)
- [HuggingFace Open LLM Leaderboard](https://huggingface.co/spaces/HuggingFaceH4/open_llm_leaderboard)
- [Codabench — Quick Start](https://github.com/codalab/codabench)
- [AIcrowd Challenges](https://www.aicrowd.com/challenges)
- [Papers with Code — Methodology](https://paperswithcode.com/about)
- AUSTIN-Lang: [ui_research.md](./ui_research.md) — baseline runs-table and comparison patterns
- AUSTIN-Lang: [Project_Requirements_Document.md](./Project_Requirements_Document.md) — FR-M03, FR-M05
