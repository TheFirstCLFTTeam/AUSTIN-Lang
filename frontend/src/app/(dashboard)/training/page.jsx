'use client';

import { useState } from "react";

const MOCK_JOBS = [
  { id: "TRANS-LARGE-V3-FIN", status: "running", progress: 67, gpu: 94, startTime: "OCT 24, 08:00 GMT", baseModel: "Whisper Large-v3", lr: "3e-4", rank: 16 },
  { id: "MAND-RETRAIN-A2", status: "paused", progress: 31, gpu: 0, startTime: "OCT 24, 02:15 GMT", baseModel: "MERaLiON", lr: "1e-4", rank: 32 },
  { id: "LLM-FINE-TUNE-CREDIT", status: "queued", progress: 0, gpu: 0, startTime: "\u2014", baseModel: "Whisper Tiny", lr: "5e-5", rank: 8 },
];

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
  const [jobs] = useState(MOCK_JOBS);
  const [showExperiment, setShowExperiment] = useState(false);

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
              <p className="text-[0.8125rem] font-bold" style={{ color: "#1c1b1b" }}>{job.id}</p>
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

      <div className="flex items-center justify-between mt-6 text-[0.625rem] uppercase tracking-wider" style={{ color: "#7a7574" }}>
        <span>Infrastructure: AWS-US-EAST-1-V082</span>
        <span>Compliance Hash: SEC-L74-4 VERIFIED</span>
        <span>Data Sovereignty: ON-PREMISE ENCLAVE</span>
      </div>

      {/* New Experiment Button */}
      <div className="mt-8">
        <button onClick={() => setShowExperiment(true)} className="px-6 py-3 text-[0.8125rem] font-semibold cursor-pointer" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}>
          + NEW EXPERIMENT
        </button>
      </div>

      {/* Experiment Modal */}
      {showExperiment && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: "rgba(28, 27, 27, 0.4)" }}>
          <div className="w-full max-w-lg p-8" style={{ backgroundColor: "#ffffff", boxShadow: "0 20px 40px rgba(28, 27, 27, 0.06)" }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[1.25rem] font-bold" style={{ color: "#1c1b1b" }}>DEFINE EXPERIMENT</h2>
              <button onClick={() => setShowExperiment(false)} className="text-[1.25rem] cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#7a7574" }}>&times;</button>
            </div>
            <div className="space-y-4">
              <FormField label="Base Model">
                <select className="w-full px-3 py-2 text-[0.8125rem]" style={inputStyle}>
                  <option>Whisper Large-v3</option><option>Whisper Tiny</option><option>MERaLiON</option><option>Qwen3-ASR</option>
                </select>
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="LoRA Rank (r)"><input type="number" defaultValue={16} className="w-full px-3 py-2 text-[0.8125rem]" style={inputStyle} /></FormField>
                <FormField label="LoRA Alpha"><input type="number" defaultValue={32} className="w-full px-3 py-2 text-[0.8125rem]" style={inputStyle} /></FormField>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Learning Rate"><input type="text" defaultValue="3e-4" className="w-full px-3 py-2 text-[0.8125rem]" style={inputStyle} /></FormField>
                <FormField label="Epochs"><input type="number" defaultValue={3} className="w-full px-3 py-2 text-[0.8125rem]" style={inputStyle} /></FormField>
              </div>
              <FormField label="Batch Size"><input type="number" defaultValue={8} className="w-full px-3 py-2 text-[0.8125rem]" style={inputStyle} /></FormField>
              <FormField label="Dataset">
                <select className="w-full px-3 py-2 text-[0.8125rem]" style={inputStyle}>
                  <option>Real data pairs only</option><option>Synthetic data pairs only</option><option>Mixed (real + synthetic)</option>
                </select>
              </FormField>
              <div className="flex gap-3 pt-4">
                <button onClick={() => setShowExperiment(false)} className="flex-1 py-2.5 text-[0.8125rem] font-semibold cursor-pointer" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}>LAUNCH EXPERIMENT</button>
                <button onClick={() => setShowExperiment(false)} className="px-6 py-2.5 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}>CANCEL</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
