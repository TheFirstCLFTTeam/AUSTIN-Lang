'use client';

import { useState } from "react";
import Link from "next/link";

const MOCK_USERS = [
  { id: 1, name: "Elena Kostic", role: "Senior Analyst", access: "PREMIUM", status: "ACTIVE", lastActive: "2 mins ago", permissions: { readOnly: true, reviewEdit: true, adminControls: false, mlPipeline: false } },
  { id: 2, name: "Marcus Thorne", role: "Data Scientist", access: "STANDARD", status: "ACTIVE", lastActive: "14 hrs ago", permissions: { readOnly: true, reviewEdit: false, adminControls: false, mlPipeline: true } },
  { id: 3, name: "Arthur Lang", role: "System Admin", access: "PREMIUM", status: "IDLE", lastActive: "2 days ago", permissions: { readOnly: true, reviewEdit: true, adminControls: true, mlPipeline: true } },
  { id: 4, name: "Jane Wu", role: "Reviewer", access: "BASIC", status: "OFFLINE", lastActive: "5 days ago", permissions: { readOnly: true, reviewEdit: false, adminControls: false, mlPipeline: false } },
];

function AccessBadge({ level }) {
  const map = {
    PREMIUM: { bg: "#1c1b1b", color: "#ffffff" },
    STANDARD: { bg: "#7a7574", color: "#ffffff" },
    BASIC: { bg: "#e8e5e4", color: "#1c1b1b" },
  };
  const s = map[level] || map.BASIC;
  return <span className="inline-block px-2 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wider" style={{ backgroundColor: s.bg, color: s.color, borderRadius: "0px" }}>{level}</span>;
}

function StatusDot({ status }) {
  const map = { ACTIVE: "#b20100", IDLE: "#c4c4c4", OFFLINE: "#e8e5e4" };
  return (
    <span className="flex items-center gap-1.5 text-[0.75rem]" style={{ color: "#1c1b1b" }}>
      <span className="w-2 h-2 inline-block" style={{ backgroundColor: map[status] || "#e8e5e4", borderRadius: "0px" }} />
      {status}
    </span>
  );
}

function ToggleSwitch({ on }) {
  return (
    <div className="w-10 h-5 flex items-center px-0.5 cursor-pointer" style={{ backgroundColor: on ? "#b20100" : "#e8e5e4", borderRadius: "0px" }}>
      <div className="w-4 h-4 transition-all" style={{ backgroundColor: "#ffffff", borderRadius: "0px", marginLeft: on ? "18px" : "0px" }} />
    </div>
  );
}

