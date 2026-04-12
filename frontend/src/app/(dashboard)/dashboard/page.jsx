'use client';

import { useEffect, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { getDashboardStats, triggerRetraining } from "../../../services/analytics";

function KpiCard({ label, value, sublabel, accent }) {
  return (
    <div className="p-5" style={{ backgroundColor: "#ffffff" }}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-2" style={{ color: "#7a7574" }}>{label}</p>
      <p className="text-[2rem] font-bold" style={{ color: accent ? "#b20100" : "#1c1b1b", letterSpacing: "-0.02em" }}>{value}</p>
      {sublabel && <p className="text-[0.6875rem] mt-1" style={{ color: "#7a7574" }}>{sublabel}</p>}
    </div>
  );
}

function WerChart() {
  const baseModel = [18, 16, 15, 14.5, 14, 13.5, 13, 12.5, 12, 11, 10.5, 10];
  const fineTuned = [18, 14, 11, 9, 8, 7.5, 7, 6.2, 5.5, 5, 4.5, 4.2];
  const maxVal = 20;

  return (
    <div className="p-5" style={{ backgroundColor: "#ffffff" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[0.875rem] font-bold uppercase tracking-wider" style={{ color: "#1c1b1b" }}>Word Error Rate (WER) Over Time</h3>
          <p className="text-[0.6875rem]" style={{ color: "#7a7574" }}>Historical performance metrics across all models</p>
        </div>
        <div className="flex items-center gap-4 text-[0.6875rem]">
          <span className="flex items-center gap-1"><span className="w-3 h-1 inline-block" style={{ backgroundColor: "#1c1b1b" }} />Base Model</span>
          <span className="flex items-center gap-1"><span className="w-3 h-1 inline-block" style={{ backgroundColor: "#b20100" }} />Fine-Tuned</span>
        </div>
      </div>
      <div className="relative" style={{ height: "200px" }}>
        {[0, 5, 10, 15, 20].map((v) => (
          <div key={v} className="absolute w-full" style={{ bottom: `${(v / maxVal) * 100}%`, borderTop: "1px solid rgba(233, 188, 181, 0.15)" }}>
            <span className="absolute -left-8 -top-2 text-[0.625rem]" style={{ color: "#7a7574" }}>{v}%</span>
          </div>
        ))}
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${baseModel.length - 1} ${maxVal}`} preserveAspectRatio="none">
          <polyline points={baseModel.map((v, i) => `${i},${maxVal - v}`).join(" ")} fill="none" stroke="#1c1b1b" strokeWidth="0.3" />
        </svg>
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${fineTuned.length - 1} ${maxVal}`} preserveAspectRatio="none">
          <polyline points={fineTuned.map((v, i) => `${i},${maxVal - v}`).join(" ")} fill="none" stroke="#b20100" strokeWidth="0.3" />
        </svg>
      </div>
      <div className="flex items-center gap-8 mt-6 pt-4" style={{ borderTop: "1px solid rgba(233, 188, 181, 0.15)" }}>
        <div><p className="text-[0.6875rem] uppercase tracking-wider" style={{ color: "#7a7574" }}>Current WER</p><p className="text-[1.5rem] font-bold" style={{ color: "#1c1b1b" }}>4.2%</p></div>
        <div><p className="text-[0.6875rem] uppercase tracking-wider" style={{ color: "#7a7574" }}>Target</p><p className="text-[1.5rem] font-bold" style={{ color: "#7a7574" }}>2.5%</p></div>
        <div><p className="text-[0.6875rem] uppercase tracking-wider" style={{ color: "#7a7574" }}>Improvement</p><p className="text-[1.5rem] font-bold" style={{ color: "#b20100" }}>+18.4%</p></div>
        <button className="ml-auto px-4 py-2 text-[0.75rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}>FULL REPORT</button>
      </div>
    </div>
  );
}

function CriticalTermFailures() {
  const terms = [{ term: "Amortization", edits: 412 }, { term: "Liquidity Trap", edits: 208 }, { term: "Fiduciary Duty", edits: 194 }];
  const maxEdits = Math.max(...terms.map((t) => t.edits));
  return (
    <div className="p-5" style={{ backgroundColor: "#ffffff" }}>
      <h3 className="text-[0.875rem] font-bold uppercase tracking-wider mb-4" style={{ color: "#1c1b1b" }}>Critical Term Failures</h3>
      <div className="space-y-3">
        {terms.map((t) => (
          <div key={t.term}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[0.8125rem] font-semibold" style={{ color: "#1c1b1b" }}>{t.term.toUpperCase()}</span>
              <span className="text-[0.75rem] font-bold" style={{ color: "#b20100" }}>{t.edits} EDITS</span>
            </div>
            <div className="h-1 w-full" style={{ backgroundColor: "#f6f3f2" }}>
              <div className="h-1" style={{ width: `${(t.edits / maxEdits) * 100}%`, backgroundColor: "#b20100" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [training, setTraining] = useState(false);

  useEffect(() => { getDashboardStats().then(setStats); }, []);

  const handleRetrain = async () => {
    setTraining(true);
    await triggerRetraining();
    setTraining(false);
    getDashboardStats().then(setStats);
  };

  if (!stats) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-4">
        <DotLottieReact
          src="https://lottie.host/c0dd85b9-4b16-423a-acc1-a99b7db2fa8b/JTRJuIh54G.lottie"
          loop
          autoplay
          style={{ width: 200, height: 200 }}
        />
        <p className="text-[0.875rem] font-medium" style={{ color: '#7a7574' }}>
          Loading...
        </p>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-2 text-[0.6875rem] mb-1" style={{ color: "#7a7574" }}>
        <span className="uppercase tracking-wider" style={{ color: "#b20100" }}>Institutional Intelligence</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>
          EDIT ANALYTICS <span style={{ fontWeight: 300 }}>&amp;</span> IMPACT
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-[0.6875rem]" style={{ color: "#7a7574" }}>System Status: <span style={{ color: "#1c1b1b", fontWeight: 600 }}>Optimized / Model v4.2</span></span>
          <button onClick={handleRetrain} disabled={training} className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer disabled:opacity-50" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}>
            {training ? "RETRAINING..." : "RETRAIN"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard label="Overall WER" value="4.2%" sublabel="+0.3% improvement" accent />
        <KpiCard label="English WER" value="2.8%" sublabel="+0.8%" />
        <KpiCard label="Mandarin WER" value="6.1%" sublabel="-0.2%" />
        <KpiCard label="Financial Term Accuracy" value="98.4%" sublabel="+1.2% since last retrain" />
      </div>

      <div className="flex gap-6 mb-6">
        <div className="flex-1"><WerChart /></div>
        <div className="w-72 shrink-0 space-y-4">
          <div className="p-5" style={{ backgroundColor: "#ffffff" }}>
            <span className="inline-block px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase mb-2" style={{ backgroundColor: "rgba(178, 1, 0, 0.08)", color: "#b20100", borderRadius: "0px" }}>HIGH FIDELITY</span>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-1" style={{ color: "#7a7574" }}>Total Human Corrections</p>
            <p className="text-[3rem] font-bold leading-none" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>{stats.totalWordsEdited.toLocaleString() || "12,842"}</p>
            <p className="text-[0.6875rem] mt-2" style={{ color: "#7a7574" }}>Accuracy confidence: {stats.estimatedAccuracy}%</p>
          </div>
          <CriticalTermFailures />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[1.25rem] font-bold uppercase tracking-tight" style={{ color: "#1c1b1b" }}>Recent Improvement Logs</h2>
          <span className="text-[0.6875rem]" style={{ color: "#7a7574" }}>FILTER: HIGH IMPACT ONLY</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { id: "TRN-9403-B", title: "Q3 Earnings Boardroom", dur: "634 hrs", editor: "J. Chen", wer: "12.4", change: 1.2 },
            { id: "TRN-7718-A", title: "Risk Assessment Alpha", dur: "198 hrs", editor: "M. Wisse", wer: "8.9", change: -0.8 },
            { id: "TRN-4603-D", title: "Compliance Policy Update", dur: "848 hrs", editor: "E. Kim", wer: "15.1", change: 2.4 },
          ].map((log) => (
            <div key={log.id} className="p-4" style={{ backgroundColor: "#ffffff" }}>
              <p className="text-[0.625rem] font-semibold uppercase tracking-wider mb-1" style={{ color: "#b20100" }}>{log.id}</p>
              <h4 className="text-[0.875rem] font-bold mb-1" style={{ color: "#1c1b1b" }}>{log.title}</h4>
              <p className="text-[0.6875rem] mb-3" style={{ color: "#7a7574" }}>Duration: {log.dur} | Editor: {log.editor}</p>
              <div className="flex items-center gap-3">
                <span className="text-[1.25rem] font-bold" style={{ color: "#1c1b1b" }}>{log.wer}%</span>
                <span className="text-[0.75rem] font-bold" style={{ color: log.change >= 0 ? "#b20100" : "#004ec6" }}>
                  {log.change >= 0 ? "\u2191" : "\u2193"} {Math.abs(log.change)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
