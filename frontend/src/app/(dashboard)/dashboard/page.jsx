'use client';

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as d3 from "d3";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { getDashboardStats, triggerRetraining } from "../../../services/analytics";
import {
  MOCK_CRITICAL_TERM_FAILURES,
  MOCK_ACCURACY_LOGS,
} from "../../../services/mock_data-dashboard";
import { getSelectedMetrics } from "../../../services/metrics-config";

function KpiCard({ label, value, sublabel, accent, active, onClick, selectable }) {
  const borderColor = active ? "#b20100" : "transparent";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!selectable}
      className="p-5 text-left w-full transition-all disabled:cursor-default"
      style={{
        backgroundColor: "#ffffff",
        border: `2px solid ${borderColor}`,
        borderRadius: "0px",
        cursor: selectable ? "pointer" : "default",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>{label}</p>
        {active && (
          <span className="text-[0.5625rem] font-semibold uppercase tracking-wider px-1.5 py-0.5" style={{ backgroundColor: "rgba(178, 1, 0, 0.08)", color: "#b20100" }}>
            CHARTING
          </span>
        )}
      </div>
      <p className="text-[2rem] font-bold" style={{ color: accent ? "#b20100" : "#1c1b1b", letterSpacing: "-0.02em" }}>{value}</p>
      {sublabel && <p className="text-[0.6875rem] mt-1" style={{ color: "#7a7574" }}>{sublabel}</p>}
    </button>
  );
}

const DAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function lastNDayLabels(n) {
  const today = new Date();
  const labels = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    labels.push(DAY_LABELS[d.getDay()]);
  }
  return labels;
}

