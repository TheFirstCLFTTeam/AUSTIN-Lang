# Custom Metrics Pipeline — User-Uploaded Python Scripts

_Last updated: 2026-04-28 (branch `ui_enhancement`)_

Pre-build spec for the "control-user uploads a `.py` file → it becomes a live dashboard metric" feature. Today the FE has a working dialog that captures the script, persists it to `localStorage`, and renders it on the configure page; the schema in `platform.db` carries a `python_script` column on `metric`; a brief mention exists in `02 frontend/metrics_research/metrics_dashboard.md` lines 16-19. **What's missing is everything between those points** — the API surface, server-side persistence, and the actual sandboxed execution path that turns a user-uploaded function into a value that lands on the dashboard.

Sibling reading:
- [`../06 server/metrics-service-module.md`](../06%20server/metrics-service-module.md) — the existing strategy registry pattern this extends.
- [`../02 frontend/metrics_research/metrics_dashboard.md`](../02%20frontend/metrics_research/metrics_dashboard.md) §"Custom word error metrics" — the original product ask.
- [`backend_integration_status.md`](backend_integration_status.md) §3.1 — broader metrics workstream.
- [`fl-dp-risk-assessment.md`](fl-dp-risk-assessment.md) — the security baseline this pipeline must not undermine.

---

## 1. Goals & non-goals

### Goals

1. **Control-user can upload a `.py` file** through `/dashboard/configure` and have it appear as a runnable metric on the dashboard alongside the built-in ones (WER, CER, F1, etc.).
2. **The script runs at evaluation time** — when `POST /evaluations/run` fires, every selected custom metric is executed against the same eval samples as the built-in strategies, and the result lands in `evaluation_metric` like any other.
3. **Same dashboard render path** — once the value is in `evaluation_metric`, the existing `mergeMetricsWithLive` layer picks it up by `id`. Zero FE changes after slice 1.
4. **Per-script audit trail** — who uploaded it, when, what script content (SHA-256), what version is currently active, when was the last successful run, when did it last fail.
5. **No way for a user script to compromise the host.** Sandboxing is the load-bearing requirement, not a nice-to-have. See §6.

### Non-goals

- Not arbitrary code execution as a service. The script must conform to one fixed function signature; anything else fails validation at upload time.
- Not a notebook environment. No interactive REPL, no plotting, no I/O outside the framework's calls.
- Not a way to bypass auth. Custom metrics still respect the same role gates as built-in metric submissions (`/evaluations/run` already requires authentication).
- Not real-time. A custom metric runs at the same cadence as built-in ones — once per `POST /evaluations/run`. No on-edit recompute.

---

## 2. State of play

### What's already built (FE)

`frontend/src/app/(dashboard)/dashboard/configure/page.jsx`:
- `AddMetricDialog` accepts `.py` upload, extracts the docstring as a default description, infers the display name from filename.
- `addCustomMetric()` from `services/metrics-config.js` writes `{ id: custom_<ts>, name, shortDescription, description, pythonScript, custom: true, filename }` into `localStorage` key `metrics:custom`.
- `updateMetricMetadata()` patches name / description / target / pythonScript via `localStorage` key `metrics:overrides`. Stamps `dateRevised`.
- `getAllMetrics()` merges built-in (`AVAILABLE_METRICS` from `mock_data-dashboard.js`) + custom (`metrics:custom` localStorage) + overrides (`metrics:overrides` localStorage).

The dialog **works** — you can upload a script and see it on the configure page. **It just never reaches the backend.**

### What's already built (BE)

`database(FE)/schema_platform.sql`:
```sql
CREATE TABLE metric (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    short_description  TEXT,
    description        TEXT,
    python_script      TEXT,        -- exists, unused
    target             REAL,
    date_revised       TEXT,
    is_custom          INTEGER NOT NULL DEFAULT 0,
    filename           TEXT
);
```

`backend/metrics_service/strategies/` has the strategy registry — concrete classes register at import time, runner dispatches to all of them in one pass. **No path for runtime registration of a user script.**

### What's mentioned in docs

`02 frontend/metrics_research/metrics_dashboard.md` §"Custom word error metrics":

