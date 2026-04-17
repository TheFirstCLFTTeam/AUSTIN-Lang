'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";

const MOCK_RECORDINGS = [
  {
    id: "REC-9284-AX", severity: "critical", flagDate: "Oct 24, 2025 | 14:22", cidStatus: "UNMASKED",
    original: [
      { time: "00:11", speaker: "Agent", text: 'Agent: Thank you for calling Austin Finance. Can I have your full name please?' },
      { time: "00:15", speaker: "Customer", text: 'Customer: Yes, this is Jonathan V. Sterling', pii: "Jonathan V. Sterling" },
      { time: "00:23", speaker: "Agent", text: 'Agent: And the account ID you are calling about?' },
      { time: "00:25", speaker: "Customer", text: "Customer: It's my primary checking, ID 8838-4491-882", pii: "8838-4491-882" },
      { time: "00:30", speaker: "Agent", text: 'Agent: I see a pending charge for $4,200. Is that correct?' },
      { time: "00:35", speaker: "Customer", text: 'Customer: No, I never authorized that. You can reach me at 555-0198-532 if needed.', pii: "555-0198-532" },
    ],
    pseudonymised: [
      { time: "00:11", speaker: "Agent", text: 'Agent: Thank you for calling Austin Finance. Can I have your full name please?' },
      { time: "00:15", speaker: "Customer", text: 'Customer: Yes, this is [MASKED_NAME_01]', masked: "[MASKED_NAME_01]" },
      { time: "00:23", speaker: "Agent", text: 'Agent: And the account ID you are calling about?' },
      { time: "00:25", speaker: "Customer", text: "Customer: It's my primary checking, ID [BANK_ID_8834]", masked: "[BANK_ID_8834]" },
      { time: "00:30", speaker: "Agent", text: 'Agent: I see a pending charge for $4,200. Is that correct?' },
      { time: "00:35", speaker: "Customer", text: 'Customer: No, I never authorized that. You can reach me at [PHONE_0332] if needed.', masked: "[PHONE_0332]" },
    ],
  },
  { id: "REC-8812-BQ", severity: "medium", flagDate: "Oct 24, 2025 | MOS", cidStatus: "INITIAL MASK", original: [], pseudonymised: [] },
  { id: "REC-7423-KL", severity: "low", flagDate: "Oct 23, 2025 | 09:40", cidStatus: "AUTO-FLAGGED", original: [], pseudonymised: [] },
];

function SeverityBadge({ severity }) {
  const map = {
    critical: { bg: "rgba(178, 1, 0, 0.08)", color: "#b20100" },
    medium: { bg: "rgba(0, 78, 198, 0.08)", color: "#004ec6" },
    low: { bg: "rgba(122, 117, 116, 0.1)", color: "#7a7574" },
  };
  const s = map[severity] || map.low;
  return <span className="text-[0.625rem] font-semibold uppercase" style={{ color: s.color }}>{severity}</span>;
}