function MetricChart({ metric }) {
  const svgRef = useRef(null);
  const series = metric?.series;
  const target = metric?.target;

  useEffect(() => {
    const container = svgRef.current;
    if (!container) return;

    d3.select(container).selectAll("*").remove();
    if (!series) return;

    const { baseModel, fineTuned, yMin, yMax, unit } = series;

    const margin = { top: 8, right: 8, bottom: 24, left: 44 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 220 - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([0, baseModel.length - 1]).range([0, width]);
    const y = d3.scaleLinear().domain([yMin, yMax]).range([height, 0]);

    const yTicks = y.ticks(4);
    yTicks.forEach((v) => {
      svg.append("line")
        .attr("x1", 0).attr("x2", width)
        .attr("y1", y(v)).attr("y2", y(v))
        .attr("stroke", "rgba(233, 188, 181, 0.15)")
        .attr("stroke-width", 1);
      svg.append("text")
        .attr("x", -8).attr("y", y(v) + 3)
        .attr("text-anchor", "end")
        .attr("fill", "#7a7574")
        .attr("font-size", "0.625rem")
        .text(`${v}${unit}`);
    });

    if (target !== undefined && target !== null) {
      svg.append("line")
        .attr("x1", 0).attr("x2", width)
        .attr("y1", y(target)).attr("y2", y(target))
        .attr("stroke", "#b20100")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4 3")
        .attr("opacity", 0.6);
      svg.append("text")
        .attr("x", width - 4)
        .attr("y", y(target) - 4)
        .attr("text-anchor", "end")
        .attr("fill", "#b20100")
        .attr("font-size", "0.625rem")
        .attr("font-weight", "600")
        .attr("letter-spacing", "0.05em")
        .text(`TARGET ${target}${unit}`);
    }

    const xLabels = lastNDayLabels(baseModel.length);
    xLabels.forEach((label, i) => {
      svg.append("text")
        .attr("x", x(i))
        .attr("y", height + 16)
        .attr("text-anchor", "middle")
        .attr("fill", "#7a7574")
        .attr("font-size", "0.625rem")
        .attr("font-weight", "600")
        .attr("letter-spacing", "0.05em")
        .text(label);
    });

    const line = d3.line().x((_, i) => x(i)).y((d) => y(d));

    svg.append("path")
      .datum(baseModel)
      .attr("fill", "none")
      .attr("stroke", "#1c1b1b")
      .attr("stroke-width", 1.5)
      .attr("d", line);

    svg.append("path")
      .datum(fineTuned)
      .attr("fill", "none")
      .attr("stroke", "#b20100")
      .attr("stroke-width", 1.5)
      .attr("d", line);

    [{ data: baseModel, color: "#1c1b1b" }, { data: fineTuned, color: "#b20100" }].forEach(({ data, color }) => {
      data.forEach((v, i) => {
        svg.append("circle")
          .attr("cx", x(i))
          .attr("cy", y(v))
          .attr("r", 2.5)
          .attr("fill", color);
      });
    });
  }, [series, target]);

  if (!metric) {
    return (
      <div className="p-5 flex items-center justify-center" style={{ backgroundColor: "#ffffff", height: "340px" }}>
        <p className="text-[0.8125rem]" style={{ color: "#7a7574" }}>Select a metric above to view its trend.</p>
      </div>
    );
  }

  if (!series) {
    return (
      <div className="p-5" style={{ backgroundColor: "#ffffff" }}>
        <h3 className="text-[0.875rem] font-bold uppercase tracking-wider mb-2" style={{ color: "#1c1b1b" }}>{metric.name} Over Time</h3>
        <p className="text-[0.8125rem] mt-20 text-center" style={{ color: "#7a7574" }}>No time-series data available for this metric yet.</p>
      </div>
    );
  }

  return (
    <div className="p-5" style={{ backgroundColor: "#ffffff" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[0.875rem] font-bold uppercase tracking-wider" style={{ color: "#1c1b1b" }}>{metric.name} Over Time</h3>
          <p className="text-[0.6875rem]" style={{ color: "#7a7574" }}>Last 5 days — base model vs fine-tuned</p>
        </div>
        <div className="flex items-center gap-4 text-[0.6875rem]">
          <span className="flex items-center gap-1"><span className="w-3 h-1 inline-block" style={{ backgroundColor: "#1c1b1b" }} />Base Model</span>
          <span className="flex items-center gap-1"><span className="w-3 h-1 inline-block" style={{ backgroundColor: "#b20100" }} />Fine-Tuned</span>
          <span className="flex items-center gap-1">
            <span className="inline-block" style={{ width: "12px", height: "0", borderTop: "1px dashed #b20100" }} />
            Target
          </span>
        </div>
      </div>
      <div ref={svgRef} style={{ height: "220px" }} />
      <div className="flex items-center gap-8 mt-6 pt-4" style={{ borderTop: "1px solid rgba(233, 188, 181, 0.15)" }}>
        <div><p className="text-[0.6875rem] uppercase tracking-wider" style={{ color: "#7a7574" }}>Current</p><p className="text-[1.5rem] font-bold" style={{ color: "#1c1b1b" }}>{series.currentValue}{series.unit}</p></div>
        <div><p className="text-[0.6875rem] uppercase tracking-wider" style={{ color: "#7a7574" }}>Target</p><p className="text-[1.5rem] font-bold" style={{ color: "#7a7574" }}>{target ?? "—"}{target != null ? series.unit : ""}</p></div>
        <div><p className="text-[0.6875rem] uppercase tracking-wider" style={{ color: "#7a7574" }}>Difference</p><p className="text-[1.5rem] font-bold" style={{ color: "#b20100" }}>{series.difference}</p></div>
        <button className="ml-auto px-4 py-2 text-[0.75rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}>FULL REPORT</button>
      </div>
    </div>
  );
}

function CriticalTermFailures() {
  const maxEdits = Math.max(...MOCK_CRITICAL_TERM_FAILURES.map((t) => t.edits));
  return (
    <div className="p-5" style={{ backgroundColor: "#ffffff" }}>
      <h3 className="text-[0.875rem] font-bold uppercase tracking-wider mb-4" style={{ color: "#1c1b1b" }}>Critical Term Failures</h3>
      <div className="space-y-3">
        {MOCK_CRITICAL_TERM_FAILURES.map((t) => (
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
  const [selectedMetrics, setSelectedMetrics] = useState([]);
  const [activeMetricId, setActiveMetricId] = useState(null);

  useEffect(() => { getDashboardStats().then(setStats); }, []);
  useEffect(() => {
    const metrics = getSelectedMetrics();
    setSelectedMetrics(metrics);
    setActiveMetricId((prev) => prev ?? metrics[0]?.id ?? null);
  }, []);

  const activeMetric = selectedMetrics.find((m) => m.id === activeMetricId) || selectedMetrics[0] || null;

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
          src="/loading.lottie"
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
          <Link href="/dashboard/configure" className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b", textDecoration: "none" }}>
            CONFIGURE METRICS
          </Link>
          <button onClick={handleRetrain} disabled={training} className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer disabled:opacity-50" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}>
            {training ? "RETRAINING..." : "RETRAIN"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {selectedMetrics.map((kpi) => (
          <KpiCard
            key={kpi.id}
            label={kpi.name}
            value={kpi.value}
            sublabel={kpi.sublabel}
            accent={kpi.accent}
            active={kpi.id === activeMetric?.id}
            selectable={Boolean(kpi.series)}
            onClick={() => setActiveMetricId(kpi.id)}
          />
        ))}
      </div>

      <div className="flex gap-6 mb-6">
        <div className="flex-1"><MetricChart metric={activeMetric} /></div>
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
          <h2 className="text-[1.25rem] font-bold uppercase tracking-tight" style={{ color: "#1c1b1b" }}>Recent Accuracy Logs</h2>
          <span className="text-[0.6875rem]" style={{ color: "#7a7574" }}>FILTER: HIGH IMPACT ONLY</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {MOCK_ACCURACY_LOGS.map((log) => (
            <div key={log.id} className="p-4" style={{ backgroundColor: "#ffffff" }}>
              <p className="text-[0.625rem] font-semibold uppercase tracking-wider mb-1" style={{ color: "#b20100" }}>{log.id}</p>
              <h4 className="text-[0.875rem] font-bold mb-1" style={{ color: "#1c1b1b" }}>{log.title}</h4>
              <p className="text-[0.6875rem] mb-3" style={{ color: "#7a7574" }}>Duration: {log.dur} | Editor: {log.editor}</p>
              <div className="flex items-center gap-3">
                <span className="text-[1.25rem] font-bold" style={{ color: "#1c1b1b" }}>{log.accuracy}%</span>
                <span className="text-[0.75rem] font-bold" style={{ color: log.change >= 0 ? "#004ec6" : "#b20100" }}>
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
