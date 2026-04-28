'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/services/api";
import {
  watchJob,
  unwatchJob,
  isWatching,
  subscribe as subscribeNotifications,
  generateNotification,
} from "@/services/notifications";
import { TRAINING_JOBS, submitTrainingJob } from "@/services/training-jobs";
import { getDatasets, subscribeDatasets } from "@/services/datasets";
import { users } from "@/services/mock_data-users";

// How long after watching before we simulate completion and fire the
// notification. In production this would be replaced by a real event
// (websocket / polling) — and by a Teams webhook for external delivery.
const MOCK_COMPLETION_DELAY_MS = 8000;

const BASE_MODELS = ["Whisper Large-v3", "Whisper Tiny", "MERaLiON", "Qwen3-ASR"];

// Display name → HF base id. The orchestrator persists the HF id so the
// training-pipeline + adapter_config.json can match (see
// docs/06 server/metrics-service-module.md §3.2 — base_model + adapter_name
// is the join key).
const BASE_MODEL_HF_IDS = {
  "Whisper Large-v3": "openai/whisper-large-v3-turbo",
  "Whisper Tiny": "openai/whisper-tiny",
  "MERaLiON": "MERaLiON/MERaLiON-AudioLLM-Whisper-SEA-LION",
  "Qwen3-ASR": "Qwen/Qwen3-ASR",
};

// Datasets are referenced across the training pipeline as `{email}/{timestamp}`
// so a job can unambiguously re-mount the engineer set its analysis VM was
// pulled against.
function datasetRef(d) {
  const u = users.find(
    (x) => x.id === d.createdBy || x.name === d.createdBy || x.email === d.createdBy,
  );
  const email = u?.email || d.createdBy || "unknown@austin.local";
  const ts = d.createdAt
    ? d.createdAt.replace(/[-:TZ.]/g, "").slice(0, 14)
    : d.id || "dataset";
  return `${email}/${ts}`;
}

function StatusBadge({ status }) {
  const map = {
    running: { bg: "rgba(178, 1, 0, 0.08)", color: "#b20100", label: "RUNNING" },
    paused: { bg: "rgba(122, 117, 116, 0.1)", color: "#7a7574", label: "PAUSED" },
    queued: { bg: "rgba(0, 78, 198, 0.08)", color: "#004ec6", label: "QUEUED" },
  };
  const s = map[status] || map.queued;
  return (
    <span className="inline-block px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider" style={{ backgroundColor: s.bg, color: s.color, borderRadius: "0px" }}>
      {s.label}
    </span>
  );
}

function GpuBars({ value }) {
  return (
    <div className="flex items-end gap-px h-6">
      {[0, 1, 2].map((i) => (
        <div key={i} className="w-1.5" style={{ height: `${6 + i * 8}px`, backgroundColor: i * 35 < value ? "#b20100" : "#e8e5e4" }} />
      ))}
      <span className="ml-1.5 text-[0.6875rem] font-semibold" style={{ color: "#1c1b1b" }}>{value}%</span>
    </div>
  );
}

function WatchButton({ watching, onToggle }) {
  const [tooltip, setTooltip] = useState(null);
  const timerRef = useRef(null);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setTooltip(null);
  }, []);

  const handleClick = (e) => {
    e.stopPropagation();
    const willWatch = !watching;
    onToggle(e);
    setTooltip(willWatch ? "watching" : "unwatched");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(dismiss, 2200);
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const label = watching ? "Stop watching this training job" : "Notify me when training completes";

  return (
    <span className="relative shrink-0">
      <span
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === "Enter") handleClick(e); }}
        className="flex items-center justify-center w-5 h-5 transition-colors"
        style={{ cursor: "pointer" }}
        title={label}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={watching ? "#b20100" : "none"} stroke={watching ? "#b20100" : "#7a7574"} strokeWidth="1.75" strokeLinecap="square" strokeLinejoin="miter">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </span>

      {tooltip && (
        <div
          className="absolute left-1/2 bottom-full mb-2 px-3 py-2 whitespace-nowrap"
          style={{ transform: "translateX(-50%)", backgroundColor: "#1c1b1b", borderRadius: "6px", boxShadow: "0 8px 20px rgba(0,0,0,0.2)", zIndex: 20 }}
        >
          <div className="flex items-center gap-1.5">
            {tooltip === "watching" ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            <span className="text-[0.6875rem] font-medium" style={{ color: "#ffffff" }}>
              {tooltip === "watching"
                ? "You\u2019ll be notified when training completes"
                : "Notifications turned off for this job"}
            </span>
          </div>
          <div
            className="absolute left-1/2"
            style={{ bottom: "-4px", transform: "translateX(-50%) rotate(45deg)", width: "8px", height: "8px", backgroundColor: "#1c1b1b" }}
          />
        </div>
      )}
    </span>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="block text-[0.6875rem] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#7a7574" }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = { backgroundColor: "#f6f3f2", border: "none", borderBottom: "2px solid #c4c4c4", borderRadius: "0px", color: "#1c1b1b" };