> we should facilitate for ML engineers to be able to code up their own formulas of metrics to assess their model by. This should just be a python function that they can request to the control member of their user group to create. It will be as simple as having the control user create a new metric, submitting a python script with a single defined function for how the metric should be made with these requirements:
> - 2 pandas dataframes, the raw transcript and edited transcript
> - a single numpy float of up to 3 decimal places.

That's the entire design surface in the docs prior to this file.

---

## 3. Contract

A user-uploaded script must define exactly one top-level function with this signature:

```python
import pandas as pd
import numpy as np

def compute(predictions: pd.DataFrame, references: pd.DataFrame) -> float:
    """One sentence describing what this metric measures.

    Args:
        predictions: model output. Columns: segment_id, audio_file_id, start, end, text.
        references:  human-corrected ground truth, same columns.

    Returns:
        A single float, expected range and direction documented per metric.
    """
    ...
    return float(score)
```

**Why DataFrames, not the existing `MetricStrategy.compute(samples)` shape:**
- Matches the original product ask in `metrics_research/metrics_dashboard.md` (control users author in pandas, not in a custom Sample iterator).
- Pandas is the lingua franca for ML engineers — they don't want to learn our `Sample` dataclass.
- Allows corpus-wide ops (groupby segment, rolling stats, joins on file id) that don't compose well over a per-sample iterator.

**Adapter:** the runner converts the `samples: Iterable[Sample]` it gets from `MetricsRunner` into two DataFrames before calling the user function. Built-in strategies stay on the `Sample` iterator (zero change); custom strategies see DataFrames. Two contracts, one registry.

**Validation at upload time** (slice 1):
1. Parse the script with `ast.parse()`. Reject if it doesn't parse.
2. Confirm exactly one top-level `def compute(...)` with two positional parameters.
3. Static-walk the AST: reject `import os`, `import subprocess`, `import sys`, `__import__`, `open()`, `exec()`, `eval()`, `compile()`, `globals()`, attribute access on `__builtins__`. Whitelist: `pandas`, `numpy`, `math`, `re`, `statistics`, `collections`, `itertools`, `functools`, `typing`, `dataclasses`. The whitelist is the **enforcement boundary**, not just a doc — the runtime sandbox enforces it again (§6).
4. Smoke-test the script against a tiny canned `(predictions_df, references_df)` fixture. Reject if it throws, returns non-numeric, or returns NaN/inf. Record the result so we can show "smoke-test value: 0.847" on the configure page as proof it ran.

The whitelist is intentionally narrow. `requests`, `urllib`, `socket`, `pickle`, `marshal`, `ctypes` — all denied. Custom metrics that need exotic dependencies are out of scope; the answer is "submit a PR adding a built-in strategy."

---

## 4. Persistence + lifecycle

`metric` table already has the columns. Promote them from "schema-exists, code-doesn't-touch" to "actually used":

| Column | Set by |
|---|---|
| `id` | client-side `custom_<ts>` (slice 1); `slug` derived from name (slice 2 cleanup) |
| `name`, `short_description`, `description` | upload dialog |
| `python_script` | upload dialog (full source, ≤256 KB) |
| `is_custom` | always `1` for user-uploaded; `0` for built-in |
| `filename` | upload dialog |
| `target` | configure page edit |
| `date_revised` | server-stamped on every patch |

New columns to add (one migration: `0003_add_custom_metric_audit.sql`):

```sql
ALTER TABLE metric ADD COLUMN script_sha256       TEXT;       -- of python_script
ALTER TABLE metric ADD COLUMN submitted_by        TEXT;       -- users.db user.id
ALTER TABLE metric ADD COLUMN submitted_at        TEXT;
ALTER TABLE metric ADD COLUMN smoke_test_value    REAL;       -- nullable; the §3 step 4 result
ALTER TABLE metric ADD COLUMN smoke_test_at       TEXT;
ALTER TABLE metric ADD COLUMN last_run_at         TEXT;
ALTER TABLE metric ADD COLUMN last_run_failed     INTEGER;    -- 0/1, NULL = never run
ALTER TABLE metric ADD COLUMN last_run_failure    TEXT;       -- exception message, redacted
ALTER TABLE metric ADD COLUMN status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled','retired'));
```