export default function AdminPage() {
  const [selected, setSelected] = useState(MOCK_USERS[0]);
  const [tab, setTab] = useState("directory");

  const tabs = ["directory", "permissions", "logs"];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: "#b20100", letterSpacing: "-0.02em" }}>AUSTIN-Lang Control</h1>
        </div>
        <button className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}>EXPORT DATA</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 mb-6 text-[0.8125rem] font-semibold">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className="pb-1 cursor-pointer uppercase tracking-wider" style={{ backgroundColor: "transparent", border: "none", borderBottom: tab === t ? "2px solid #b20100" : "2px solid transparent", color: tab === t ? "#b20100" : "#7a7574" }}>
            {t}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Users" value="1,284" sub="+10%" />
        <KpiCard label="Pending Verifications" value="42" sub="!" accent />
        <KpiCard label="Admins" value="18" sub="Institutional" />
        <KpiCard label="ML Engineers" value="156" sub="Pipeline Ops" />
      </div>

      <div className="flex gap-6">
        {/* User Directory */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[1.25rem] font-bold uppercase tracking-tight" style={{ color: "#1c1b1b" }}>User Directory</h2>
              <p className="text-[0.6875rem]" style={{ color: "#7a7574" }}>Institutional access control and registry management.</p>
            </div>
            <button className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}>INVITE NEW USER</button>
          </div>

          <div style={{ backgroundColor: "#ffffff" }}>
            <div className="flex items-center px-5 py-3 text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574", borderBottom: "1px solid rgba(233, 188, 181, 0.15)" }}>
              <div className="w-8" /><div className="flex-1">Name</div><div className="w-32">Role</div><div className="w-24">Access</div><div className="w-24">Status</div><div className="w-24">Last Active</div>
            </div>
            {MOCK_USERS.map((user) => (
              <div key={user.id} onClick={() => setSelected(user)} className="flex items-center px-5 py-4 cursor-pointer transition-colors" style={{ backgroundColor: selected?.id === user.id ? "#f6f3f2" : "transparent", borderBottom: "1px solid rgba(233, 188, 181, 0.08)" }}>
                <div className="w-8">
                  <div className="w-7 h-7 flex items-center justify-center text-[0.5625rem] font-bold" style={{ backgroundColor: "#f6f3f2", color: "#1c1b1b", borderRadius: "0px" }}>
                    {user.name.split(" ").map(n => n[0]).join("")}
                  </div>
                </div>
                <div className="flex-1"><p className="text-[0.8125rem] font-semibold" style={{ color: "#1c1b1b" }}>{user.name}</p></div>
                <div className="w-32 text-[0.75rem]" style={{ color: "#7a7574" }}>{user.role}</div>
                <div className="w-24"><AccessBadge level={user.access} /></div>
                <div className="w-24"><StatusDot status={user.status} /></div>
                <div className="w-24 text-[0.75rem]" style={{ color: "#7a7574" }}>{user.lastActive}</div>
              </div>
            ))}
          </div>
          <p className="text-[0.625rem] mt-2" style={{ color: "#7a7574" }}>Showing {MOCK_USERS.length} of 1,284 entries</p>
        </div>

        {/* User Detail Panel */}
        {selected && (
          <div className="w-72 shrink-0 p-5" style={{ backgroundColor: "#ffffff" }}>
            <p className="text-[0.625rem] uppercase tracking-wider mb-1" style={{ color: "#b20100" }}>PROFILE / MEMBER 118</p>
            <h3 className="text-[1.125rem] font-bold mb-0.5" style={{ color: "#1c1b1b" }}>{selected.name}</h3>
            <p className="text-[0.75rem] mb-4" style={{ color: "#7a7574" }}>{selected.role} &bull; ID-AUTH-0021-B</p>

            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-3" style={{ color: "#7a7574" }}>Institutional Permissions</p>
            <div className="space-y-3">
              <PermRow label="READ-ONLY" sub="View global ledgers & statistics" on={selected.permissions.readOnly} />
              <PermRow label="REVIEW & EDIT" sub="Modify compliance flags & items" on={selected.permissions.reviewEdit} />
              <PermRow label="ADMIN CONTROLS" sub="Manage user groups & system nodes" on={selected.permissions.adminControls} />
              <PermRow label="ML PIPELINE ACCESS" sub="Execute model training & deployments" on={selected.permissions.mlPipeline} accent />
            </div>

            <div className="mt-6 space-y-2">
              <button className="w-full py-2 text-[0.8125rem] font-semibold cursor-pointer" style={{ backgroundColor: "#1c1b1b", color: "#f3f0ef", border: "none", borderRadius: "0px" }}>UPDATE AUTHORIZATION</button>
              <button className="w-full py-2 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}>REVOKE SESSION</button>
            </div>
            <p className="text-[0.5625rem] mt-3" style={{ color: "#c4c4c4" }}>Last audit: Oct 24, 2025 by System Root</p>
          </div>
        )}
      </div>

      {/* Bottom Cards */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <div className="p-5" style={{ backgroundColor: "#b20100" }}>
          <h3 className="text-[1rem] font-bold uppercase mb-1" style={{ color: "#ffffff" }}>Institutional Logs</h3>
          <p className="text-[0.75rem] mb-3" style={{ color: "rgba(255,255,255,0.7)" }}>Complete immutable history of permission changes and access requests.</p>
          <button className="text-[0.75rem] font-semibold cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#ffffff" }}>EXPORT PERMISSIONS LOG</button>
        </div>
        <div className="p-5" style={{ background: "linear-gradient(135deg, #b20100, #e10000)" }}>
          <h3 className="text-[1rem] font-bold uppercase mb-1" style={{ color: "#ffffff" }}>Mass Authorization</h3>
          <p className="text-[0.75rem] mb-3" style={{ color: "rgba(255,255,255,0.7)" }}>Update access levels for entire departments or engineering clusters.</p>
          <button className="text-[0.75rem] font-semibold cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#ffffff" }}>BATCH REVIEW ACCESS</button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, accent }) {
  return (
    <div className="p-4" style={{ backgroundColor: "#ffffff" }}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-1" style={{ color: "#7a7574" }}>{label}</p>
      <div className="flex items-end gap-2">
        <p className="text-[2rem] font-bold leading-none" style={{ color: "#1c1b1b" }}>{value}</p>
        {accent && <span className="text-[0.875rem] font-bold" style={{ color: "#b20100" }}>{sub}</span>}
        {!accent && sub && <span className="text-[0.6875rem]" style={{ color: "#7a7574" }}>{sub}</span>}
      </div>
    </div>
  );
}

function PermRow({ label, sub, on, accent }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[0.75rem] font-semibold" style={{ color: accent ? "#b20100" : "#1c1b1b" }}>{label}</p>
        <p className="text-[0.5625rem]" style={{ color: "#7a7574" }}>{sub}</p>
      </div>
      <ToggleSwitch on={on} />
    </div>
  );
}
