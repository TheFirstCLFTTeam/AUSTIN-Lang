'use client';

import { useState } from "react";

const MOCK_GROUPS = [
  { id: 1, name: "Compliance", sub: "Core Regulatory Monitoring", members: 142, status: "CRITICAL", statusIcon: true, storage: null, wer: null, load: null },
  { id: 2, name: "Market Trading", sub: "", members: 2841, status: null, statusIcon: false, storage: null, wer: null, load: null },
  { id: 3, name: "Retail Banking", sub: "Client Relations", members: null, status: null, statusIcon: false, storage: "1.2 TB", wer: null, load: null },
  { id: 4, name: "ML Research", sub: "Model Training & Data Ops", members: 24, status: null, statusIcon: false, storage: null, wer: "4.2%", load: "High Load" },
];

const MOCK_PROFILE = {
  name: "Compliance Division",
  totalTranscriptions: "412,903",
  avgWer: "2.14%",
  privacyViolations: "03",
  storageUsed: "842.1 GB",
  operators: [
    { name: "John Devereaux", avatar: "JD" },
    { name: "Marcus Sterling", avatar: "MS" },
  ],
};

export default function GroupManagementPage() {
  const [selectedGroup, setSelectedGroup] = useState(MOCK_GROUPS[0]);

  return (
    <div>
      <div className="flex items-center gap-2 text-[0.6875rem] mb-1" style={{ color: "#7a7574" }}>
        <span className="uppercase tracking-wider" style={{ color: "#b20100" }}>Institutional Management</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>USER GROUPS</h1>
        <button className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer" style={{ backgroundColor: "#1c1b1b", color: "#f3f0ef", border: "none", borderRadius: "0px" }}>CREATE NEW USER GROUP</button>
      </div>

      <div className="flex gap-6">
        {/* Group Cards */}
        <div className="flex-1">
          <div className="grid grid-cols-2 gap-4">
            {MOCK_GROUPS.map((group) => (
              <div
                key={group.id}
                onClick={() => setSelectedGroup(group)}
                className="p-5 cursor-pointer transition-colors"
                style={{ backgroundColor: selectedGroup?.id === group.id ? "#f6f3f2" : "#ffffff" }}
              >
                <h3 className="text-[1.25rem] font-bold uppercase mb-0.5" style={{ color: "#1c1b1b" }}>{group.name}</h3>
                {group.sub && <p className="text-[0.6875rem] mb-3" style={{ color: "#7a7574" }}>{group.sub}</p>}
                {!group.sub && <div className="mb-3" />}

                <div className="flex items-end justify-between">
                  <div>
                    {group.members && (
                      <p className="text-[2rem] font-bold leading-none" style={{ color: "#1c1b1b" }}>{group.members.toLocaleString()}</p>
                    )}
                    {group.storage && (
                      <p className="text-[1.5rem] font-bold leading-none" style={{ color: "#1c1b1b" }}>{group.storage}</p>
                    )}
                    {group.wer && (
                      <div className="flex items-center gap-3">
                        <span className="text-[1.5rem] font-bold" style={{ color: "#1c1b1b" }}>{group.wer}</span>
                        {group.load && <span className="text-[0.6875rem] font-semibold" style={{ color: "#b20100" }}>{group.load}</span>}
                      </div>
                    )}
                    {!group.members && !group.storage && !group.wer && <div className="h-8" />}
                  </div>

                  {group.status && (
                    <span className="text-[0.625rem] font-bold uppercase tracking-wider" style={{ color: "#b20100" }}>{group.status}</span>
                  )}
                  {group.members && group.members > 100 && !group.status && (
                    <div className="flex gap-0.5">
                      {[0, 1, 2].map(i => (
                        <div key={i} className="w-2 h-6" style={{ backgroundColor: i < 2 ? "#1c1b1b" : "#e8e5e4" }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Group Profile Panel */}
        <div className="w-72 shrink-0 p-5" style={{ backgroundColor: "#ffffff" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="w-10 h-10 flex items-center justify-center mb-2" style={{ background: "linear-gradient(135deg, #b20100, #e10000)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              </div>
              <h3 className="text-[1rem] font-bold uppercase" style={{ color: "#1c1b1b" }}>Group Profile</h3>
              <p className="text-[0.6875rem]" style={{ color: "#7a7574" }}>{MOCK_PROFILE.name}</p>
            </div>
            <button className="text-[1rem] cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#7a7574" }}>&times;</button>
          </div>

          <div className="space-y-3 mb-6">
            <StatRow label="Total Transcriptions" value={MOCK_PROFILE.totalTranscriptions} />
            <StatRow label="Average WER" value={MOCK_PROFILE.avgWer} />
            <StatRow label="Flagged Privacy Violations" value={MOCK_PROFILE.privacyViolations} accent />
            <StatRow label="Storage Used" value={MOCK_PROFILE.storageUsed} />
          </div>

          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-3" style={{ color: "#7a7574" }}>Assigned Operators ({MOCK_PROFILE.operators.length})</p>
          <div className="space-y-2 mb-4">
            {MOCK_PROFILE.operators.map((op) => (
              <div key={op.name} className="flex items-center gap-2 p-2" style={{ backgroundColor: "#f6f3f2" }}>
                <div className="w-7 h-7 flex items-center justify-center text-[0.5625rem] font-bold" style={{ backgroundColor: "#1c1b1b", color: "#f3f0ef", borderRadius: "0px" }}>{op.avatar}</div>
                <span className="text-[0.75rem] font-semibold" style={{ color: "#1c1b1b" }}>{op.name}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button className="flex-1 py-2 text-[0.75rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}>ADD USER</button>
            <button className="flex-1 py-2 text-[0.75rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}>VIEW ALL</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, accent }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-[0.75rem]" style={{ color: "#7a7574" }}>{label}</span>
      <span className="text-[0.75rem] font-bold" style={{ color: accent ? "#b20100" : "#1c1b1b" }}>{value}</span>
    </div>
  );
}