**Versioning policy.** When a control user *edits* a script, write the new version to `metric.python_script` and recompute `script_sha256`. **Don't keep prior versions in this table** — keep them in `metric_script_history` (one row per submitted version, append-only) so the audit trail is intact and `evaluation_metric` rows from before the edit can be traced back to the script that produced them. Each `evaluation_metric` row already carries `computed_at`; pair that with `metric_script_history.applied_from` to know which version ran.

```sql
CREATE TABLE metric_script_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_id       TEXT NOT NULL REFERENCES metric(id) ON DELETE CASCADE,
    script_sha256   TEXT NOT NULL,
    python_script   TEXT NOT NULL,
    submitted_by    TEXT,
    submitted_at    TEXT NOT NULL DEFAULT (datetime('now')),
    notes           TEXT
);
CREATE INDEX ix_metric_script_history_metric ON metric_script_history(metric_id, submitted_at DESC);
```

`status='disabled'` means "skip on `/evaluations/run`" without deleting history. `status='retired'` is final (admin removed it from the catalogue); old `evaluation_metric` rows still resolve to the metric for display.

---

## 5. HTTP API additions

Lives on **`metrics-service`** (port 8006), not in a new service. The metric is a metric — adding endpoints to the service that owns metric storage is the right home.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/metrics/catalogue` | full list (built-in + custom + audit fields) for the configure page | any authenticated |
| POST | `/metrics/custom` | upload a new custom metric (validates per §3, smoke-tests, persists) | control user (engineer / admin role) |
| PATCH | `/metrics/custom/{id}` | edit name / description / target / script (script-edit appends to history) | control user |
| POST | `/metrics/custom/{id}/disable` | mark `status='disabled'` (and the symmetric `/enable`) | control user |
| DELETE | `/metrics/custom/{id}` | mark `status='retired'` (soft-delete; `evaluation_metric` rows stay) | control user |
| GET | `/metrics/custom/{id}/history` | list `metric_script_history` rows | control user |
| POST | `/metrics/custom/{id}/smoke-test` | re-run the §3 step 4 fixture against the current script | control user |

FE proxy under `frontend/src/app/api/metrics/custom/` mirrors these. `metrics-config.js` swaps from `localStorage` reads to fetches against `/metrics/catalogue`; `addCustomMetric()` becomes a `POST` instead of a localStorage write. The dialog at `dashboard/configure/page.jsx` is mostly unchanged — it already posts a JSON body, just to a different endpoint.

**localStorage stays as a fallback** for offline / mock-mode flows: when `NEXT_PUBLIC_MOCK_API=true`, the existing localStorage path is used. Real-mode fetches the catalogue + persists server-side.

---

## 6. Sandboxing — the load-bearing question

Running arbitrary user Python on a shared server is a famous foot-gun. Three honest options, in order of "how isolated":

### Option A — `RestrictedPython` + AST whitelist

[RestrictedPython](https://restrictedpython.readthedocs.io/) compiles Python source with a hardened bytecode that blocks `__import__`, attribute access on dunders, and most reflection. Combined with our AST whitelist (§3 step 3), it covers a large fraction of escape attempts. **Same process, same Python interpreter** — fast, zero new infra, but a single bug in RestrictedPython is a full-host compromise.

**Verdict:** the bare minimum. Useful as the first layer, not enough on its own.

### Option B — Subprocess with hard resource limits

`subprocess.Popen([sys.executable, "-I", "-S", "runner.py"])` with the script piped in via stdin, run as an unprivileged user, with `setrlimit` capping CPU (10 s), memory (512 MB), file descriptors (8), no network namespace. The runner.py uses RestrictedPython internally and only exposes `pandas`, `numpy`, `math`, etc.

**Pros:** real isolation — a SIGSEGV / OOM / runaway loop kills the subprocess only. CPU limit is the primary defence against `while True: pass`.

**Cons:** ~50ms per metric per evaluation for subprocess spawn. Acceptable when the eval has 10 metrics and runs once per training round; not acceptable for high-frequency operational metrics.

**Verdict:** the minimum I'd ship to prod.

### Option C — Container-per-script (gVisor / Firecracker / Docker exec)

Each run executes in its own short-lived container with no network and a tmpfs filesystem. Strongest isolation; standard play for "run untrusted code as a service" (e.g. Judge0, Replit).

**Pros:** kernel-level isolation. A hostile user owning the metric runtime can't reach the host or other containers.

**Cons:** ~500ms cold-start per metric (Docker), ~50ms (Firecracker). Operational overhead — image management, runtime image updates, root daemon (Docker) or KVM (Firecracker). Big lift.

**Verdict:** what we'd build if AUSTIN-Lang ever exposes custom metrics outside the trusted control-user circle. For the current "internal control user authoring scripts for their own group" model, B is sufficient.

### Recommendation

**Slice 1 → Option B, Option A internally.** Subprocess isolation with `setrlimit` + RestrictedPython inside the subprocess. Reasoning:
- Threat model: the control-user is authenticated and inside the org. Defence is against accidental footguns and supply-chain (a malicious npm-style package they copy-paste) more than nation-state actors.
- Performance budget: eval runs are minutes-long; 50 ms per metric is negligible.
- Operational cost: zero new infra (Python's stdlib has `subprocess`, `resource`, `signal`).

**If Option C ever becomes warranted** (custom metrics exposed beyond the org, or internal threat model changes), the subprocess wrapper becomes a `docker exec` wrapper — caller signature unchanged.

### What gets denied regardless

Even inside the sandbox, the script does not have:
- Network access (the subprocess runs in a network namespace with no routes).
- Filesystem access outside `/tmp/<run-id>/` (pre-mounted tmpfs, 64 MB).
- `os`, `subprocess`, `sys`, `socket`, `urllib`, `requests`, `pickle`, `marshal`, `ctypes`, `multiprocessing`, `threading` (module-level whitelist).
- More than 10 s wall-clock or 512 MB RSS (`setrlimit`).

---

## 7. Integration with the existing strategy registry

The runtime path:

```
POST /evaluations/run
  → MetricsRunner(["wer", "f1", "custom_1730238291", ...])
  → For each strategy name:
      - if it's a registered MetricStrategy class → call .compute(samples)
      - if it's a row in metric WHERE is_custom=1 AND status='active' →
          1. fetch metric.python_script
          2. spawn the sandbox subprocess with the script + fixture-shaped DFs
          3. read the float from the subprocess stdout
          4. wrap it in a StrategyResult(strategy_name=metric.id, value=float, sample_count=…)
      - else → 400 "unknown strategy"
  → MetricsStore.record_evaluation(...)