export default function TrainingJobsPage() {
  const [jobs] = useState(TRAINING_JOBS);
  const [showExperiment, setShowExperiment] = useState(false);
  const [, forceUpdate] = useState(0);
  const completionTimersRef = useRef(new Map());

  const [customDatasets, setCustomDatasets] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  const [expJobName, setExpJobName] = useState("");
  const [expTarget, setExpTarget] = useState("cloud");
  const [expDatasetRef, setExpDatasetRef] = useState("");
  const [expBaseModel, setExpBaseModel] = useState(BASE_MODELS[0]);
  const [expModelConfig, setExpModelConfig] = useState("./configs/model.yaml");
  const [expUseLora, setExpUseLora] = useState(true);
  const [expLoraRank, setExpLoraRank] = useState(16);
  const [expLoraAlpha, setExpLoraAlpha] = useState(32);
  const [expLr, setExpLr] = useState("3e-4");
  const [expEpochs, setExpEpochs] = useState(3);
  const [expBatchSize, setExpBatchSize] = useState(8);
  const [expScriptPath, setExpScriptPath] = useState("./scripts/train.sh");

  useEffect(() => subscribeNotifications(() => forceUpdate((n) => n + 1)), []);

  useEffect(() => {
    setCustomDatasets(getDatasets());
    setCurrentUser(getCurrentUser());
    return subscribeDatasets(setCustomDatasets);
  }, []);

  const datasetRefs = useMemo(
    () => customDatasets.map((d) => ({ value: datasetRef(d), name: d.name })),
    [customDatasets],
  );

  useEffect(() => {
    if (!expDatasetRef && datasetRefs.length > 0) {
      setExpDatasetRef(datasetRefs[0].value);
    }
  }, [datasetRefs, expDatasetRef]);

  const envLines = useMemo(() => {
    const lines = [];
    if (expUseLora) {
      lines.push(`LORA_RANK=${expLoraRank}`);
      lines.push(`LORA_ALPHA=${expLoraAlpha}`);
    }
    lines.push(`LEARNING_RATE=${expLr}`);
    lines.push(`EPOCHS=${expEpochs}`);
    lines.push(`BATCH_SIZE=${expBatchSize}`);
    lines.push(`DATASET=${expDatasetRef || "<select-dataset>"}`);
    lines.push(`BASE_MODEL=${expBaseModel}`);
    if (expTarget === "local") {
      lines.push(`MODEL_CONFIG=${expModelConfig}`);
    }
    return lines;
  }, [expUseLora, expLoraRank, expLoraAlpha, expLr, expEpochs, expBatchSize, expDatasetRef, expBaseModel, expTarget, expModelConfig]);

  const commandPreview = useMemo(() => {
    const jobSlug = (expJobName || "<job-name>").trim() || "<job-name>";
    if (expTarget === "cloud") {
      return [
        "# from inside your analysis VM",
        "cat > .env <<EOF",
        ...envLines,
        "EOF",
        "",
        `austin-cli jobs submit \\\n  --name "${jobSlug}" \\\n  --env .env`,
      ].join("\n");
    }
    return [
      "# on your local machine",
      `export ${envLines.join(" \\\n  ")}`,
      "",
      `bash ${expScriptPath} \\\n  --name "${jobSlug}"`,
    ].join("\n");
  }, [expTarget, envLines, expScriptPath, expJobName]);

  const canLaunch = Boolean(expJobName.trim() && expDatasetRef);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const resetExperimentForm = () => {
    setSubmitError(null);
    setShowExperiment(false);
  };

  const handleLaunchExperiment = async () => {
    if (!canLaunch || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    const env = {
      LORA: expUseLora ? "1" : "0",
      LEARNING_RATE: String(expLr),
      EPOCHS: String(expEpochs),
      BATCH_SIZE: String(expBatchSize),
    };
    if (expUseLora) {
      env.LORA_RANK = String(expLoraRank);
      env.LORA_ALPHA = String(expLoraAlpha);
    }
    if (expTarget === "local") {
      env.MODEL_CONFIG = expModelConfig;
      env.SCRIPT_PATH = expScriptPath;
    }
    try {
      await submitTrainingJob({
        name: expJobName.trim(),
        target: expTarget,
        base_model: BASE_MODEL_HF_IDS[expBaseModel] || expBaseModel,
        dataset_ref: expDatasetRef,
        env,
      });
      resetExperimentForm();
    } catch (err) {
      setSubmitError(err?.detail || err?.message || "Failed to submit job");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => () => {
    completionTimersRef.current.forEach((id) => clearTimeout(id));
    completionTimersRef.current.clear();
  }, []);

  const toggleWatch = (e, job) => {
    e.stopPropagation();
    const user = getCurrentUser();
    const timers = completionTimersRef.current;
    if (isWatching(job.id)) {
      unwatchJob(job.id);
      const t = timers.get(job.id);
      if (t) {
        clearTimeout(t);
        timers.delete(job.id);
      }
      return;
    }
    watchJob({ jobId: job.id, jobName: job.id, userId: user?.id || "u2" });
    const timeoutId = setTimeout(() => {
      generateNotification({ jobId: job.id, jobName: job.id, status: "completed" });
      timers.delete(job.id);
    }, MOCK_COMPLETION_DELAY_MS);
    timers.set(job.id, timeoutId);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>
          ACTIVE TRAINING JOBS
        </h1>
        <div className="text-right">
          <p className="text-[0.6875rem] uppercase tracking-wider" style={{ color: "#7a7574" }}>System Fidelity Score</p>
          <p className="text-[2.5rem] font-bold leading-none" style={{ color: "#1c1b1b" }}>72.4 <span className="text-[0.875rem] font-normal" style={{ color: "#7a7574" }}>BLOPS</span></p>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        <span className="px-2 py-0.5 text-[0.625rem] font-semibold uppercase" style={{ backgroundColor: "rgba(178, 1, 0, 0.08)", color: "#b20100" }}>
          {jobs.filter(j => j.status === "running").length} RUNNING
        </span>
        <span className="px-2 py-0.5 text-[0.625rem] font-semibold uppercase" style={{ backgroundColor: "rgba(122, 117, 116, 0.1)", color: "#7a7574" }}>
          {jobs.filter(j => j.status === "queued").length} QUEUED
        </span>
      </div>

      <div className="mb-6">
        <button onClick={() => setShowExperiment(true)} className="px-6 py-3 text-[0.8125rem] font-semibold cursor-pointer" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}>
          + NEW EXPERIMENT
        </button>
      </div>

      {/* Jobs Table */}
      <div style={{ backgroundColor: "#ffffff" }}>
        <div className="flex items-center px-5 py-3 text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574", borderBottom: "1px solid rgba(233, 188, 181, 0.15)" }}>
          <div className="w-52">Job Name</div>
          <div className="w-28">Status</div>
          <div className="flex-1">Progress</div>
          <div className="w-28">GPU Load</div>
          <div className="w-40">Start Time</div>
          <div className="w-24" />
        </div>

        {jobs.map((job) => (
          <div key={job.id} className="flex items-center px-5 py-4" style={{ borderBottom: "1px solid rgba(233, 188, 181, 0.08)" }}>
            <div className="w-52">
              <div className="flex items-center gap-2">
                <Link
                  href={`/training/${job.id}`}
                  className="text-[0.8125rem] font-bold no-underline hover:underline"
                  style={{ color: "#1c1b1b", textDecorationColor: "#b20100", textUnderlineOffset: "3px" }}
                >
                  {job.id}
                </Link>
                {job.status !== "completed" && (
                  <WatchButton
                    watching={isWatching(job.id)}
                    onToggle={(e) => toggleWatch(e, job)}
                  />
                )}
              </div>
              <p className="text-[0.625rem]" style={{ color: "#7a7574" }}>{job.baseModel} | r={job.rank} | lr={job.lr}</p>
            </div>
            <div className="w-28"><StatusBadge status={job.status} /></div>
            <div className="flex-1 pr-6">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2" style={{ backgroundColor: "#f6f3f2" }}>
                  <div className="h-2 transition-all" style={{ width: `${job.progress}%`, backgroundColor: job.status === "running" ? "#b20100" : "#c4c4c4" }} />
                </div>
                <span className="text-[0.6875rem] font-semibold w-10 text-right" style={{ color: "#1c1b1b" }}>{job.progress}%</span>
              </div>
            </div>
            <div className="w-28"><GpuBars value={job.gpu} /></div>
            <div className="w-40 text-[0.75rem]" style={{ color: "#7a7574" }}>{job.startTime}</div>
            <div className="w-24 flex gap-2">
              {job.status === "running" && <button className="text-[0.6875rem] font-semibold cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#7a7574" }}>PAUSE</button>}
              {job.status === "paused" && <button className="text-[0.6875rem] font-semibold cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#b20100" }}>RESUME</button>}
              <button className="text-[0.6875rem] font-semibold cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#7a7574" }}>CANCEL</button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 text-[0.625rem] uppercase tracking-wider" style={{ color: "#7a7574" }}>
        <span>Infrastructure: INTERNAL-SERVER-3</span>
      </div>

      {/* Experiment Modal */}
      {showExperiment && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ backgroundColor: "rgba(28, 27, 27, 0.55)" }}>
          <div className="w-full max-w-2xl p-8 max-h-[92vh] overflow-y-auto" style={{ backgroundColor: "#ffffff", boxShadow: "0 20px 40px rgba(28, 27, 27, 0.12)", borderTop: "3px solid #b20100" }}>
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="text-[0.625rem] font-semibold uppercase tracking-widest" style={{ color: "#b20100" }}>Training Pipeline</p>
                <h2 className="text-[1.25rem] font-bold tracking-tight" style={{ color: "#1c1b1b", letterSpacing: "-0.01em" }}>DEFINE EXPERIMENT</h2>
              </div>
              <button onClick={() => setShowExperiment(false)} className="text-[1.5rem] leading-none cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#7a7574" }} aria-label="Close">&times;</button>
            </div>
            <p className="text-[0.75rem] mb-6" style={{ color: "#7a7574" }}>
              Continue from your analysis environment. These values become the <span className="font-mono" style={{ color: "#1c1b1b" }}>.env</span> overrides your training pipeline reads at launch.
            </p>

            {/* Job Name */}
            <section className="mb-6">
              <FormField label="Job Name">
                <input
                  type="text"
                  value={expJobName}
                  onChange={(e) => setExpJobName(e.target.value)}
                  placeholder="e.g. mand-retrain-a3"
                  className="w-full px-3 py-2 text-[0.8125rem]"
                  style={inputStyle}
                />
              </FormField>
              <p className="text-[0.6875rem] mt-1.5" style={{ color: "#7a7574" }}>
                Appears in the jobs table and notifications. Pick something memorable.
              </p>
            </section>

            {/* Execution target */}
            <section className="mb-6">
              <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-2" style={{ color: "#7a7574" }}>Execution Target</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: "cloud", label: "Cloud VM", sub: "Runs austin-cli on the provisioned analysis VM." },
                  { key: "local", label: "This Machine", sub: "Self-managed \u00b7 point to your own bash script." },
                ].map((opt) => {
                  const active = expTarget === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setExpTarget(opt.key)}
                      className="p-4 text-left cursor-pointer"
                      style={{
                        backgroundColor: active ? "rgba(178, 1, 0, 0.04)" : "#f6f3f2",
                        border: `2px solid ${active ? "#b20100" : "transparent"}`,
                        borderRadius: "0px",
                      }}
                    >
                      <p className="text-[0.875rem] font-bold" style={{ color: "#1c1b1b" }}>{opt.label}</p>
                      <p className="text-[0.6875rem] mt-0.5" style={{ color: "#7a7574" }}>{opt.sub}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Dataset */}
            <section className="mb-6">
              <FormField label={`Dataset \u00b7 referenced as {${currentUser?.email || "you@example.com"}}/{timestamp}`}>
                {datasetRefs.length === 0 ? (
                  <p className="text-[0.75rem] px-3 py-2" style={{ backgroundColor: "#f6f3f2", color: "#7a7574" }}>
                    No engineer datasets yet. Curate a set from the file browser first.
                  </p>
                ) : (
                  <select
                    value={expDatasetRef}
                    onChange={(e) => setExpDatasetRef(e.target.value)}
                    className="w-full px-3 py-2 text-[0.8125rem]"
                    style={inputStyle}
                  >
                    {datasetRefs.map(({ value, name }) => (
                      <option key={value} value={value}>{`${value}  \u2014  ${name}`}</option>
                    ))}
                  </select>
                )}
              </FormField>
              <p className="text-[0.6875rem] font-mono mt-1.5" style={{ color: "#7a7574" }}>
                {"\u2192"} resolved: <span style={{ color: "#b20100" }}>{expDatasetRef || "\u2014"}</span>
              </p>
            </section>

            {/* Model configuration */}
            <section className="mb-6">
              <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-2" style={{ color: "#7a7574" }}>Model Configuration</p>
              <div className={expTarget === "local" ? "grid grid-cols-2 gap-4" : ""}>
                <FormField label="Base Model">
                  <select
                    value={expBaseModel}
                    onChange={(e) => setExpBaseModel(e.target.value)}
                    className="w-full px-3 py-2 text-[0.8125rem]"
                    style={inputStyle}
                  >
                    {BASE_MODELS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </FormField>
                {expTarget === "local" && (
                  <FormField label="Model Config Path">
                    <input
                      type="text"
                      value={expModelConfig}
                      onChange={(e) => setExpModelConfig(e.target.value)}
                      placeholder="./configs/model.yaml"
                      className="w-full px-3 py-2 text-[0.8125rem] font-mono"
                      style={inputStyle}
                    />
                  </FormField>
                )}
              </div>
              {expTarget === "local" && (
                <p className="text-[0.6875rem] mt-1.5" style={{ color: "#7a7574" }}>
                  Self-managed runs require a model configuration file on your machine (yaml / json).
                </p>
              )}
            </section>

            {/* .env overrides */}
            <section className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[0.625rem] font-semibold uppercase tracking-widest" style={{ color: "#7a7574" }}>.env Overrides</p>
                <label className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider cursor-pointer" style={{ color: "#1c1b1b" }}>
                  <input
                    type="checkbox"
                    checked={expUseLora}
                    onChange={(e) => setExpUseLora(e.target.checked)}
                    style={{ accentColor: "#b20100", cursor: "pointer" }}
                  />
                  Use LoRA
                </label>
              </div>
              <div className="p-4 space-y-2" style={{ backgroundColor: "#1c1b1b", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {[
                  expUseLora ? { key: "LORA_RANK", val: expLoraRank, setter: setExpLoraRank, type: "number" } : null,
                  expUseLora ? { key: "LORA_ALPHA", val: expLoraAlpha, setter: setExpLoraAlpha, type: "number" } : null,
                  { key: "LEARNING_RATE", val: expLr, setter: setExpLr, type: "text" },
                  { key: "EPOCHS", val: expEpochs, setter: setExpEpochs, type: "number" },
                  { key: "BATCH_SIZE", val: expBatchSize, setter: setExpBatchSize, type: "number" },
                ].filter(Boolean).map((row) => (
                  <div key={row.key} className="flex items-center gap-2 text-[0.8125rem]">
                    <span style={{ color: "#e9bcb5", minWidth: "7.75rem", display: "inline-block" }}>{row.key}</span>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>=</span>
                    <input
                      type={row.type}
                      value={row.val}
                      onChange={(e) => row.setter(row.type === "number" ? Number(e.target.value) : e.target.value)}
                      className="flex-1 px-2 py-1 text-[0.8125rem]"
                      style={{ backgroundColor: "rgba(255,255,255,0.06)", border: "none", borderBottom: "1px solid rgba(233,188,181,0.3)", color: "#ffffff", outline: "none", borderRadius: "0px" }}
                    />
                  </div>
                ))}
              </div>
              {!expUseLora && (
                <p className="text-[0.6875rem] mt-1.5" style={{ color: "#7a7574" }}>
                  LoRA rank / alpha omitted. Full-parameter fine-tune will be attempted.
                </p>
              )}
            </section>

            {/* Launch script (local only) */}
            {expTarget === "local" && (
              <section className="mb-6">
                <FormField label="Launch Script">
                  <input
                    type="text"
                    value={expScriptPath}
                    onChange={(e) => setExpScriptPath(e.target.value)}
                    placeholder="./scripts/train.sh"
                    className="w-full px-3 py-2 text-[0.8125rem] font-mono"
                    style={inputStyle}
                  />
                </FormField>
                <p className="text-[0.6875rem] mt-1.5" style={{ color: "#7a7574" }}>
                  The bash entrypoint invoked after environment variables are exported.
                </p>
              </section>
            )}

            {/* Command preview */}
            <section className="mb-6">
              <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-2" style={{ color: "#7a7574" }}>Command Preview</p>
              <pre
                className="p-4 text-[0.75rem] overflow-x-auto"
                style={{ backgroundColor: "#1c1b1b", color: "#f6f3f2", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 1.5, whiteSpace: "pre", margin: 0 }}
              >
                {commandPreview}
              </pre>
            </section>

            {submitError && (
              <p className="mb-3 text-[0.75rem]" style={{ color: "#b20100" }}>
                {submitError}
              </p>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleLaunchExperiment}
                disabled={!canLaunch || submitting}
                className="flex-1 py-2.5 text-[0.8125rem] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}
              >
                {submitting ? "SUBMITTING…" : "LAUNCH EXPERIMENT"}
              </button>
              <button
                onClick={resetExperimentForm}
                disabled={submitting}
                className="px-6 py-2.5 text-[0.8125rem] font-medium cursor-pointer disabled:opacity-40"
                style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
