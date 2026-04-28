'use client';

import { useEffect, useState } from "react";
import { fetchTrashedFiles } from "../../../services/api";
import { MOCK_USER_PROFILES } from "../../../services/mock-data";

function formatDate(dateStr) {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

function formatSectionDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// Returns the number of full calendar days remaining before the file is
// permanently removed, computed in SGT (UTC+8). Returns 0 if already expired.
// Uses expires_at (the hard cutoff) rather than deleted_at.
function daysUntilExpiry(expiresAt) {
  if (!expiresAt) return 0;
  const nowSGT = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  const todaySGT = new Date(nowSGT.getFullYear(), nowSGT.getMonth(), nowSGT.getDate());

  const expSGT = new Date(new Date(expiresAt).toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  const expDaySGT = new Date(expSGT.getFullYear(), expSGT.getMonth(), expSGT.getDate());

  const diff = Math.ceil((expDaySGT - todaySGT) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

// The "Deleted" column shows the later of deleted_at and uploaded_at.
function effectiveDeletedDate(file) {
  const del = new Date(file.deleted_at).getTime();
  const upl = new Date(file.uploaded_at).getTime();
  return new Date(Math.max(del, upl)).toISOString();
}

function dateKey(dateStr) {
  return new Date(dateStr).toISOString().slice(0, 10);
}

function groupByDeletedDate(files) {
  const groups = {};
  for (const file of files) {
    const key = dateKey(file.deleted_at);
    if (!groups[key]) groups[key] = [];
    groups[key].push(file);
  }
  return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
}

function getInitials(name) {
  if (!name) return "??";
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      style={{ transition: "transform 0.15s", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SystemBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: "rgba(122, 117, 116, 0.1)", color: "#7a7574" }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      SYSTEM
    </span>
  );
}

function UserBadge({ userId }) {
  const profile = MOCK_USER_PROFILES[userId];
  if (!profile) return <span className="text-[0.8125rem]" style={{ color: "#7a7574" }}>{userId}</span>;

  const initials = getInitials(profile.name);

  return (
    <span className="inline-flex items-center gap-1.5">
      <img
        src={profile.profilePic}
        alt={profile.name}
        className="rounded-full object-cover"
        style={{ width: 20, height: 20 }}
        onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "flex"; }}
      />
      <span
        className="items-center justify-center rounded-full text-[0.5rem] font-bold hidden"
        style={{ width: 20, height: 20, backgroundColor: "#e8e4e3", color: "#1c1b1b" }}
      >
        {initials}
      </span>
      <span className="text-[0.75rem] font-medium" style={{ color: "#1c1b1b" }}>{initials}</span>
    </span>
  );
}

function DeletedByCell({ deletedBy }) {
  if (!deletedBy || deletedBy === "system") return <SystemBadge />;
  return <UserBadge userId={deletedBy} />;
}

function DateSection({ dateStr, files, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const sectionExpired = files.every((f) => daysUntilExpiry(f.expires_at) === 0);

  return (
    <div>
      {/* Section header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 cursor-pointer"
        style={{
          backgroundColor: "#faf9f8",
          border: "none",
          borderBottom: "1px solid #e8e4e3",
          textAlign: "left",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f0edec"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#faf9f8"; }}
      >
        <span style={{ color: "#7a7574" }}>
          <ChevronIcon open={open} />
        </span>
        <span className="text-[0.75rem] font-semibold" style={{ color: "#1c1b1b" }}>
          Deleted on {formatSectionDate(dateStr)}
        </span>
        <span className="text-[0.6875rem]" style={{ color: "#7a7574" }}>
          ({files.length} recording{files.length !== 1 ? "s" : ""})
        </span>
        {sectionExpired && (
          <span
            className="ml-auto inline-block px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider"
            style={{ backgroundColor: "rgba(178, 1, 0, 0.08)", color: "#b20100" }}
          >
            EXPIRED
          </span>
        )}
      </button>

      {/* Collapsible rows */}
      {open && (
        <div>
          {files.map((file) => {
            const remaining = daysUntilExpiry(file.expires_at);
            const expired = remaining === 0;
            return (
              <div
                key={file.id}
                className="flex items-center px-4 py-3"
                style={{
                  backgroundColor: "#ffffff",
                  borderBottom: "1px solid #f0edec",
                }}
              >
                <div className="w-8 flex justify-center">
                  <FileIcon />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[0.8125rem] font-medium truncate" style={{ color: "#7a7574" }}>
                    {file.name.replace(/\.[^.]+$/, "")}
                  </p>
                </div>
                <div className="w-28 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{formatDate(file.uploaded_at)}</div>
                <div className="w-28 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{formatDate(effectiveDeletedDate(file))}</div>
                <div className="w-28 flex justify-center">
                  <DeletedByCell deletedBy={file.deleted_by} />
                </div>
                <div className="w-20 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{file.duration || "\u2014"}</div>
                <div className="w-24 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{file.detectedLanguage || "\u2014"}</div>
                <div className="w-32 text-center">
                  <span
                    className="inline-block px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider"
                    style={{
                      backgroundColor: expired ? "rgba(178, 1, 0, 0.08)" : "rgba(122, 117, 116, 0.1)",
                      color: expired ? "#b20100" : "#7a7574",
                    }}
                  >
                    {expired ? "EXPIRED" : `${remaining} day${remaining !== 1 ? "s" : ""} left`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TrashPage() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTrashedFiles()
      .then(setFiles)
      .catch((err) => console.error("Error fetching trashed files:", err))
      .finally(() => setLoading(false));
  }, []);

  const groups = groupByDeletedDate(files);

  return (
    <div>
      <div className="flex items-center gap-2 text-[0.75rem] mb-1" style={{ color: "#7a7574" }}>
        <span>HOME</span><span>/</span><span style={{ color: "#1c1b1b" }}>TRASH</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>TRASH</h1>
        {files.length > 0 && (
          <button className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#7a7574" }}>
            EMPTY TRASH
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <p className="text-[0.875rem]" style={{ color: "#7a7574" }}>Loading...</p>
        </div>
      ) : files.length === 0 ? (
        <div className="py-16 text-center" style={{ backgroundColor: "#ffffff" }}>
          <svg className="mx-auto mb-4" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4c4c4" strokeWidth="1.5">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <p className="text-[0.875rem] font-semibold mb-1" style={{ color: "#1c1b1b" }}>Trash is empty</p>
          <p className="text-[0.75rem]" style={{ color: "#7a7574" }}>Deleted recordings are retained for 7 calendar days per PDPA compliance, then permanently removed.</p>
        </div>
      ) : (
        <>
          <p className="text-[0.75rem] mb-4" style={{ color: "#7a7574" }}>
            Deleted recordings are retained for 7 calendar days per PDPA compliance, then permanently removed.
          </p>

          {/* Column header */}
          <div
            className="flex items-center px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-wider"
            style={{ color: "#7a7574", borderBottom: "1px solid #e8e4e3" }}
          >
            <div className="w-8" />
            <div className="flex-1">Name</div>
            <div className="w-28 text-center">Uploaded</div>
            <div className="w-28 text-center">Deleted</div>
            <div className="w-28 text-center">Deleted By</div>
            <div className="w-20 text-center">Duration</div>
            <div className="w-24 text-center">Language</div>
            <div className="w-32 text-center">Expires In</div>
          </div>

          {/* Date-grouped sections */}
          <div>
            {groups.map(([date, groupFiles]) => (
              <DateSection key={date} dateStr={date} files={groupFiles} defaultOpen />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