```

The runner doesn't need a new dispatch path — `register_strategy` gets a sibling `register_custom_strategy(metric_row)` that wraps the row in a tiny class implementing `MetricStrategy` whose `.compute()` shells out. That class is **constructed per-run, not imported once**, so a freshly-uploaded script is picked up without restarting the service.

```python
class _CustomScriptStrategy(MetricStrategy):
    def __init__(self, metric_row):
        self.name = metric_row["id"]
        self._script = metric_row["python_script"]
        self._sha = metric_row["script_sha256"]

    def compute(self, samples):
        preds_df, refs_df = _samples_to_dataframes(samples)
        try:
            value = run_in_sandbox(self._script, preds_df, refs_df, timeout_s=10)
        except SandboxError as exc:
            _record_run_failure(self.name, exc)
            return StrategyResult(strategy_name=self.name, value=float("nan"), breakdown={"error": str(exc)})
        _record_run_success(self.name, value)
        return StrategyResult(strategy_name=self.name, value=value, sample_count=len(samples))
```

`run_in_sandbox` lives in `metrics_service/sandbox.py`. Single function, well-tested, the **only** place the subprocess lifecycle is owned.

---

## 8. Failure modes the design has to survive

| Failure | What we do |
|---|---|
| Script raises an exception | `last_run_failed=1`, `last_run_failure=str(exc)[:512]`. Strategy returns `value=NaN`. Dashboard merge layer treats NaN as "no data" and falls back to the prior series point (existing behaviour). Admin sees the failure on the configure page. |
| Script times out (>10 s) | SIGKILL the subprocess. Same NaN + log path as above. |
| Script returns non-float | Sandbox runner refuses to write to stdout; recorded as failure. |
| Script returns NaN/inf | Recorded as failure (we choose to treat these as bugs, not valid signals). |
| Script consumes all 512 MB | OOM-killed by the kernel. Same NaN + log path. |
| Two evaluations run the same custom metric concurrently | Each spawns its own subprocess; they don't share state. Fine. |
| Control user edits the script mid-evaluation | The currently-running eval uses the script that was loaded at run start (we read `python_script` once at the top of `MetricsRunner.run()`). Subsequent evals pick up the new version. |
| Script's smoke test passes but the real eval fails on edge data | First failure → flag, surface on configure page, keep running other metrics. We do not auto-disable on first failure — flaky metrics shouldn't lose a week of dashboard history because of one bad sample. Auto-disable after **5 consecutive failures**. |

---

## 9. Slice breakdown

Five slices, ~3-4 days. Mergeable independently except where noted.

| # | Slice | What lands | Effort | Blocks |
|---|-------|------------|--------|--------|
| **1** | Persistence + API surface | Migration `0003_add_custom_metric_audit.sql`, `metric` + `metric_script_history` writes, `/metrics/catalogue` + `POST /metrics/custom` + `PATCH /metrics/custom/{id}`. AST validator (§3 steps 1-3). FE `metrics-config.js` swap from localStorage to fetch when `!MOCK_API`. **No execution yet** — uploads land but the script doesn't run. | 1d | — |
| **2** | Sandbox runtime | `metrics_service/sandbox.py` — subprocess + RestrictedPython + `setrlimit` + network namespace + tmpfs. Smoke-test endpoint (§5 row 6). Dispatch in `MetricsRunner` for `is_custom=1` rows. | 1d | needs slice 1's persistence |
| **3** | Run lifecycle hooks | `last_run_at` / `last_run_failed` / `last_run_failure` writes from the dispatcher. 5-consecutive-failures auto-disable. Surface on configure page. | 0.5d | needs slice 2 |
| **4** | Versioning UI | `GET /metrics/custom/{id}/history`, "View history" button on configure page, "Revert to vN" affordance. | 0.5d | needs slice 1 |
| **5** | Tests + docs + threat-model walkthrough | Pytest cases for (a) AST rejection of disallowed imports, (b) sandbox subprocess kills on timeout / OOM / crash, (c) round-trip a known-good script and assert the value lands in `evaluation_metric`. README in `metrics_service/` documenting the contract. Update of `metrics_research/metrics_dashboard.md` to point at this doc. | 1d | needs slices 1-2 |

**Out of slice 1 explicitly:** Option C container sandboxing, multi-version A/B (running two script versions in parallel for comparison), per-user-group quotas (max N custom metrics per group), Web UI for editing the script in-browser (today it's upload-only — changes require a new file upload).

---

## 10. Open questions

1. **Pandas DataFrame shape — exact columns?** I proposed `(segment_id, audio_file_id, start, end, text)`. The existing `Sample` carries less; the existing `transcript_segment` carries more. Concrete decision needed before slice 1 — once published, scripts in the wild assume this shape.

2. **Script size cap.** I suggested 256 KB. Bigger than that and we're either fighting an XZ-style supply-chain attack or someone vendored numpy. Confirm.

3. **Whitelist evolution.** `pandas`, `numpy`, `math`, `re`, `statistics`, `collections`, `itertools`, `functools`, `typing`, `dataclasses`. Anyone want `scipy`, `sklearn`? Adding them is a one-liner on the whitelist + a Docker image rebuild. Likely yes for `scipy.stats`. Defer to a "second pass" once we see real submissions.

4. **What "failure" looks like to the FE.** Do we render the metric card with a "💥 Last run failed" badge and the prior value, or hide the card entirely? Recommend the badge — disappearing data is a worse UX than visible-but-flagged data.

5. **Auth — is "control user" enforced server-side?** Today `metrics-config.js` doesn't check the role. Slice 1 must add a role gate on `POST /metrics/custom` (per the existing `requireOwnerOrRole` helper). What roles count as "control user" — `admin` only, or also `engineer`? **Recommend `admin` + `engineer`** since the user said "control user engineer."

6. **Does a custom metric appear on the leaderboard?** §3.2 of the integration status will eventually have a leaderboard endpoint joining `model_evaluation` ⇄ `evaluation_metric`. Custom metrics produce `evaluation_metric` rows like built-ins, so they'd auto-flow. Confirm that's the intent — vs. "custom metrics show on the dashboard but not on the cross-engineer leaderboard."

7. **Snapshot reproducibility.** When eval `E` ran custom metric `M` at version `V`, and `M` is later edited to `V+1`, the value in `evaluation_metric` is from `V`. The configure page should show "this row's value used script v{N}" (joined to `metric_script_history`). Recommend yes — full audit story.

8. **How does this interact with the financial-terms dictionary?** A custom metric could legitimately want to consume the dictionary's snapshot. Two options: (a) inject `dictionary_snapshot: List[str]` as an optional third positional arg to `compute()`; (b) make the dictionary snapshot available as a CSV in the sandbox's `/tmp/` and let the script read it. **Recommend (a)** — typed, no I/O, explicit dependency. Defer to slice 2 of *this* workstream once the dictionary microservice ships.

---

## 11. Files added / modified

**New:**
- `database(FE)/seed/migrations/platform/0003_add_custom_metric_audit.sql`
- `backend/metrics_service/sandbox.py`
- `backend/metrics_service/custom_metrics.py` — registry-side glue (`_CustomScriptStrategy`, history writes, dispatch)
- `backend/metrics_service/tests/test_sandbox.py`
- `backend/metrics_service/tests/test_custom_metrics.py`
- `frontend/src/app/api/metrics/custom/route.js`
- `frontend/src/app/api/metrics/custom/[id]/route.js`
- `frontend/src/app/api/metrics/custom/[id]/history/route.js`
- `frontend/src/app/api/metrics/custom/[id]/smoke-test/route.js`
- `frontend/src/app/api/metrics/catalogue/route.js`

**Modified:**
- `database(FE)/schema_platform.sql` — fresh-seed parity for the new audit columns + the history table.
- `backend/metrics_service/main.py` — register the new endpoints.
- `backend/metrics_service/strategies/runner.py` — dispatch path that resolves `is_custom=1` ids to `_CustomScriptStrategy`.
- `backend/metrics_service/storage.py` — new helpers: `record_metric_run_success`, `record_metric_run_failure`, `auto_disable_after_threshold`.
- `backend/metrics_service/requirements.txt` — add `RestrictedPython`.
- `frontend/src/services/metrics-config.js` — swap localStorage reads/writes for fetch in real mode; keep localStorage for mock mode.
- `frontend/src/app/(dashboard)/dashboard/configure/page.jsx` — render audit fields (`last_run_at`, `last_run_failed`, `smoke_test_value`); "View history" button; "Disable" toggle.
- `frontend/src/services/mock_data-metrics-metadata.js` — comment update pointing at the real persistence model.
- `Docs/02 frontend/metrics_research/metrics_dashboard.md` §"Custom word error metrics" — replace the brief mention with a pointer to this doc.

**Touched but not changed (reference only):**
- `frontend/src/services/mock_data-dashboard.js` — `pythonScript` strings already there for built-ins.
- `frontend/src/services/metrics.js` — same-origin proxy already in place; new endpoints reuse the helpers.

---

## 12. References

- **RestrictedPython** — <https://restrictedpython.readthedocs.io/> — bytecode-level Python sandboxing, the in-process layer of Option B.
- **`resource.setrlimit`** — <https://docs.python.org/3/library/resource.html> — the CPU/memory cap mechanism.
- **Linux network namespaces** — `unshare -n` to drop the subprocess into an empty namespace, no routes, no DNS.
- **Judge0 / 0xCC architecture posts** — public-facing "run untrusted code" services. Useful reading for the threat model even though we're internal-only.
- **CPython sandbox history** — Brett Cannon, "PEP 551: Security transparency in the Python runtime." Background on why "just use `RestrictedPython`" alone isn't enough.
- **The existing `_strip_published_artifacts` pattern** in `backend/retraining-pipeline/train.py` (F24) — the precedent for "be paranoid about what files cross trust boundaries." Same instinct, different surface.