export default function PrivacyPage() {
  const router = useRouter();
  const [selected, setSelected] = useState(MOCK_RECORDINGS[0]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wider mb-1" style={{ color: "#7a7574" }}>Compliance Review Queue</p>
          <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>
            PRIVACY FLAGS
          </h1>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => selected && router.push(`/files/${selected.id}/audit`)}
            disabled={!selected}
            className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}
          >
            AUDIT TRAIL
          </button>
          <button className="px-4 py-1.5 text-[0.8125rem] font-semibold cursor-pointer" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}>APPROVE FOR GREEN ZONE</button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Flagged Recordings List */}
        <div className="w-72 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[0.875rem] font-bold uppercase tracking-wider" style={{ color: "#1c1b1b" }}>Flagged Recordings</h2>
            <span className="px-2 py-0.5 text-[0.625rem] font-semibold" style={{ backgroundColor: "rgba(178, 1, 0, 0.08)", color: "#b20100" }}>
              {MOCK_RECORDINGS.length} PENDING
            </span>
          </div>

          <div className="space-y-2">
            {MOCK_RECORDINGS.map((rec) => (
              <div
                key={rec.id}
                onClick={() => setSelected(rec)}
                className="p-4 cursor-pointer transition-colors"
                style={{ backgroundColor: selected?.id === rec.id ? "#f6f3f2" : "#ffffff" }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[0.8125rem] font-bold" style={{ color: "#1c1b1b" }}>{rec.id}</span>
                  <SeverityBadge severity={rec.severity} />
                </div>
                <p className="text-[0.625rem]" style={{ color: "#7a7574" }}>FLAG DATE: {rec.flagDate}</p>
                <p className="text-[0.625rem]" style={{ color: "#7a7574" }}>CID STATUS: <span className="font-semibold" style={{ color: rec.cidStatus === "UNMASKED" ? "#b20100" : "#7a7574" }}>{rec.cidStatus}</span></p>
              </div>
            ))}
          </div>
        </div>

        {/* Main Review Area */}
        {selected && selected.original.length > 0 && (
          <div className="flex-1">
            <div className="mb-4">
              <h2 className="text-[1.25rem] font-bold mb-1" style={{ color: "#1c1b1b" }}>REVIEW: {selected.id}</h2>
              <p className="text-[0.75rem]" style={{ color: "#7a7574" }}>Found 4 PII entities in unencrypted stream segment 04</p>
            </div>

            <div className="flex gap-4">
              {/* Original Transcript */}
              <div className="flex-1 p-5" style={{ backgroundColor: "#ffffff" }}>
                <h3 className="text-[0.75rem] font-bold uppercase tracking-wider mb-4" style={{ color: "#1c1b1b" }}>Original Transcript</h3>
                <div className="space-y-3 font-mono text-[0.75rem]" style={{ color: "#1c1b1b" }}>
                  {selected.original.map((line, i) => (
                    <div key={i}>
                      <span style={{ color: "#7a7574" }}>[{line.time}]</span>{" "}
                      {line.pii ? (
                        <span>
                          {line.text.split(line.pii)[0]}
                          <span className="px-1" style={{ backgroundColor: "rgba(178, 1, 0, 0.1)", color: "#b20100", fontWeight: 700 }}>{line.pii}</span>
                          {line.text.split(line.pii)[1]}
                        </span>
                      ) : (
                        <span>{line.text}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Pseudonymised Transcript */}
              <div className="flex-1 p-5" style={{ backgroundColor: "#ffffff" }}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2" style={{ backgroundColor: "#b20100", borderRadius: "0px" }} />
                  <h3 className="text-[0.75rem] font-bold uppercase tracking-wider" style={{ color: "#1c1b1b" }}>Pseudonymised Transcript</h3>
                </div>
                <div className="space-y-3 font-mono text-[0.75rem]" style={{ color: "#1c1b1b" }}>
                  {selected.pseudonymised.map((line, i) => (
                    <div key={i}>
                      <span style={{ color: "#7a7574" }}>[{line.time}]</span>{" "}
                      {line.masked ? (
                        <span>
                          {line.text.split(line.masked)[0]}
                          <span className="px-1 font-bold" style={{ backgroundColor: "rgba(0, 78, 198, 0.08)", color: "#004ec6" }}>{line.masked}</span>
                          {line.text.split(line.masked)[1]}
                        </span>
                      ) : (
                        <span>{line.text}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4 mt-6">
              <button className="flex-1 py-3 text-[0.8125rem] font-semibold cursor-pointer" style={{ backgroundColor: "#313030", color: "#f3f0ef", border: "none", borderRadius: "0px" }}>TRIGGER CID MASKING</button>
              <button className="flex-1 py-3 text-[0.8125rem] font-semibold cursor-pointer" style={{ backgroundColor: "#313030", color: "#f3f0ef", border: "none", borderRadius: "0px" }}>VERIFY DELETION LOG</button>
              <div className="flex-1 p-3" style={{ backgroundColor: "#f6f3f2" }}>
                <p className="text-[0.625rem] uppercase tracking-wider mb-1" style={{ color: "#7a7574" }}>Risk Assessment</p>
                <div className="flex items-center gap-2">
                  <span className="text-[0.75rem] font-semibold" style={{ color: "#7a7574" }}>ALPHA</span>
                  <div className="flex-1 h-2" style={{ backgroundColor: "#e8e5e4" }}>
                    <div className="h-2" style={{ width: "75%", background: "linear-gradient(90deg, #b20100, #e10000)" }} />
                  </div>
                  <span className="text-[0.75rem] font-semibold" style={{ color: "#b20100" }}>V</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {selected && selected.original.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-20">
            <p className="text-[0.875rem]" style={{ color: "#7a7574" }}>Select a recording with flagged content to review.</p>
          </div>
        )}
      </div>
    </div>
  );
}
