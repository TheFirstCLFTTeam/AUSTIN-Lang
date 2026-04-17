'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { fetchSubmittedFiles, fetchAllFilesMetadata, getCurrentUser } from "../../../services/api";
import OwnerBadge from "../components/OwnerBadge";
import { getTimeFormat, formatDateTime, TIME_FORMAT_EVENT, TIME_FORMAT_KEY } from "../../../lib/timeFormat";
import {
  getGroupIdForRole, isControlMember, getFoldersForGroup, getFolderById,
  createFolder, renameFolder, deleteFolder, getFilesInFolder,
  moveFilesToFolder,
  submitFolderRequest, getPendingRequests, approveRequest, denyRequest,
  subscribe as subscribeFolders, getControlMemberForGroup,
} from "../../../services/folders";
import {
  addFolderRequestNotification, addFolderRequestResponseNotification,
} from "../../../services/notifications";
import { createDataset } from "../../../services/datasets";
import { searchTags, normaliseTag, DATASET_TAG_CATALOGUE } from "../../../services/dataset-tags";

const FOLDER_COLS = 4;

/* Fraction of the sidebar's height to use for the preview card. */
const PREVIEW_HEIGHT_RATIO = 0.88;

/* ── Helpers ── */
function StatusBadge({ status }) {
  const styles = {
    "needs action": { bg: "rgba(178, 1, 0, 0.08)", color: "#b20100", label: "NEEDS ACTION" },
    "in review": { bg: "rgba(0, 78, 198, 0.08)", color: "#004ec6", label: "IN REVIEW" },
    transcribing: { bg: "rgba(122, 117, 116, 0.1)", color: "#7a7574", label: "TRANSCRIBING" },
    completed: { bg: "rgba(26, 127, 55, 0.08)", color: "#1a7f37", label: "COMPLETED" },
    transcribed: { bg: "rgba(158, 106, 0, 0.08)", color: "#9e6a00", label: "TRANSCRIBED" },
    queued: { bg: "rgba(122, 117, 116, 0.1)", color: "#7a7574", label: "QUEUED" },
    failed: { bg: "rgba(200, 0, 0, 0.08)", color: "#c80000", label: "FAILED" },
  };
  const s = styles[status] || styles["needs action"];
  return (
    <span
      className="inline-block px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

function getFileStatus(index) {
  const statuses = ["needs action", "in review", "transcribed", "transcribing", "completed", "needs action"];
  return statuses[index % statuses.length];
}

/* ── Icons ── */
function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="1.5">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function StarIcon({ filled, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "#f5a623" : "none"} stroke={filled ? "#f5a623" : "#7a7574"} strokeWidth="1.5" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function PinIcon({ active, size = 12, color }) {
  const stroke = color || (active ? "#b20100" : "#7a7574");
  const fill = active ? stroke : "none";
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round"
      style={{ transform: active ? "rotate(45deg)" : "none", transition: "transform 0.15s" }}
    >
      <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6h2v-6h5v-2z" />
    </svg>
  );
}

function StarButton({ active, onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      className={`w-7 h-7 flex items-center justify-center rounded-full cursor-pointer transition-opacity ${active ? "" : "opacity-0 group-hover:opacity-100"}`}
      style={{ backgroundColor: "transparent", border: "none" }}
      aria-label={active ? "Unstar" : "Star"}
      title={active ? "Unstar" : "Star"}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.06)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
    >
      <StarIcon filled={active} />
    </button>
  );
}

function SelectCheckbox({ checked, onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      className="w-7 h-7 flex items-center justify-center cursor-pointer"
      style={{ backgroundColor: "transparent", border: "none" }}
      aria-label={checked ? "Deselect" : "Select"}
    >
      {checked ? (
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="0" y="0" width="16" height="16" rx="0" fill="#b20100" />
          <polyline points="3.5 8 6.5 11 12.5 5" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="0.5" y="0.5" width="15" height="15" rx="0" fill="none" stroke="#7a7574" strokeWidth="1" />
        </svg>
      )}
    </button>
  );
}

function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-7 h-7 flex items-center justify-center rounded-full cursor-pointer transition-opacity ${open ? "" : "opacity-0 group-hover:opacity-100"}`}
        style={{ backgroundColor: open ? "rgba(0,0,0,0.06)" : "transparent", border: "none" }}
        aria-label="More actions"
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.06)"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#7a7574">
          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-8 z-20 py-1"
          style={{ backgroundColor: "#ffffff", borderRadius: "6px", border: "1px solid #e8e4e3", boxShadow: "0 8px 24px rgba(0,0,0,0.08)", minWidth: "170px" }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { item.onClick(); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[0.8125rem] cursor-pointer transition-colors"
              style={{ backgroundColor: "transparent", border: "none", color: "#1c1b1b", textAlign: "left" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f6f3f2"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <span className="w-4 flex items-center justify-center">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThreeDotMenu({ onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      className="w-7 h-7 flex items-center justify-center rounded-full cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
      style={{ backgroundColor: "transparent", border: "none" }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.06)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#7a7574">
        <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
      </svg>
    </button>
  );
}

/* ── Dataset tag fuzzy picker ──
   Inline combobox used in the Create Dataset dialog. Accepts both catalogue
   matches (fuzzy-ranked) and free-form tags typed by the user. */
function TagPicker({ selected, onChange }) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  const suggestions = useMemo(() => searchTags(query, selected).slice(0, 8), [query, selected]);
  const normalisedQuery = normaliseTag(query);
  const hasExactMatch = suggestions.some((s) => s.value === normalisedQuery);
  const canAddCustom = normalisedQuery.length > 0 && !hasExactMatch && !selected.includes(normalisedQuery);

  useEffect(() => { setActiveIdx(0); }, [query]);

  const addTag = (value) => {
    const clean = normaliseTag(value);
    if (!clean || selected.includes(clean)) return;
    onChange([...selected, clean]);
    setQuery("");
    setActiveIdx(0);
    inputRef.current?.focus();
  };

  const removeTag = (value) => onChange(selected.filter((t) => t !== value));

  const onKeyDown = (e) => {
    const total = suggestions.length + (canAddCustom ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (total === 0) return;
      setActiveIdx((i) => (i + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (total === 0) return;
      setActiveIdx((i) => (i - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx < suggestions.length) {
        addTag(suggestions[activeIdx].value);
      } else if (canAddCustom) {
        addTag(normalisedQuery);
      }
    } else if (e.key === "Backspace" && !query && selected.length > 0) {
      // Backspace on empty input pops the most recent chip.
      onChange(selected.slice(0, -1));
    } else if (e.key === "," || e.key === "Tab") {
      if (canAddCustom || suggestions[activeIdx]) {
        e.preventDefault();
        addTag(suggestions[activeIdx]?.value || normalisedQuery);
      }
    }
  };

  // Group suggestions so engineers can scan by category (Subtask, Acoustic, etc.)
  const grouped = useMemo(() => {
    const map = new Map();
    suggestions.forEach((s, idx) => {
      const list = map.get(s.group) || [];
      list.push({ ...s, idx });
      map.set(s.group, list);
    });
    return [...map.entries()];
  }, [suggestions]);

  const groupTotals = useMemo(() => {
    const totals = new Map();
    for (const entry of DATASET_TAG_CATALOGUE) {
      totals.set(entry.group, (totals.get(entry.group) || 0) + 1);
    }
    return totals;
  }, []);

  return (
    <div>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider"
              style={{ backgroundColor: "#1c1b1b", color: "#ffffff" }}
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="cursor-pointer"
                aria-label={`Remove tag ${tag}`}
                style={{ background: "transparent", border: "none", color: "#ffffff", padding: 0, lineHeight: 1 }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={selected.length === 0 ? "Search tags (e.g. code-switch, noisy, fine-tune)" : "Add another tag…"}
        className="w-full text-[0.8125rem] px-3 py-2 outline-none"
        style={{ backgroundColor: "#f6f3f2", border: "1px solid #f0edec", color: "#1c1b1b" }}
      />

      {/* Suggestions panel */}
      {(suggestions.length > 0 || canAddCustom) && (
        <div
          className="mt-2 max-h-56 overflow-y-auto"
          style={{ backgroundColor: "#ffffff", border: "1px solid #f0edec" }}
        >
          {grouped.map(([group, items]) => (
            <div key={group} className="py-1">
              <div
                className="px-3 py-1 text-[0.5625rem] font-semibold uppercase tracking-widest flex items-center justify-between"
                style={{ color: "#7a7574", backgroundColor: "#faf9f8" }}
              >
                <span>{group}</span>
                <span style={{ color: "#bcb7b6" }}>
                  {items.length}/{groupTotals.get(group) ?? items.length}
                </span>
              </div>
              {items.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => addTag(s.value)}
                  onMouseEnter={() => setActiveIdx(s.idx)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[0.8125rem] cursor-pointer"
                  style={{
                    backgroundColor: activeIdx === s.idx ? "#f6f3f2" : "transparent",
                    border: "none",
                    color: "#1c1b1b",
                    textAlign: "left",
                  }}
                >
                  <span className="font-medium">{s.value}</span>
                  <span className="text-[0.625rem] uppercase tracking-widest" style={{ color: "#b20100" }}>Add</span>
                </button>
              ))}
            </div>
          ))}
          {canAddCustom && (
            <button
              type="button"
              onClick={() => addTag(normalisedQuery)}
              onMouseEnter={() => setActiveIdx(suggestions.length)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[0.8125rem] cursor-pointer"
              style={{
                backgroundColor: activeIdx === suggestions.length ? "#f6f3f2" : "#fffaf9",
                border: "none",
                borderTop: "1px solid #f0edec",
                color: "#1c1b1b",
                textAlign: "left",
              }}
            >
              <span>
                Create custom tag <span className="font-bold">"{normalisedQuery}"</span>
              </span>
              <span className="text-[0.625rem] uppercase tracking-widest" style={{ color: "#b20100" }}>Enter</span>
            </button>
          )}
        </div>
      )}
      {query && suggestions.length === 0 && !canAddCustom && (
        <p className="mt-2 text-[0.6875rem]" style={{ color: "#7a7574" }}>
          No matches. Type letters, numbers, or dashes to create a custom tag.
        </p>
      )}
    </div>
  );
}

/* ── Filter chip ── */
function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 text-[0.75rem] font-medium cursor-pointer transition-colors"
      style={{
        backgroundColor: active ? "#1c1b1b" : "transparent",
        color: active ? "#ffffff" : "#7a7574",
        border: active ? "none" : "1px solid #d4d4d4",
        borderRadius: "16px",
      }}
    >
      {label}
    </button>
  );
}

/* ── Column filter dropdown ── */
function ColumnFilterDropdown({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const hasFilter = value !== "all";

  return (
    <div ref={ref} className="relative inline-flex items-center justify-center">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 cursor-pointer text-[0.6875rem] font-semibold uppercase tracking-wider"
        style={{
          backgroundColor: "transparent",
          border: "none",
          color: hasFilter ? "#b20100" : "#7a7574",
          padding: 0,
        }}
      >
        <span>{label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute top-full left-1/2 z-30 mt-1 py-1"
          style={{
            transform: "translateX(-50%)",
            backgroundColor: "#ffffff",
            borderRadius: "6px",
            border: "1px solid #e8e4e3",
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            minWidth: "140px",
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[0.75rem] cursor-pointer transition-colors"
              style={{
                backgroundColor: value === opt.value ? "#f6f3f2" : "transparent",
                border: "none",
                color: value === opt.value ? "#b20100" : "#1c1b1b",
                textAlign: "left",
                fontWeight: value === opt.value ? 600 : 400,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f6f3f2"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = value === opt.value ? "#f6f3f2" : "transparent"; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Group files by date ── */
function groupFilesByDate(files) {
  const groups = [];
  const groupMap = new Map();
  for (const file of files) {
    const key = formatDate(file.uploaded_at);
    if (!groupMap.has(key)) {
      const group = { date: key, rawDate: file.uploaded_at, files: [] };
      groupMap.set(key, group);
      groups.push(group);
    }
    groupMap.get(key).files.push(file);
  }
  // Sort groups by date descending (most recent first)
  groups.sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate));
  return groups;
}

/* ── Duration parsing helper (mm:ss or h:mm:ss → total seconds) ── */
function parseDuration(dur) {
  if (!dur) return null;
  const parts = dur.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/* ── Duration bucket label ── */
function getDurationBucket(dur) {
  const secs = parseDuration(dur);
  if (secs == null) return "unknown";
  if (secs < 60) return "<1 min";
  if (secs < 300) return "1–5 min";
  if (secs < 600) return "5–10 min";
  if (secs < 1800) return "10–30 min";
  return "30+ min";
}

/* ── WER range tooltip (dual-handle slider + number steppers) ── */
const WER_TOOLTIP_LINGER_MS = 200;

function WerRangeTooltip({ werRange, onChangeRange, onClear }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const hideTimerRef = useRef(null);
  const trackRef = useRef(null);

  const hasFilter = werRange[0] !== 0 || werRange[1] !== 100;

  const show = () => {
    clearTimeout(hideTimerRef.current);
    setShowTooltip(true);
  };
  const hideWithDelay = () => {
    hideTimerRef.current = setTimeout(() => setShowTooltip(false), WER_TOOLTIP_LINGER_MS);
  };

  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

  const setMin = (v) => {
    const clamped = clamp(v);
    onChangeRange([Math.min(clamped, werRange[1]), werRange[1]]);
  };
  const setMax = (v) => {
    const clamped = clamp(v);
    onChangeRange([werRange[0], Math.max(clamped, werRange[0])]);
  };

  // Drag logic
  const draggingRef = useRef(null); // "min" | "max" | null

  const getPercentFromEvent = useCallback((e) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return clamp((x / rect.width) * 100);
  }, []);

  const onPointerDown = useCallback((handle) => (e) => {
    e.preventDefault();
    draggingRef.current = handle;

    const onMove = (ev) => {
      if (!draggingRef.current) return;
      const pct = getPercentFromEvent(ev);
      if (draggingRef.current === "min") {
        onChangeRange((prev) => [Math.min(pct, prev[1]), prev[1]]);
      } else {
        onChangeRange((prev) => [prev[0], Math.max(pct, prev[0])]);
      }
    };
    const onUp = () => {
      draggingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove);
    document.addEventListener("touchend", onUp);
  }, [getPercentFromEvent, onChangeRange]);

  return (
    <div className="relative inline-flex items-center justify-center">
      <button
        className="flex items-center gap-1 cursor-pointer text-[0.6875rem] font-semibold uppercase tracking-wider"
        style={{
          backgroundColor: "transparent",
          border: "none",
          color: hasFilter ? "#b20100" : "#7a7574",
          padding: 0,
        }}
        onMouseEnter={show}
        onMouseLeave={hideWithDelay}
      >
        <span>WER</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {showTooltip && (
        <div
          className="absolute top-full left-1/2 z-30 mt-2 p-4"
          style={{
            transform: "translateX(-50%)",
            backgroundColor: "#1c1b1b",
            borderRadius: "8px",
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
            width: "280px",
          }}
          onMouseEnter={show}
          onMouseLeave={hideWithDelay}
        >
          {/* Arrow */}
          <div
            className="absolute left-1/2"
            style={{
              top: "-4px",
              transform: "translateX(-50%) rotate(45deg)",
              width: "8px",
              height: "8px",
              backgroundColor: "#1c1b1b",
            }}
          />

          {/* Title row */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-[0.625rem] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>
              Word Error Rate Range
            </span>
            {hasFilter && (
              <button
                onClick={() => { onClear(); }}
                className="text-[0.625rem] font-semibold cursor-pointer"
                style={{ color: "#ff6b6b", backgroundColor: "transparent", border: "none", padding: 0 }}
              >
                Reset
              </button>
            )}
          </div>

          {/* Dual-handle slider */}
          <div className="mb-4 px-1">
            <div
              ref={trackRef}
              className="relative h-1.5 rounded-full"
              style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
            >
              {/* Active range fill */}
              <div
                className="absolute h-full rounded-full"
                style={{
                  left: `${werRange[0]}%`,
                  width: `${werRange[1] - werRange[0]}%`,
                  background: "linear-gradient(135deg, #b20100, #e10000)",
                }}
              />
              {/* Min handle */}
              <div
                onMouseDown={onPointerDown("min")}
                onTouchStart={onPointerDown("min")}
                className="absolute w-4 h-4 rounded-full cursor-grab active:cursor-grabbing"
                style={{
                  left: `${werRange[0]}%`,
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  backgroundColor: "#b20100",
                  border: "2px solid #ffffff",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                }}
              />
              {/* Max handle */}
              <div
                onMouseDown={onPointerDown("max")}
                onTouchStart={onPointerDown("max")}
                className="absolute w-4 h-4 rounded-full cursor-grab active:cursor-grabbing"
                style={{
                  left: `${werRange[1]}%`,
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  backgroundColor: "#e10000",
                  border: "2px solid #ffffff",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                }}
              />
            </div>
            {/* Scale labels */}
            <div className="flex justify-between mt-1.5">
              <span className="text-[0.5625rem]" style={{ color: "rgba(255,255,255,0.3)" }}>0%</span>
              <span className="text-[0.5625rem]" style={{ color: "rgba(255,255,255,0.3)" }}>100%</span>
            </div>
          </div>

          {/* Number inputs with steppers */}
          <div className="flex items-center gap-3">
            <WerNumberField label="Min" value={werRange[0]} onChange={setMin} />
            <div className="text-[0.75rem] font-medium pt-4" style={{ color: "rgba(255,255,255,0.3)" }}>–</div>
            <WerNumberField label="Max" value={werRange[1]} onChange={setMax} />
          </div>
        </div>
      )}
    </div>
  );
}

function WerNumberField({ label, value, onChange }) {
  const handleInput = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    if (raw === "") { onChange(0); return; }
    onChange(parseInt(raw, 10));
  };

  return (
    <div className="flex-1">
      <span className="block text-[0.5625rem] font-semibold uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>
        {label}
      </span>
      <div
        className="flex items-center"
        style={{
          backgroundColor: "rgba(255,255,255,0.08)",
          borderRadius: "4px",
          border: "1px solid rgba(255,255,255,0.12)",
          overflow: "hidden",
        }}
      >
        <button
          onClick={() => onChange(value - 1)}
          className="w-7 h-8 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
          style={{ backgroundColor: "transparent", border: "none", color: "rgba(255,255,255,0.5)" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <input
          type="text"
          value={value}
          onChange={handleInput}
          className="flex-1 h-8 text-center text-[0.75rem] font-medium"
          style={{
            backgroundColor: "transparent",
            border: "none",
            borderLeft: "1px solid rgba(255,255,255,0.08)",
            borderRight: "1px solid rgba(255,255,255,0.08)",
            color: "#ffffff",
            outline: "none",
            width: "0",
            minWidth: "0",
          }}
        />
        <button
          onClick={() => onChange(value + 1)}
          className="w-7 h-8 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
          style={{ backgroundColor: "transparent", border: "none", color: "rgba(255,255,255,0.5)" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ── Folder card ── */
function FolderCard({ folder, isSelected, onClick }) {
  const baseBg = isSelected ? "#eef0fc" : "#ffffff";
  const hoverBg = isSelected ? "#eef0fc" : "#f6f3f2";
  return (
    <div
      onClick={onClick}
      className="group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors"
      style={{
        backgroundColor: baseBg,
        borderRadius: "8px",
        border: isSelected ? "1px solid #b20100" : "1px solid #e8e4e3",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = hoverBg; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = baseBg; }}
    >
      <FolderIcon />
      <div className="flex-1 min-w-0">
        <div className="text-[0.8125rem] font-medium truncate" style={{ color: "#1c1b1b" }}>
          {folder.name}
        </div>
        <div className="text-[0.6875rem] truncate" style={{ color: "#7a7574" }}>
          {folder.fileCount} file{folder.fileCount === 1 ? "" : "s"}
        </div>
      </div>
      <ThreeDotMenu />
    </div>
  );
}

/* ── Transcript preview (scrolls on hover) ── */
function TranscriptPreview({ text }) {
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const animRef = useRef(null);

  const startScroll = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const overflow = content.scrollHeight - container.clientHeight;
    if (overflow <= 0) return;

    container.scrollTop = 0;
    const duration = overflow * 30; // ~30ms per pixel for readable speed
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      container.scrollTop = overflow * progress;
      if (progress < 1) {
        animRef.current = requestAnimationFrame(step);
      }
    }
    animRef.current = requestAnimationFrame(step);
  }, []);

  const stopScroll = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, []);

  return (
    <div
      ref={containerRef}
      onMouseEnter={startScroll}
      onMouseLeave={stopScroll}
      className="h-32 overflow-hidden px-3 py-2.5"
      style={{ backgroundColor: "#faf9f8", borderBottom: "1px solid #e8e4e3" }}
    >
      <p
        ref={contentRef}
        className="text-[0.75rem] leading-relaxed"
        style={{ color: "#4a4544" }}
      >
        {text}
      </p>
    </div>
  );
}

/* ── Detail row ── */
function DetailRow({ label, value, accent }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[0.75rem]" style={{ color: "#7a7574" }}>{label}</span>
      <span className="text-[0.75rem] font-semibold" style={{ color: accent ? "#b20100" : "#1c1b1b" }}>{value}</span>
    </div>
  );
}

/* ── Main page ── */
export default function FilesPage() {
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [viewMode, setViewMode] = useState("list");
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const user = getCurrentUser();
  const userRole = user?.role || "generic";
  const userId = user?.id || "anon";

  // Reviewer and admin personas default to "in review" filter
  const defaultFilter = (userRole === "reviewer" || userRole === "admin") ? "in review" : "all";
  const [activeFilter, setActiveFilter] = useState(defaultFilter);
  const [showAllFolders, setShowAllFolders] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeFormat, setTimeFormatState] = useState("12h");
  const [previewHeight, setPreviewHeight] = useState(null);
  const audioRef = useRef(null);
  const previewRef = useRef(null);

  // Folder organisation state
  const groupId = getGroupIdForRole(userRole);
  const isControl = isControlMember(userId, groupId);
  const [folders, setFolders] = useState(() => getFoldersForGroup(groupId));
  const [folderFileMap, setFolderFileMap] = useState(() => new Map());
  const [pendingRequests, setPendingRequests] = useState(() => isControl ? getPendingRequests(groupId) : []);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [requestFolderOpen, setRequestFolderOpen] = useState(false);
  const [manageFoldersOpen, setManageFoldersOpen] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(null);  // folderId being renamed
  const [toast, setToast] = useState(null);

  // Multi-select organise mode
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [checkedFiles, setCheckedFiles] = useState(() => new Set());
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);

  // Dataset creation mode (engineer only)
  const [datasetMode, setDatasetMode] = useState(false);
  const [datasetDialogOpen, setDatasetDialogOpen] = useState(false);
  const [datasetName, setDatasetName] = useState("");
  const [datasetDesc, setDatasetDesc] = useState("");
  const [datasetTags, setDatasetTags] = useState([]);
  const datasetNameRef = useRef(null);

  const [favorites, setFavorites] = useState(() => new Set());
  const [pinned, setPinned] = useState(() => []);

  // Column filters
  const [colFilterStatus, setColFilterStatus] = useState("all");
  const [colFilterDate, setColFilterDate] = useState("all");
  const [colFilterDuration, setColFilterDuration] = useState("all");
  const [colFilterLanguage, setColFilterLanguage] = useState("all");
  const [werRange, setWerRange] = useState([0, 100]);

  useEffect(() => {
    try {
      const favs = JSON.parse(localStorage.getItem(`austin.favorites.${userId}`) || "[]");
      const pins = JSON.parse(localStorage.getItem(`austin.pins.${userId}`) || "[]");
      setFavorites(new Set(favs));
      setPinned(pins);
    } catch {
      setFavorites(new Set());
      setPinned([]);
    }
  }, [userId]);

  const enterMultiSelect = (fileId) => {
    setMultiSelectMode(true);
    setCheckedFiles(new Set([fileId]));
  };

  const exitMultiSelect = () => {
    setMultiSelectMode(false);
    setCheckedFiles(new Set());
    setMoveDialogOpen(false);
  };

  const toggleChecked = (fileId) => {
    setCheckedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
      return next;
    });
  };

  // Dataset creation helpers (engineer)
  const enterDatasetMode = () => {
    setDatasetMode(true);
    setCheckedFiles(new Set());
  };

  const exitDatasetMode = () => {
    setDatasetMode(false);
    setCheckedFiles(new Set());
    setDatasetDialogOpen(false);
    setDatasetName("");
    setDatasetDesc("");
    setDatasetTags([]);
  };

  const openDatasetDialog = () => {
    if (checkedFiles.size === 0) return;
    // Default name: current timestamp
    const now = new Date();
    const ts = now.toISOString().replace(/T/, " ").replace(/\..+/, "").replace(/:/g, "-");
    setDatasetName(ts);
    // Default description: date range of selected files
    const selectedFileObjs = files.filter((f) => checkedFiles.has(f.id));
    const dates = selectedFileObjs
      .map((f) => f.uploaded_at)
      .filter(Boolean)
      .map((d) => new Date(d))
      .sort((a, b) => a - b);
    if (dates.length > 0) {
      const fmt = (d) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      setDatasetDesc(`Recordings from ${fmt(dates[0])} to ${fmt(dates[dates.length - 1])}`);
    } else {
      setDatasetDesc("");
    }
    setDatasetDialogOpen(true);
  };

  const handleCreateDataset = () => {
    if (!datasetName.trim() || checkedFiles.size === 0) return;
    const count = checkedFiles.size;
    createDataset({
      name: datasetName.trim(),
      description: datasetDesc.trim(),
      fileIds: [...checkedFiles],
      tags: datasetTags,
      createdBy: userId,
    });
    setToast(`Dataset "${datasetName.trim()}" created with ${count} file${count !== 1 ? "s" : ""}.`);
    exitDatasetMode();
  };

  // Focus and place cursor at the start of the dataset name input
  useEffect(() => {
    if (datasetDialogOpen && datasetNameRef.current) {
      const input = datasetNameRef.current;
      input.focus();
      input.setSelectionRange(0, 0);
    }
  }, [datasetDialogOpen]);

  // Subscribe to folder store changes
  useEffect(() => {
    const refreshFolders = () => {
      setFolders(getFoldersForGroup(groupId));
      if (isControl) setPendingRequests(getPendingRequests(groupId));
      // Rebuild folder→files mapping
      const map = new Map();
      getFoldersForGroup(groupId).forEach((f) => {
        map.set(f.id, getFilesInFolder(f.id));
      });
      setFolderFileMap(map);
    };
    refreshFolders();
    return subscribeFolders(refreshFolders);
  }, [groupId, isControl]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleFavorite = (id) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(`austin.favorites.${userId}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const togglePin = (id) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
      try { localStorage.setItem(`austin.pins.${userId}`, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Sync the time-format preference from localStorage, and react to changes
  // from the profile page (same-tab custom event) or other tabs (storage event).
  useEffect(() => {
    setTimeFormatState(getTimeFormat());
    const handleCustom = (e) => setTimeFormatState(e.detail ?? getTimeFormat());
    const handleStorage = (e) => {
      if (e.key === TIME_FORMAT_KEY) setTimeFormatState(getTimeFormat());
    };
    window.addEventListener(TIME_FORMAT_EVENT, handleCustom);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(TIME_FORMAT_EVENT, handleCustom);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // Reset playback when the selected file changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
  }, [selected?.id]);

  // Size the preview card as a fraction of the sidebar's current height.
  useEffect(() => {
    if (!selected) return;
    const sidebar = document.querySelector("aside");
    if (!sidebar) return;
    const compute = () => {
      setPreviewHeight(sidebar.offsetHeight * PREVIEW_HEIGHT_RATIO);
    };
    compute();
    window.addEventListener("resize", compute);
    const ro = new ResizeObserver(compute);
    ro.observe(sidebar);
    return () => {
      window.removeEventListener("resize", compute);
      ro.disconnect();
    };
  }, [selected]);

  // When drilling into a folder, pre-select the first file inside it. When
  // leaving the folder view, clear the selection so the detail pane hides.
  useEffect(() => {
    if (!selectedFolder) {
      const firstRoot = files.find((f) => !f.dataset);
      setSelected(firstRoot || null);
      return;
    }
    // Find folder to check if it's dataset-backed or manual
    const folder = folders.find((f) => f.id === selectedFolder);
    if (folder?.datasetId) {
      if (!selected || selected.dataset !== folder.datasetId) {
        const first = files.find((f) => f.dataset === folder.datasetId);
        setSelected(first || null);
      }
    } else {
      const memberSet = folderFileMap.get(selectedFolder);
      if (memberSet && (!selected || !memberSet.has(selected.id))) {
        const first = files.find((f) => memberSet.has(f.id));
        setSelected(first || null);
      }
    }
  }, [selectedFolder, files, folders, folderFileMap]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch((err) => console.error("Audio play failed:", err));
    } else {
      audio.pause();
    }
  };

  const refetchFiles = useCallback(() => {
    const fetchFn = (userRole === "engineer" || userRole === "admin")
      ? fetchAllFilesMetadata
      : () => fetchSubmittedFiles().then((data) => data.map((f) => ({ ...f, isOwned: true })));
    return fetchFn()
      .then((data) => { setFiles(data); })
      .catch((error) => console.error("Error fetching files:", error));
  }, [userRole]);

  useEffect(() => {
    setLoading(true);
    refetchFiles().finally(() => setLoading(false));
  }, [refetchFiles]);

  const pageTitle = userRole === "generic" ? "MY TRANSCRIPTS" : "ALL TRANSCRIPTS";

  // Checkbox select mode is active for either file-move or dataset creation.
  const isSelectMode = multiSelectMode || datasetMode;

  const activeFolder = selectedFolder
    ? folders.find((f) => f.id === selectedFolder)
    : null;

  // Helper: count files in a manual folder
  const folderFileCount = (folderId) => {
    const folder = folders.find((f) => f.id === folderId);
    if (folder?.datasetId) {
      return files.filter((f) => f.dataset === folder.datasetId).length;
    }
    return folderFileMap.get(folderId)?.size || 0;
  };

  // Non-system (user-created) folders for this group
  const userFolders = folders.filter((f) => !f.isSystem);
  // System (dataset) folders
  const systemFolders = folders.filter((f) => f.isSystem);

  // All folders combined for the grid display, with file counts attached
  const allDisplayFolders = [...systemFolders, ...userFolders].map((f) => ({
    ...f,
    fileCount: folderFileCount(f.id),
  }));
  const visibleFolders = showAllFolders ? allDisplayFolders : allDisplayFolders.slice(0, FOLDER_COLS);

  // Split folders so the overflow row is right-aligned: full rows render normally,
  // the partial last row is padded with empty cells on the left.
  const fullRowCount = Math.floor(visibleFolders.length / FOLDER_COLS) * FOLDER_COLS;
  const fullRowFolders = visibleFolders.slice(0, fullRowCount);
  const lastRowFolders = visibleFolders.slice(fullRowCount);
  const lastRowPad = lastRowFolders.length > 0
    ? FOLDER_COLS - lastRowFolders.length
    : 0;

  const filters = [
    { key: "all", label: "All" },
    { key: "starred", label: "Starred" },
    { key: "needs action", label: "Needs Action" },
    { key: "in review", label: "In Review" },
    { key: "transcribing", label: "Transcribing" },
  ];

  // Base files with status attached, scoped to folder
  const scopedFiles = files.map((f, i) => ({ ...f, _status: f.status || getFileStatus(i) }))
    .filter((f) => {
      if (!selectedFolder) return !f.dataset;
      // System folder (dataset-backed)
      const folder = folders.find((fo) => fo.id === selectedFolder);
      if (folder?.datasetId) return f.dataset === folder.datasetId;
      // Manual folder — check membership
      const memberSet = folderFileMap.get(selectedFolder);
      return memberSet ? memberSet.has(f.id) : false;
    });

  // Build dynamic filter options from the scoped dataset
  const colStatusOptions = [
    { value: "all", label: "All statuses" },
    ...[...new Set(scopedFiles.map((f) => f._status))].sort().map((s) => ({
      value: s, label: s.charAt(0).toUpperCase() + s.slice(1),
    })),
  ];
  const colDateOptions = [
    { value: "all", label: "All dates" },
    ...[...new Set(scopedFiles.map((f) => formatDate(f.uploaded_at)))].sort((a, b) => {
      return new Date(b) - new Date(a);
    }).map((d) => ({ value: d, label: d })),
  ];
  const colDurationOptions = [
    { value: "all", label: "All durations" },
    ...[...new Set(scopedFiles.map((f) => getDurationBucket(f.duration)))].sort().map((d) => ({
      value: d, label: d,
    })),
  ];
  const colLanguageOptions = [
    { value: "all", label: "All languages" },
    ...[...new Set(scopedFiles.map((f) => f.detectedLanguage).filter(Boolean))].sort().map((l) => ({
      value: l, label: l,
    })),
  ];
  const werHasFilter = werRange[0] !== 0 || werRange[1] !== 100;

  const filteredFiles = scopedFiles
    .filter((f) => {
      if (activeFilter === "starred") return favorites.has(f.id);
      if (activeFilter === "all") return true;
      return f._status === activeFilter;
    })
    .filter((f) => {
      if (colFilterStatus !== "all" && f._status !== colFilterStatus) return false;
      if (colFilterDate !== "all" && formatDate(f.uploaded_at) !== colFilterDate) return false;
      if (colFilterDuration !== "all" && getDurationBucket(f.duration) !== colFilterDuration) return false;
      if (colFilterLanguage !== "all" && f.detectedLanguage !== colFilterLanguage) return false;
      if (werHasFilter) {
        if (f.wer == null || f.wer === 'NA') return false;
        if (f.wer < werRange[0] || f.wer > werRange[1]) return false;
      }
      return true;
    });

  const hasActiveColumnFilter = colFilterStatus !== "all" || colFilterDate !== "all" || colFilterDuration !== "all" || colFilterLanguage !== "all" || werHasFilter;
  const clearAllColumnFilters = () => {
    setColFilterStatus("all");
    setColFilterDate("all");
    setColFilterDuration("all");
    setColFilterLanguage("all");
    setWerRange([0, 100]);
  };

  const pinnedSet = new Set(pinned);
  const pinnedFiles = pinned
    .map((id) => filteredFiles.find((f) => f.id === id))
    .filter(Boolean);
  const unpinnedFiles = filteredFiles.filter((f) => !pinnedSet.has(f.id));

  // Group unpinned files by date for rendering.
  // For reviewer/admin, sort "in review" files to the top within each group.
  const dateGroups = groupFilesByDate(unpinnedFiles);
  if (userRole === "reviewer" || userRole === "admin") {
    for (const group of dateGroups) {
      group.files.sort((a, b) => {
        const aReview = a._status === "in review" ? 0 : 1;
        const bReview = b._status === "in review" ? 0 : 1;
        return aReview - bReview;
      });
    }
  }

  const renderListRow = (file) => {
    const isSelected = selected?.id === file.id;
    const isFav = favorites.has(file.id);
    const isPinned = pinnedSet.has(file.id);
    const isChecked = checkedFiles.has(file.id);
    return (
      <div
        key={file.id}
        onClick={() => isSelectMode ? toggleChecked(file.id) : setSelected(file)}
        onDoubleClick={() => {
          if (!isSelectMode && (file.isOwned || userRole === "admin")) router.push(`/files/${file.id}`);
        }}
        className="group flex items-center px-4 py-3 cursor-pointer transition-colors"
        style={{
          backgroundColor: isSelectMode && isChecked ? "rgba(178, 1, 0, 0.04)" : isSelected && !isSelectMode ? "#eef0fc" : "#ffffff",
          borderBottom: "1px solid #f0edec",
        }}
        onMouseEnter={(e) => { const base = isSelectMode && isChecked ? "rgba(178, 1, 0, 0.04)" : isSelected && !isSelectMode ? "#eef0fc" : "#ffffff"; if (e.currentTarget.style.backgroundColor === base) e.currentTarget.style.backgroundColor = "#f6f3f2"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isSelectMode && isChecked ? "rgba(178, 1, 0, 0.04)" : isSelected && !isSelectMode ? "#eef0fc" : "#ffffff"; }}
      >
        <div className="w-8 flex justify-center">
          {isSelectMode ? (
            <SelectCheckbox checked={isChecked} onClick={() => toggleChecked(file.id)} />
          ) : (
            <StarButton active={isFav} onClick={() => toggleFavorite(file.id)} />
          )}
        </div>
        <div className="w-8 flex items-center gap-1">
          <FileIcon />
          {isPinned && <PinIcon active size={10} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[0.8125rem] font-medium truncate" style={{ color: "#1c1b1b" }}>
            {file.name.replace(/\.[^.]+$/, "")}
          </p>
        </div>
        {userRole !== "generic" && (
          <div className="w-28 flex justify-center">
            <OwnerBadge
              owner={file.ownerId || file.ownerName}
              selfId={file.isOwned ? (file.ownerId || file.ownerName) : null}
              size="xs"
            />
          </div>
        )}
        <div className="w-28 text-center"><StatusBadge status={file._status} /></div>
        <div className="w-28 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{formatDate(file.uploaded_at)}</div>
        <div className="w-20 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{file.duration || "\u2014"}</div>
        <div className="w-24 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{file.detectedLanguage || "\u2014"}</div>
        <div className="w-16 text-center text-[0.8125rem]" style={{ color: file.wer != null && file.wer !== 'NA' ? "#b20100" : "#7a7574" }}>{file.wer != null && file.wer !== 'NA' ? `${file.wer}%` : "\u2014"}</div>
        <div className="w-8 flex justify-center">
          <RowMenu items={[
            { label: isPinned ? "Unpin" : "Pin to top", icon: <PinIcon active={isPinned} size={12} />, onClick: () => togglePin(file.id) },
            { label: isFav ? "Remove star" : "Star", icon: <StarIcon filled={isFav} size={12} />, onClick: () => toggleFavorite(file.id) },
            { label: "Organise files", icon: <FolderIcon />, onClick: () => enterMultiSelect(file.id) },
          ]} />
        </div>
      </div>
    );
  };

  const renderGridCard = (file) => {
    const isSelected = selected?.id === file.id;
    const isFav = favorites.has(file.id);
    const isPinned = pinnedSet.has(file.id);
    const isChecked = checkedFiles.has(file.id);
    return (
      <div
        key={file.id}
        onClick={() => isSelectMode ? toggleChecked(file.id) : setSelected(file)}
        onDoubleClick={() => {
          if (!isSelectMode && (file.isOwned || userRole === "admin")) router.push(`/files/${file.id}`);
        }}
        className="group cursor-pointer transition-colors overflow-hidden relative"
        style={{
          backgroundColor: isSelectMode && isChecked ? "rgba(178, 1, 0, 0.04)" : isSelected && !isSelectMode ? "#eef0fc" : "#ffffff",
          borderRadius: "8px",
          border: isSelectMode && isChecked ? "2px solid #b20100" : isSelected && !isSelectMode ? "2px solid #b20100" : "1px solid #e8e4e3",
        }}
        onMouseEnter={(e) => { if (!isSelected || isSelectMode) e.currentTarget.style.backgroundColor = "#f6f3f2"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isSelectMode && isChecked ? "rgba(178, 1, 0, 0.04)" : isSelected && !isSelectMode ? "#eef0fc" : "#ffffff"; }}
      >
        <div className="absolute top-2 right-2 z-10" style={{ backgroundColor: (isFav || isChecked) ? "rgba(255,255,255,0.9)" : "transparent", borderRadius: "9999px" }}>
          {isSelectMode ? (
            <SelectCheckbox checked={isChecked} onClick={() => toggleChecked(file.id)} />
          ) : (
            <StarButton active={isFav} onClick={() => toggleFavorite(file.id)} />
          )}
        </div>
        {file.transcriptHeader ? (
          <TranscriptPreview text={file.transcriptHeader} />
        ) : (
          <div className="h-32 flex items-center justify-center" style={{ backgroundColor: "#f6f3f2", borderBottom: "1px solid #e8e4e3" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4bfbe" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="8" y1="13" x2="16" y2="13" />
              <line x1="8" y1="17" x2="12" y2="17" />
            </svg>
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <FileIcon />
          {isPinned && <PinIcon active size={10} />}
          <div className="flex-1 min-w-0">
            <p className="text-[0.8125rem] font-medium truncate" style={{ color: "#1c1b1b" }}>
              {file.name.replace(/\.[^.]+$/, "")}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[0.6875rem]" style={{ color: "#7a7574" }}>
                {formatDate(file.uploaded_at)}
              </span>
              <StatusBadge status={file._status} />
            </div>
          </div>
          <RowMenu items={[
            { label: isPinned ? "Unpin" : "Pin to top", icon: <PinIcon active={isPinned} size={12} />, onClick: () => togglePin(file.id) },
            { label: isFav ? "Remove star" : "Star", icon: <StarIcon filled={isFav} size={12} />, onClick: () => toggleFavorite(file.id) },
            { label: "Organise files", icon: <FolderIcon />, onClick: () => enterMultiSelect(file.id) },
          ]} />
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4">
          <DotLottieReact
            src="https://lottie.host/c0dd85b9-4b16-423a-acc1-a99b7db2fa8b/JTRJuIh54G.lottie"
            loop autoplay style={{ width: 200, height: 200 }}
          />
          <p className="text-[0.875rem] font-medium" style={{ color: "#7a7574" }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-6" style={{ minHeight: "calc(100vh - 7rem)" }}>
      {/* ══ Left side: folders + files ══ */}
      <div className="flex-1 min-w-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[0.75rem] mb-1" style={{ color: "#7a7574" }}>
          <span>HOME</span><span>/</span>
          {activeFolder ? (
            <>
              <button
                onClick={() => setSelectedFolder(null)}
                className="cursor-pointer"
                style={{ color: "#7a7574", backgroundColor: "transparent", border: "none", padding: 0 }}
              >
                {pageTitle}
              </button>
              <span>/</span>
              <span style={{ color: "#1c1b1b" }}>{activeFolder.name.toUpperCase()}</span>
            </>
          ) : (
            <span style={{ color: "#1c1b1b" }}>{pageTitle}</span>
          )}
        </div>

        {/* Header row */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>
              {pageTitle}
            </h1>
            {userRole === "engineer" && (
              datasetMode ? (
                <button
                  onClick={openDatasetDialog}
                  disabled={checkedFiles.size === 0}
                  className="px-3 py-1.5 text-[0.75rem] font-semibold uppercase tracking-wider cursor-pointer flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundColor: "#1c1b1b",
                    border: "none",
                    borderRadius: "0px",
                    color: "#ffffff",
                  }}
                >
                  Confirm
                </button>
              ) : !isSelectMode && (
                <button
                  onClick={enterDatasetMode}
                  className="px-3 py-1.5 text-[0.75rem] font-semibold uppercase tracking-wider cursor-pointer flex items-center gap-1.5"
                  style={{
                    background: "linear-gradient(135deg, #b20100, #e10000)",
                    border: "none",
                    borderRadius: "0px",
                    color: "#ffffff",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                  Create Dataset
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Filter chips */}
            <div className="flex items-center gap-2">
              {filters.map((f) => (
                <FilterChip
                  key={f.key}
                  label={f.label}
                  active={activeFilter === f.key}
                  onClick={() => setActiveFilter(f.key)}
                />
              ))}
            </div>
            {/* View toggle */}
            <div className="flex" style={{ border: "1px solid #e8e4e3", borderRadius: "6px", overflow: "hidden" }}>
              {["list", "grid"].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className="w-9 h-9 flex items-center justify-center cursor-pointer"
                  style={{
                    backgroundColor: viewMode === mode ? "#1c1b1b" : "#ffffff",
                    color: viewMode === mode ? "#ffffff" : "#7a7574",
                    border: "none",
                  }}
                >
                  {mode === "list" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Folders ── */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[0.75rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>Folders</h2>
            <div className="flex items-center gap-3">
              {isControl && pendingRequests.length > 0 && (
                <button
                  onClick={() => setManageFoldersOpen(true)}
                  className="flex items-center gap-1 text-[0.6875rem] font-medium cursor-pointer"
                  style={{ color: "#b20100", backgroundColor: "transparent", border: "none", padding: 0 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                  {pendingRequests.length} request{pendingRequests.length !== 1 ? "s" : ""}
                </button>
              )}
              {isControl ? (
                <button
                  onClick={() => setCreateFolderOpen(true)}
                  className="flex items-center gap-1 text-[0.6875rem] font-medium cursor-pointer"
                  style={{ color: "#b20100", backgroundColor: "transparent", border: "none", padding: 0 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  New Folder
                </button>
              ) : (
                <button
                  onClick={() => setRequestFolderOpen(true)}
                  className="flex items-center gap-1 text-[0.6875rem] font-medium cursor-pointer"
                  style={{ color: "#b20100", backgroundColor: "transparent", border: "none", padding: 0 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Request Folder
                </button>
              )}
              {!activeFolder && allDisplayFolders.length > FOLDER_COLS && (
                <button
                  onClick={() => setShowAllFolders(!showAllFolders)}
                  className="text-[0.75rem] font-medium cursor-pointer"
                  style={{ color: "#b20100", backgroundColor: "transparent", border: "none" }}
                >
                  {showAllFolders ? "SHOW LESS" : "VIEW ALL"}
                </button>
              )}
            </div>
          </div>
          {activeFolder ? (
            <div
              className="flex items-center justify-center gap-2 px-4 text-[0.75rem] text-center"
              style={{
                backgroundColor: "#faf9f8",
                borderRadius: "8px",
                border: "1px dashed #d4d4d4",
                color: "#7a7574",
                minHeight: "62px",
              }}
            >
              <span>No subfolders in this folder.</span>
              <span>·</span>
              <button
                type="button"
                onClick={() => setTicketModalOpen(true)}
                className="font-medium underline-offset-2 hover:underline cursor-pointer"
                style={{ color: "#b20100", backgroundColor: "transparent", border: "none", padding: 0 }}
              >
                Can&#39;t find a subfolder? Open a ticket
              </button>
            </div>
          ) : (
            <>
              {fullRowFolders.length > 0 && (
                <div className="grid grid-cols-4 gap-3">
                  {fullRowFolders.map((folder) => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      isSelected={selectedFolder === folder.id}
                      onClick={() => setSelectedFolder(folder.id)}
                    />
                  ))}
                </div>
              )}
              {lastRowFolders.length > 0 && (
                <div className={`grid grid-cols-4 gap-3 ${fullRowFolders.length > 0 ? "mt-3" : ""}`}>
                  {Array.from({ length: lastRowPad }).map((_, i) => (
                    <div key={`pad-${i}`} />
                  ))}
                  {lastRowFolders.map((folder) => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      isSelected={selectedFolder === folder.id}
                      onClick={() => setSelectedFolder(folder.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Files ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-[0.75rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>Files</h2>
              {isSelectMode && (
                <span className="text-[0.6875rem]" style={{ color: "#7a7574" }}>
                  {checkedFiles.size} file{checkedFiles.size !== 1 ? "s" : ""} selected
                </span>
              )}
            </div>
            {multiSelectMode && (
              <div className="flex items-center gap-2">
                <button
                  onClick={exitMultiSelect}
                  className="px-3 py-1.5 text-[0.75rem] font-medium cursor-pointer"
                  style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b" }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => checkedFiles.size > 0 && setMoveDialogOpen(true)}
                  disabled={checkedFiles.size === 0}
                  className="px-3 py-1.5 text-[0.75rem] font-semibold cursor-pointer flex items-center gap-1.5"
                  style={{
                    background: checkedFiles.size > 0 ? "linear-gradient(135deg, #b20100, #e10000)" : "#e8e4e3",
                    color: checkedFiles.size > 0 ? "#ffffff" : "#7a7574",
                    border: "none",
                    borderRadius: "6px",
                  }}
                >
                  Move items
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></svg>
                </button>
              </div>
            )}
            {datasetMode && (
              <button
                onClick={exitDatasetMode}
                className="px-3 py-1.5 text-[0.75rem] font-medium cursor-pointer"
                style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b" }}
              >
                Cancel
              </button>
            )}
          </div>

          {viewMode === "list" ? (
            /* ── List view ── */
            <div>
              {/* Column header with filter dropdowns */}
              <div
                className="flex items-center px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-wider"
                style={{ color: "#7a7574", borderBottom: "1px solid #e8e4e3" }}
              >
                <div className="w-8" />
                <div className="w-8" />
                <div className="flex-1">Name</div>
                {userRole !== "generic" && <div className="w-28 text-center">Owner</div>}
                <div className="w-28 text-center">
                  <ColumnFilterDropdown label="Status" options={colStatusOptions} value={colFilterStatus} onChange={setColFilterStatus} />
                </div>
                <div className="w-28 text-center">
                  <ColumnFilterDropdown label="Date" options={colDateOptions} value={colFilterDate} onChange={setColFilterDate} />
                </div>
                <div className="w-20 text-center">
                  <ColumnFilterDropdown label="Duration" options={colDurationOptions} value={colFilterDuration} onChange={setColFilterDuration} />
                </div>
                <div className="w-24 text-center">
                  <ColumnFilterDropdown label="Language" options={colLanguageOptions} value={colFilterLanguage} onChange={setColFilterLanguage} />
                </div>
                <div className="w-16 text-center">
                  <WerRangeTooltip
                    werRange={werRange}
                    onChangeRange={setWerRange}
                    onClear={() => setWerRange([0, 100])}
                  />
                </div>
                <div className="w-8 flex justify-center">
                  <button
                    onClick={hasActiveColumnFilter ? clearAllColumnFilters : undefined}
                    className="w-7 h-7 flex items-center justify-center rounded-full relative group/filter"
                    style={{
                      backgroundColor: "transparent",
                      border: "none",
                      cursor: hasActiveColumnFilter ? "pointer" : "default",
                      opacity: hasActiveColumnFilter ? 1 : 0.4,
                    }}
                    onMouseEnter={(e) => { if (hasActiveColumnFilter) e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.06)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <img
                      src={hasActiveColumnFilter ? "/black_filter.png" : "/white_filter.png"}
                      alt="Filter"
                      width={14}
                      height={14}
                    />
                    {hasActiveColumnFilter && (
                      <span
                        className="absolute bottom-full left-1/2 mb-1.5 px-2 py-1 text-[0.625rem] font-medium whitespace-nowrap rounded opacity-0 group-hover/filter:opacity-100 transition-opacity pointer-events-none"
                        style={{
                          transform: "translateX(-50%)",
                          backgroundColor: "#1c1b1b",
                          color: "#ffffff",
                        }}
                      >
                        Click to clear filters
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* File rows */}
              <div>
                {pinnedFiles.length > 0 && (
                  <div
                    className="flex items-center gap-2 px-4 py-1.5 text-[0.625rem] font-semibold uppercase tracking-wider"
                    style={{ color: "#7a7574", backgroundColor: "#faf9f8", borderBottom: "1px solid #e8e4e3" }}
                  >
                    <PinIcon active size={10} />
                    <span>Pinned</span>
                  </div>
                )}
                {pinnedFiles.map(renderListRow)}
                {pinnedFiles.length > 0 && dateGroups.length > 0 && (
                  <div style={{ height: "12px" }} />
                )}
                {dateGroups.map((group, gi) => (
                  <div key={group.date}>
                    {/* Date section divider */}
                    <div
                      className="flex items-center gap-3 px-4 py-2 mt-1"
                      style={{ borderBottom: "1px solid #e8e4e3" }}
                    >
                      <span
                        className="text-[0.6875rem] font-semibold uppercase tracking-wider shrink-0"
                        style={{ color: "#7a7574" }}
                      >
                        {group.date}
                      </span>
                      <div className="flex-1" style={{ height: "1px", backgroundColor: "#e8e4e3" }} />
                      <span className="text-[0.625rem] shrink-0" style={{ color: "#a8a3a2" }}>
                        {group.files.length} file{group.files.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {group.files.map(renderListRow)}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* ── Grid view ── */
            <div className="grid grid-cols-3 gap-4">
              {pinnedFiles.length > 0 && (
                <div
                  className="col-span-3 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-wider"
                  style={{ color: "#7a7574" }}
                >
                  <PinIcon active size={10} />
                  <span>Pinned</span>
                </div>
              )}
              {pinnedFiles.map(renderGridCard)}
              {dateGroups.map((group) => (
                <React.Fragment key={group.date}>
                  {/* Date section divider */}
                  <div className="col-span-3 flex items-center gap-3 mt-2">
                    <span
                      className="text-[0.6875rem] font-semibold uppercase tracking-wider shrink-0"
                      style={{ color: "#7a7574" }}
                    >
                      {group.date}
                    </span>
                    <div className="flex-1" style={{ height: "1px", backgroundColor: "#e8e4e3" }} />
                    <span className="text-[0.625rem] shrink-0" style={{ color: "#a8a3a2" }}>
                      {group.files.length} file{group.files.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {group.files.map(renderGridCard)}
                </React.Fragment>
              ))}
            </div>
          )}

          {filteredFiles.length === 0 && (
            <div className="px-4 py-12 text-center text-[0.875rem]" style={{ color: "#7a7574" }}>
              {activeFilter !== "all"
                ? `No transcripts${activeFolder ? ` in "${activeFolder.name}"` : ""} match the current filter.`
                : activeFolder
                  ? `No transcripts in "${activeFolder.name}" yet.`
                  : "No root-level transcripts yet."}
            </div>
          )}
        </div>
      </div>

      {/* ══ Right side: full-height preview panel ══ */}
      {selected && (
        <div
          ref={previewRef}
          className="w-80 shrink-0 self-start sticky top-6 p-5 flex flex-col"
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            border: "1px solid #e8e4e3",
            height: previewHeight ? `${previewHeight}px` : "calc(100vh - 3rem)",
          }}
        >
          {/* Preview thumbnail */}
          {(selected.isOwned || userRole === "admin") ? (
            <button
              type="button"
              onClick={togglePlayback}
              disabled={!selected.audioUrl}
              className="group w-full h-40 mb-4 flex items-center justify-center transition-colors"
              style={{
                backgroundColor: "#1c1b1b",
                borderRadius: "6px",
                border: "none",
                cursor: selected.audioUrl ? "pointer" : "not-allowed",
              }}
              onMouseEnter={(e) => { if (selected.audioUrl) e.currentTarget.style.backgroundColor = "#2a2827"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#1c1b1b"; }}
            >
              {isPlaying ? (
                <svg width="40" height="40" viewBox="0 0 24 24" fill="#ffffff" stroke="none">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="40" height="40" viewBox="0 0 24 24" fill="#ffffff" stroke="none">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
              {selected.audioUrl && (
                <audio
                  ref={audioRef}
                  src={selected.audioUrl}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  preload="none"
                />
              )}
            </button>
          ) : (
            <div className="w-full h-40 mb-4 flex items-center justify-center" style={{ backgroundColor: "#f6f3f2", borderRadius: "6px" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="0" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            </div>
          )}

          {/* File name */}
          <h3 className="text-[0.875rem] font-bold mb-1" style={{ color: "#1c1b1b" }}>
            {selected.name.replace(/\.[^.]+$/, "")}
          </h3>
          {!selected.isOwned && userRole !== "admin" && (
            <p className="text-[0.6875rem] mb-3" style={{ color: "#7a7574" }}>
              Owned by {selected.ownerName || "another user"}
            </p>
          )}

          {/* Metadata */}
          <div
            className="mt-4 pt-4 space-y-3 flex-1 min-h-0 overflow-y-auto"
            style={{ borderTop: "1px solid #e8e4e3" }}
          >
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>METADATA DETAILS</p>
            <DetailRow label="File Name" value={selected.name} />
            <DetailRow label="Date Uploaded" value={formatDateTime(selected.uploaded_at, timeFormat)} />
            <DetailRow label="Duration" value={selected.duration || "\u2014"} />
            <DetailRow
              label="Word Error Rate (WER)"
              value={selected.wer != null && selected.wer !== 'NA' ? `${selected.absoluteWordErrorRate}/${selected.totalNumberOfWords} words (${selected.wer}%)` : "\u2014"}
              accent
            />
            <DetailRow label="Speaker Detection" value={selected.speakerDetection != null ? `${selected.speakerDetection} speaker${selected.speakerDetection !== 1 ? "s" : ""}` : "\u2014"} />
            <DetailRow label="Detected Language" value={selected.detectedLanguage || "\u2014"} />
            <DetailRow label="Compliance" value={selected.compliance || "\u2014"} />
          </div>

          {/* Actions */}
          <div className="mt-auto pt-6 space-y-2">
            {(selected.isOwned || userRole === "admin") ? (
              <>
                <button
                  onClick={() => router.push(`/files/${selected.id}`)}
                  className="w-full py-2.5 text-[0.8125rem] font-semibold cursor-pointer"
                  style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "6px" }}
                >
                  OPEN TRANSCRIPT
                </button>
                <button
                  onClick={() => router.push(`/files/${selected.id}/audit`)}
                  className="w-full py-2.5 text-[0.8125rem] font-medium cursor-pointer"
                  style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b" }}
                >
                  AUDIT TRAIL
                </button>
                <button className="w-full py-2.5 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b" }}>
                  MANAGE ACCESS
                </button>
              </>
            ) : (
              <div className="px-3 py-4 text-center" style={{ backgroundColor: "#f6f3f2", borderRadius: "6px" }}>
                <svg className="mx-auto mb-2" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="0" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                <p className="text-[0.75rem]" style={{ color: "#7a7574" }}>
                  Content restricted. You can view metadata only.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {ticketModalOpen && (
        <TicketModal
          folderName={activeFolder?.name || ""}
          onCancel={() => setTicketModalOpen(false)}
          onProceed={({ to, subject, body }) => {
            window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            setTicketModalOpen(false);
          }}
        />
      )}

      {/* Create Folder modal (control members) */}
      {createFolderOpen && (
        <CreateFolderModal
          onClose={() => setCreateFolderOpen(false)}
          onCreate={(name, description) => {
            const folder = createFolder({ name, groupId, description, createdBy: userId });
            if (folder) {
              setToast(`Folder "${name}" created.`);
              setCreateFolderOpen(false);
            }
          }}
        />
      )}

      {/* Request Folder modal (normal members) */}
      {requestFolderOpen && (
        <RequestFolderModal
          onClose={() => setRequestFolderOpen(false)}
          onSubmit={(suggestedName, reason) => {
            const controlUserId = getControlMemberForGroup(groupId);
            submitFolderRequest({ groupId, requestedBy: userId, requesterName: user?.name || "User", suggestedName, reason });
            if (controlUserId) {
              addFolderRequestNotification({
                groupId,
                recipientId: controlUserId,
                requestedBy: userId,
                requesterName: user?.name || "User",
                suggestedName,
              });
            }
            setToast("Folder request submitted.");
            setRequestFolderOpen(false);
          }}
        />
      )}

      {/* Manage Folders panel (control members) */}
      {manageFoldersOpen && (
        <ManageFoldersModal
          requests={pendingRequests}
          onClose={() => setManageFoldersOpen(false)}
          onApprove={(reqId) => {
            const req = pendingRequests.find((r) => r.id === reqId);
            const folder = approveRequest(reqId, userId);
            if (folder && req) {
              addFolderRequestResponseNotification({ recipientId: req.requestedBy, suggestedName: req.suggestedName, approved: true });
              setToast(`Folder "${req.suggestedName}" created from request.`);
            }
          }}
          onDeny={(reqId, reason) => {
            const req = pendingRequests.find((r) => r.id === reqId);
            denyRequest(reqId, userId, reason);
            if (req) {
              addFolderRequestResponseNotification({ recipientId: req.requestedBy, suggestedName: req.suggestedName, approved: false, denyReason: reason });
              setToast(`Request "${req.suggestedName}" denied.`);
            }
          }}
        />
      )}

      {/* Rename Folder modal */}
      {renamingFolder && (
        <RenameFolderModal
          folder={folders.find((f) => f.id === renamingFolder)}
          onClose={() => setRenamingFolder(null)}
          onRename={(newName) => {
            renameFolder(renamingFolder, newName, userId);
            setToast(`Folder renamed to "${newName}".`);
            setRenamingFolder(null);
          }}
        />
      )}

      {/* Move files dialog (multi-select) */}
      {moveDialogOpen && (
        <MoveToFolderModal
          folders={allDisplayFolders}
          fileCount={checkedFiles.size}
          onClose={() => setMoveDialogOpen(false)}
          onMove={(folderId) => {
            const { moved } = moveFilesToFolder(folderId, [...checkedFiles], userId);
            const folderName = folders.find((f) => f.id === folderId)?.name || "folder";
            setToast(moved > 0
              ? `${moved} file${moved !== 1 ? "s" : ""} moved to "${folderName}".`
              : `All files are already in "${folderName}".`);
            exitMultiSelect();
            refetchFiles();
          }}
        />
      )}

      {/* Dataset creation dialog */}
      {datasetDialogOpen && (
        <div
          onClick={() => { setDatasetDialogOpen(false); }}
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: "rgba(28, 27, 27, 0.45)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="p-6 w-full max-w-md"
            style={{ backgroundColor: "#ffffff", border: "1px solid #f0edec" }}
          >
            <h3 className="text-[0.875rem] font-bold uppercase tracking-wider mb-4" style={{ color: "#1c1b1b" }}>
              Create Dataset
            </h3>
            <p className="text-[0.75rem] mb-4" style={{ color: "#7a7574" }}>
              {checkedFiles.size} file{checkedFiles.size !== 1 ? "s" : ""} selected
            </p>
            <label className="block mb-3">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>Dataset Name</span>
              <input
                ref={datasetNameRef}
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                className="w-full text-[0.8125rem] px-3 py-2 mt-1 outline-none"
                style={{ backgroundColor: "#f6f3f2", border: "1px solid #f0edec", color: "#1c1b1b" }}
              />
            </label>
            <label className="block mb-3">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>Description</span>
              <textarea
                value={datasetDesc}
                onChange={(e) => setDatasetDesc(e.target.value)}
                rows={2}
                className="w-full text-[0.8125rem] px-3 py-2 mt-1 outline-none resize-none"
                style={{ backgroundColor: "#f6f3f2", border: "1px solid #f0edec", color: "#1c1b1b" }}
              />
            </label>
            <div className="block mb-5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>
                  Tags
                </span>
                <span className="text-[0.625rem]" style={{ color: "#bcb7b6" }}>
                  {datasetTags.length} selected &middot; ↑↓ Enter · ⌫ to remove
                </span>
              </div>
              <TagPicker selected={datasetTags} onChange={setDatasetTags} />
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDatasetDialogOpen(false)}
                className="px-4 py-1.5 text-[0.8125rem] font-medium cursor-pointer"
                style={{ backgroundColor: "transparent", border: "1.5px solid #f0edec", borderRadius: "0px", color: "#7a7574" }}
              >
                CANCEL
              </button>
              <button
                onClick={handleCreateDataset}
                disabled={!datasetName.trim()}
                className="px-4 py-1.5 text-[0.8125rem] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}
              >
                CREATE DATASET
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 px-5 py-3 text-[0.8125rem] font-medium z-50"
          style={{
            transform: "translateX(-50%)",
            backgroundColor: "#1c1b1b",
            color: "#ffffff",
            borderRadius: "6px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/* ── Ticket modal ── */
const TICKET_RECIPIENT = "support@ubs.com";

function TicketModal({ folderName, onCancel, onProceed }) {
  const defaultSubject = `Missing subfolder in "${folderName}"`;
  const defaultBody =
    `Hi team,\n\n` +
    `I couldn't find the subfolder I was expecting inside "${folderName}" in the AUSTIN-Lang transcripts dashboard. Could you help me locate it or confirm whether it needs to be created?\n\n` +
    `Folder: ${folderName}\n` +
    `Expected subfolder name: \n` +
    `Why I expected it to be there: \n\n` +
    `Thanks.`;

  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ backgroundColor: "rgba(28, 27, 27, 0.45)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg flex flex-col"
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "10px",
          border: "1px solid #e8e4e3",
          boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3" style={{ borderBottom: "1px solid #e8e4e3" }}>
          <h3 className="text-[1rem] font-bold" style={{ color: "#1c1b1b" }}>
            Open a subfolder ticket
          </h3>
          <p className="text-[0.75rem] mt-1" style={{ color: "#7a7574" }}>
            Review the draft below. Proceed to open this in your mail client addressed to{" "}
            <span style={{ color: "#1c1b1b", fontWeight: 600 }}>{TICKET_RECIPIENT}</span>.
          </p>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>
              To
            </label>
            <div
              className="mt-1 px-3 py-2 text-[0.8125rem]"
              style={{ backgroundColor: "#f6f3f2", borderRadius: "6px", color: "#1c1b1b" }}
            >
              {TICKET_RECIPIENT}
            </div>
          </div>
          <div>
            <label className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-[0.8125rem]"
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #e8e4e3",
                borderRadius: "6px",
                color: "#1c1b1b",
                outline: "none",
              }}
            />
          </div>
          <div>
            <label className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="mt-1 w-full px-3 py-2 text-[0.8125rem] leading-relaxed resize-none"
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #e8e4e3",
                borderRadius: "6px",
                color: "#1c1b1b",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>
        </div>

        <div
          className="flex items-center justify-end gap-2 px-6 py-4"
          style={{ borderTop: "1px solid #e8e4e3" }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-[0.8125rem] font-medium cursor-pointer"
            style={{
              backgroundColor: "transparent",
              border: "1px solid #e8e4e3",
              borderRadius: "6px",
              color: "#1c1b1b",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onProceed({ to: TICKET_RECIPIENT, subject, body })}
            className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer"
            style={{
              background: "linear-gradient(135deg, #b20100, #e10000)",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
            }}
          >
            Proceed
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Modal backdrop helper ── */
function ModalBackdrop({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ backgroundColor: "rgba(28, 27, 27, 0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md flex flex-col"
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "10px",
          border: "1px solid #e8e4e3",
          boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* ── Create Folder modal (control members) ── */
function CreateFolderModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="px-6 pt-5 pb-3" style={{ borderBottom: "1px solid #e8e4e3" }}>
        <h3 className="text-[1rem] font-bold" style={{ color: "#1c1b1b" }}>Create Folder</h3>
        <p className="text-[0.75rem] mt-1" style={{ color: "#7a7574" }}>
          Create a new folder visible to all members in your group.
        </p>
      </div>
      <div className="px-6 py-4 space-y-3">
        <div>
          <label className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>
            Folder name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Training Data"
            autoFocus
            className="mt-1 w-full px-3 py-2 text-[0.8125rem]"
            style={{ backgroundColor: "#ffffff", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b", outline: "none" }}
          />
        </div>
        <div>
          <label className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>
            Description <span style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full px-3 py-2 text-[0.8125rem] resize-none"
            style={{ backgroundColor: "#ffffff", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b", outline: "none", fontFamily: "inherit" }}
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: "1px solid #e8e4e3" }}>
        <button onClick={onClose} className="px-4 py-2 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b" }}>
          Cancel
        </button>
        <button
          onClick={() => name.trim() && onCreate(name.trim(), description.trim())}
          disabled={!name.trim()}
          className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer"
          style={{ background: name.trim() ? "linear-gradient(135deg, #b20100, #e10000)" : "#e8e4e3", color: name.trim() ? "#ffffff" : "#7a7574", border: "none", borderRadius: "6px" }}
        >
          Create
        </button>
      </div>
    </ModalBackdrop>
  );
}

/* ── Request Folder modal (normal members) ── */
function RequestFolderModal({ onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="px-6 pt-5 pb-3" style={{ borderBottom: "1px solid #e8e4e3" }}>
        <h3 className="text-[1rem] font-bold" style={{ color: "#1c1b1b" }}>Request a Folder</h3>
        <p className="text-[0.75rem] mt-1" style={{ color: "#7a7574" }}>
          Submit a request to the group administrator to create a new folder.
        </p>
      </div>
      <div className="px-6 py-4 space-y-3">
        <div>
          <label className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>
            Suggested folder name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. High WER Files"
            autoFocus
            className="mt-1 w-full px-3 py-2 text-[0.8125rem]"
            style={{ backgroundColor: "#ffffff", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b", outline: "none" }}
          />
        </div>
        <div>
          <label className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>
            Reason
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why do you need this folder?"
            className="mt-1 w-full px-3 py-2 text-[0.8125rem] resize-none"
            style={{ backgroundColor: "#ffffff", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b", outline: "none", fontFamily: "inherit" }}
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: "1px solid #e8e4e3" }}>
        <button onClick={onClose} className="px-4 py-2 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b" }}>
          Cancel
        </button>
        <button
          onClick={() => name.trim() && reason.trim() && onSubmit(name.trim(), reason.trim())}
          disabled={!name.trim() || !reason.trim()}
          className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer"
          style={{ background: (name.trim() && reason.trim()) ? "linear-gradient(135deg, #b20100, #e10000)" : "#e8e4e3", color: (name.trim() && reason.trim()) ? "#ffffff" : "#7a7574", border: "none", borderRadius: "6px" }}
        >
          Submit Request
        </button>
      </div>
    </ModalBackdrop>
  );
}

/* ── Manage Folders modal (control members — folder requests) ── */
function ManageFoldersModal({ requests, onClose, onApprove, onDeny }) {
  const [denyingId, setDenyingId] = useState(null);
  const [denyReason, setDenyReason] = useState("");
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="px-6 pt-5 pb-3" style={{ borderBottom: "1px solid #e8e4e3" }}>
        <h3 className="text-[1rem] font-bold" style={{ color: "#1c1b1b" }}>Folder Requests</h3>
        <p className="text-[0.75rem] mt-1" style={{ color: "#7a7574" }}>
          {requests.length} pending request{requests.length !== 1 ? "s" : ""} from group members.
        </p>
      </div>
      <div className="px-6 py-4 space-y-4 max-h-80 overflow-y-auto">
        {requests.map((req) => (
          <div key={req.id} className="p-3" style={{ backgroundColor: "#faf9f8", borderRadius: "6px", border: "1px solid #e8e4e3" }}>
            <p className="text-[0.8125rem] font-semibold" style={{ color: "#1c1b1b" }}>
              &ldquo;{req.suggestedName}&rdquo;
            </p>
            <p className="text-[0.6875rem] mt-0.5" style={{ color: "#7a7574" }}>
              Requested by {req.requesterName} &middot; {new Date(req.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
            </p>
            <p className="text-[0.75rem] mt-1" style={{ color: "#1c1b1b" }}>{req.reason}</p>
            {denyingId === req.id ? (
              <div className="mt-2 space-y-2">
                <textarea
                  value={denyReason}
                  onChange={(e) => setDenyReason(e.target.value)}
                  rows={2}
                  placeholder="Reason for denial (optional)"
                  className="w-full px-2 py-1.5 text-[0.75rem] resize-none"
                  style={{ backgroundColor: "#ffffff", border: "1px solid #e8e4e3", borderRadius: "4px", color: "#1c1b1b", outline: "none", fontFamily: "inherit" }}
                />
                <div className="flex gap-2">
                  <button onClick={() => { setDenyingId(null); setDenyReason(""); }} className="px-3 py-1 text-[0.6875rem] cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "4px", color: "#7a7574" }}>
                    Back
                  </button>
                  <button onClick={() => { onDeny(req.id, denyReason.trim()); setDenyingId(null); setDenyReason(""); }} className="px-3 py-1 text-[0.6875rem] font-semibold cursor-pointer" style={{ backgroundColor: "#1c1b1b", color: "#ffffff", border: "none", borderRadius: "4px" }}>
                    Confirm Deny
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mt-2">
                <button onClick={() => onApprove(req.id)} className="px-3 py-1 text-[0.6875rem] font-semibold cursor-pointer" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "4px" }}>
                  Approve
                </button>
                <button onClick={() => setDenyingId(req.id)} className="px-3 py-1 text-[0.6875rem] cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "4px", color: "#1c1b1b" }}>
                  Deny
                </button>
              </div>
            )}
          </div>
        ))}
        {requests.length === 0 && (
          <p className="text-[0.8125rem] text-center py-4" style={{ color: "#7a7574" }}>No pending requests.</p>
        )}
      </div>
      <div className="flex items-center justify-end px-6 py-4" style={{ borderTop: "1px solid #e8e4e3" }}>
        <button onClick={onClose} className="px-4 py-2 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b" }}>
          Close
        </button>
      </div>
    </ModalBackdrop>
  );
}

/* ── Rename Folder modal ── */
function RenameFolderModal({ folder, onClose, onRename }) {
  const [name, setName] = useState(folder?.name || "");
  if (!folder) return null;
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="px-6 pt-5 pb-3" style={{ borderBottom: "1px solid #e8e4e3" }}>
        <h3 className="text-[1rem] font-bold" style={{ color: "#1c1b1b" }}>Rename Folder</h3>
      </div>
      <div className="px-6 py-4">
        <label className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>
          New name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="mt-1 w-full px-3 py-2 text-[0.8125rem]"
          style={{ backgroundColor: "#ffffff", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b", outline: "none" }}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onRename(name.trim()); }}
        />
      </div>
      <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: "1px solid #e8e4e3" }}>
        <button onClick={onClose} className="px-4 py-2 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b" }}>
          Cancel
        </button>
        <button
          onClick={() => name.trim() && onRename(name.trim())}
          disabled={!name.trim()}
          className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer"
          style={{ background: name.trim() ? "linear-gradient(135deg, #b20100, #e10000)" : "#e8e4e3", color: name.trim() ? "#ffffff" : "#7a7574", border: "none", borderRadius: "6px" }}
        >
          Rename
        </button>
      </div>
    </ModalBackdrop>
  );
}

/* ── Move to folder picker (two-step: select folder, then OK) ── */
function MoveToFolderModal({ folders, fileCount, onClose, onMove }) {
  const [selectedId, setSelectedId] = useState(null);
  const label = fileCount != null ? `Move ${fileCount} file${fileCount !== 1 ? "s" : ""}` : "Move to Folder";
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="px-6 pt-5 pb-3" style={{ borderBottom: "1px solid #e8e4e3" }}>
        <h3 className="text-[1rem] font-bold" style={{ color: "#1c1b1b" }}>{label}</h3>
        <p className="text-[0.75rem] mt-1" style={{ color: "#7a7574" }}>
          Select a destination folder, then click OK.
        </p>
      </div>
      <div className="px-6 py-4 space-y-1 max-h-60 overflow-y-auto">
        {folders.map((folder) => {
          const isSel = selectedId === folder.id;
          return (
            <button
              key={folder.id}
              onClick={() => setSelectedId(folder.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors text-left"
              style={{
                backgroundColor: isSel ? "rgba(178, 1, 0, 0.06)" : "#ffffff",
                border: isSel ? "1px solid #b20100" : "1px solid transparent",
                borderRadius: "6px",
              }}
              onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.backgroundColor = "#f6f3f2"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isSel ? "rgba(178, 1, 0, 0.06)" : "#ffffff"; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isSel ? "#b20100" : "#7a7574"} strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              <span className="text-[0.8125rem] font-medium flex-1" style={{ color: isSel ? "#b20100" : "#1c1b1b" }}>{folder.name}</span>
              {folder.fileCount != null && (
                <span className="text-[0.6875rem]" style={{ color: "#7a7574" }}>{folder.fileCount}</span>
              )}
            </button>
          );
        })}
        {folders.length === 0 && (
          <p className="text-[0.8125rem] text-center py-4" style={{ color: "#7a7574" }}>
            No folders available. Ask a control member to create one.
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: "1px solid #e8e4e3" }}>
        <button onClick={onClose} className="px-4 py-2 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b" }}>
          Cancel
        </button>
        <button
          onClick={() => selectedId && onMove(selectedId)}
          disabled={!selectedId}
          className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer"
          style={{ background: selectedId ? "linear-gradient(135deg, #b20100, #e10000)" : "#e8e4e3", color: selectedId ? "#ffffff" : "#7a7574", border: "none", borderRadius: "6px" }}
        >
          OK
        </button>
      </div>
    </ModalBackdrop>
  );
}
