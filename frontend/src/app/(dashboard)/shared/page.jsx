const MOCK_SEGMENTS = [
  { id: 1, time: "00:01:42", speaker: "Arthur Vance", text: 'The preliminary findings for the AUSTIN-Lang initiative suggest a 24% increase in processing efficiency. We need to finalize these numbers by the quarterly audit.', highlights: [{ word: "AUSTIN-Lang", color: "#b20100" }] },
  { id: 2, time: "00:01:42", speaker: "Marcus Sterling", correctedBy: "Marcus", text: 'Regarding the segment mentioned by Arthur, the correct figure is actually 26.5%, not 24%. The delta is attributed to the low-latency buffer optimization.', highlights: [{ word: "26.5%", color: "#004ec6" }] },
  { id: 3, time: "00:03:22", speaker: "Sarah Jenkins", text: 'Understood. I will update the master spreadsheet and the institutional audit trail immediately to reflect the 26.5% benchmark.' },
  { id: 4, time: "00:04:50", speaker: "Arthur Vance", text: "Excellent. Let's move on to the deployment schedule for the northern region clusters." },
];

const MOCK_ACTIVITY = [
  { user: "Marcus Sterling", action: "Corrected segment", ref: "00:01:42", detail: "24% \u2192 26.5%", time: "2m ago", avatar: "MS" },
  { user: "Sarah Jenkins", action: "Flagged segment", ref: "00:02:15", detail: "\u25B6 REQUIRES REVIEW", time: "5m ago", avatar: "SJ" },
  { user: "Arthur Vance", action: "Approved transcription for export", ref: "", detail: "", time: "8m ago", avatar: "AV" },
  { user: "System Bot", action: "Initial AI transcription pass complete", ref: "", detail: "", time: "15m ago", avatar: "SB" },
];

export default function SharedPage() {
  const segments = MOCK_SEGMENTS;

  return (
    <div>
      <div className="flex items-center gap-2 text-[0.6875rem] mb-1" style={{ color: "#7a7574" }}>
        <span className="uppercase tracking-wider" style={{ color: "#b20100" }}>Recording Session #9432-B</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: "#1c1b1b", letterSpacing: "-0.02em", fontStyle: "italic" }}>
          AUSTIN-Lang Strategic Briefing
        </h1>
        <div className="flex gap-3">
          <button className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}>PLAY AUDIO</button>
          <button className="px-4 py-1.5 text-[0.8125rem] font-semibold cursor-pointer" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}>VERIFY ALL</button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Transcript with collaborative edits */}
        <div className="flex-1 space-y-6">
          {segments.map((seg) => (
            <div key={seg.id} className="p-5" style={{ backgroundColor: "#ffffff" }}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#b20100" }}>{seg.time}</span>
                  <span className="text-[0.75rem] font-bold ml-3" style={{ color: "#1c1b1b" }}>SPEAKER: {seg.speaker.toUpperCase()}</span>
                </div>
                {seg.correctedBy && (
                  <span className="text-[0.625rem] uppercase tracking-wider" style={{ color: "#7a7574" }}>Corrected by {seg.correctedBy}</span>
                )}
              </div>
              <p className="text-[0.875rem] leading-relaxed" style={{ color: "#1c1b1b" }}>
                {seg.highlights ? renderHighlighted(seg.text, seg.highlights) : seg.text}
              </p>
              {!seg.correctedBy && (
                <div className="flex gap-3 mt-3">
                  <button className="text-[0.6875rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#7a7574" }}>ADD NOTE</button>
                  <button className="text-[0.6875rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#7a7574" }}>TRANSLATE</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Activity Feed */}
        <div className="w-72 shrink-0">
          <div className="p-5" style={{ backgroundColor: "#ffffff" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[0.875rem] font-bold uppercase tracking-wider" style={{ color: "#1c1b1b" }}>Activity Feed</h3>
              <span className="px-2 py-0.5 text-[0.625rem] font-semibold" style={{ backgroundColor: "rgba(178, 1, 0, 0.08)", color: "#b20100" }}>LIVE</span>
            </div>
            <p className="text-[0.6875rem] mb-4" style={{ color: "#7a7574" }}>Recent edits &amp; updates</p>

            <div className="space-y-4">
              {MOCK_ACTIVITY.map((item, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-8 h-8 flex items-center justify-center text-[0.625rem] font-bold shrink-0" style={{ backgroundColor: i === 3 ? "#313030" : "#f6f3f2", color: i === 3 ? "#f3f0ef" : "#1c1b1b", borderRadius: "0px" }}>
                    {item.avatar}
                  </div>
                  <div className="flex-1">
                    <p className="text-[0.75rem] font-semibold" style={{ color: "#1c1b1b" }}>{item.user}</p>
                    <p className="text-[0.6875rem]" style={{ color: "#7a7574" }}>{item.action} {item.ref && <span style={{ color: "#b20100" }}>{item.ref}</span>}</p>
                    {item.detail && <p className="text-[0.625rem] font-semibold mt-0.5" style={{ color: "#1c1b1b" }}>{item.detail}</p>}
                    <p className="text-[0.625rem] mt-0.5" style={{ color: "#c4c4c4" }}>{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Users */}
          <div className="mt-4 p-4" style={{ backgroundColor: "#ffffff" }}>
            <div className="flex items-center justify-between">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>Active Users</span>
              <span className="text-[0.625rem] font-semibold" style={{ color: "#b20100" }}>3 ONLINE</span>
            </div>
            <div className="flex gap-1 mt-2">
              {["MS", "SJ", "AV"].map((a) => (
                <div key={a} className="w-8 h-8 flex items-center justify-center text-[0.625rem] font-bold" style={{ backgroundColor: "#f6f3f2", color: "#1c1b1b", borderRadius: "0px" }}>{a}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderHighlighted(text, highlights) {
  let result = text;
  const parts = [];
  let lastIndex = 0;

  for (const h of highlights) {
    const idx = result.indexOf(h.word, lastIndex);
    if (idx === -1) continue;
    if (idx > lastIndex) parts.push(result.slice(lastIndex, idx));
    parts.push(<span key={idx} className="px-1 font-semibold" style={{ backgroundColor: h.color === "#b20100" ? "rgba(178, 1, 0, 0.1)" : "rgba(0, 78, 198, 0.08)", color: h.color }}>{h.word}</span>);
    lastIndex = idx + h.word.length;
  }
  if (lastIndex < result.length) parts.push(result.slice(lastIndex));
  return parts;
}
