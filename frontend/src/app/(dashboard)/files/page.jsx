'use client';

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { fetchSubmittedFiles, fetchAllFilesMetadata, getCurrentUser } from "../../../services/api";
import { getTimeFormat, formatDateTime, TIME_FORMAT_EVENT, TIME_FORMAT_KEY } from "../../../lib/timeFormat";
import { SAMPLED_DATASET_FOLDERS } from "../../../services/sampled-datasets";

/* ── Folders are the sampled-dataset sources ── */
const FOLDERS = SAMPLED_DATASET_FOLDERS;
const FOLDER_COLS = 4;

/* Fraction of the sidebar's height to use for the preview card. */
const PREVIEW_HEIGHT_RATIO = 0.88;

/* ── Helpers ── */
function StatusBadge({ status }) {
  const styles = {
    completed: { bg: "rgba(178, 1, 0, 0.08)", color: "#b20100", label: "COMPLETED" },
    "in review": { bg: "rgba(0, 78, 198, 0.08)", color: "#004ec6", label: "IN REVIEW" },
    transcribing: { bg: "rgba(122, 117, 116, 0.1)", color: "#7a7574", label: "TRANSCRIBING" },
  };
  const s = styles[status] || styles.completed;
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
  const statuses = ["completed", "in review", "completed", "transcribing"];
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
  const [activeFilter, setActiveFilter] = useState("all");
  const [showAllFolders, setShowAllFolders] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeFormat, setTimeFormatState] = useState("12h");
  const [previewHeight, setPreviewHeight] = useState(null);
  const audioRef = useRef(null);
  const previewRef = useRef(null);
  const router = useRouter();
  const user = getCurrentUser();
  const userRole = user?.role || "generic";
  const userId = user?.id || "anon";

  const [favorites, setFavorites] = useState(() => new Set());
  const [pinned, setPinned] = useState(() => []);

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
      setSelected(null);
      return;
    }
    if (!selected || selected.dataset !== selectedFolder) {
      const first = files.find((f) => f.dataset === selectedFolder);
      setSelected(first || null);
    }
  }, [selectedFolder, files]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch((err) => console.error("Audio play failed:", err));
    } else {
      audio.pause();
    }
  };

  useEffect(() => {
    setLoading(true);
    const fetchFn = (userRole === "engineer" || userRole === "admin")
      ? fetchAllFilesMetadata
      : () => fetchSubmittedFiles().then((data) => data.map((f) => ({ ...f, isOwned: true })));

    fetchFn()
      .then((data) => {
        setFiles(data);
      })
      .catch((error) => console.error("Error fetching files:", error))
      .finally(() => setLoading(false));
  }, [userRole]);

  const pageTitle = userRole === "generic" ? "MY TRANSCRIPTS" : "ALL TRANSCRIPTS";
  const visibleFolders = showAllFolders ? FOLDERS : FOLDERS.slice(0, FOLDER_COLS);

  // Split folders so the overflow row is right-aligned: full rows render normally,
  // the partial last row is padded with empty cells on the left.
  const fullRowCount = Math.floor(visibleFolders.length / FOLDER_COLS) * FOLDER_COLS;
  const fullRowFolders = visibleFolders.slice(0, fullRowCount);
  const lastRowFolders = visibleFolders.slice(fullRowCount);
  const lastRowPad = lastRowFolders.length > 0
    ? FOLDER_COLS - lastRowFolders.length
    : 0;

  const activeFolder = selectedFolder
    ? FOLDERS.find((f) => f.id === selectedFolder)
    : null;

  const filters = [
    { key: "all", label: "All" },
    { key: "starred", label: "Starred" },
    { key: "completed", label: "Completed" },
    { key: "in review", label: "In Review" },
    { key: "transcribing", label: "Transcribing" },
  ];

  const filteredFiles = files.map((f, i) => ({ ...f, _status: getFileStatus(i) }))
    .filter((f) => {
      if (activeFilter === "starred") return favorites.has(f.id);
      if (activeFilter === "all") return true;
      return f._status === activeFilter;
    })
    .filter((f) => !selectedFolder || f.dataset === selectedFolder);

  const pinnedSet = new Set(pinned);
  const pinnedFiles = pinned
    .map((id) => filteredFiles.find((f) => f.id === id))
    .filter(Boolean);
  const unpinnedFiles = filteredFiles.filter((f) => !pinnedSet.has(f.id));

  const renderListRow = (file) => {
    const isSelected = selected?.id === file.id;
    const isFav = favorites.has(file.id);
    const isPinned = pinnedSet.has(file.id);
    return (
      <div
        key={file.id}
        onClick={() => setSelected(file)}
        onDoubleClick={() => {
          if (file.isOwned || userRole === "admin") router.push(`/files/${file.id}`);
        }}
        className="group flex items-center px-4 py-3 cursor-pointer transition-colors"
        style={{
          backgroundColor: isSelected ? "#eef0fc" : "#ffffff",
          borderBottom: "1px solid #f0edec",
        }}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "#f6f3f2"; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "#ffffff"; }}
      >
        <div className="w-8 flex justify-center">
          <StarButton active={isFav} onClick={() => toggleFavorite(file.id)} />
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
          <div className="w-28 text-center text-[0.8125rem]" style={{ color: file.isOwned ? "#1c1b1b" : "#7a7574" }}>
            {file.isOwned ? "You" : file.ownerName || "\u2014"}
          </div>
        )}
        <div className="w-28 text-center"><StatusBadge status={file._status} /></div>
        <div className="w-28 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{formatDate(file.uploaded_at)}</div>
        <div className="w-20 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{file.duration || "\u2014"}</div>
        <div className="w-24 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{file.detectedLanguage || "\u2014"}</div>
        <div className="w-16 text-center text-[0.8125rem]" style={{ color: file.wer != null ? "#b20100" : "#7a7574" }}>{file.wer != null ? `${file.wer}%` : "\u2014"}</div>
        <div className="w-8 flex justify-center">
          <RowMenu items={[
            { label: isPinned ? "Unpin" : "Pin to top", icon: <PinIcon active={isPinned} size={12} />, onClick: () => togglePin(file.id) },
            { label: isFav ? "Remove star" : "Star", icon: <StarIcon filled={isFav} size={12} />, onClick: () => toggleFavorite(file.id) },
          ]} />
        </div>
      </div>
    );
  };

  const renderGridCard = (file) => {
    const isSelected = selected?.id === file.id;
    const isFav = favorites.has(file.id);
    const isPinned = pinnedSet.has(file.id);
    return (
      <div
        key={file.id}
        onClick={() => setSelected(file)}
        onDoubleClick={() => {
          if (file.isOwned || userRole === "admin") router.push(`/files/${file.id}`);
        }}
        className="group cursor-pointer transition-colors overflow-hidden relative"
        style={{
          backgroundColor: isSelected ? "#eef0fc" : "#ffffff",
          borderRadius: "8px",
          border: isSelected ? "2px solid #b20100" : "1px solid #e8e4e3",
        }}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "#f6f3f2"; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = isSelected ? "#eef0fc" : "#ffffff"; }}
      >
        <div className="absolute top-2 right-2 z-10" style={{ backgroundColor: isFav ? "rgba(255,255,255,0.9)" : "transparent", borderRadius: "9999px" }}>
          <StarButton active={isFav} onClick={() => toggleFavorite(file.id)} />
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
            <p className="text-[0.6875rem] truncate" style={{ color: "#7a7574" }}>
              {formatDate(file.uploaded_at)}
            </p>
          </div>
          <RowMenu items={[
            { label: isPinned ? "Unpin" : "Pin to top", icon: <PinIcon active={isPinned} size={12} />, onClick: () => togglePin(file.id) },
            { label: isFav ? "Remove star" : "Star", icon: <StarIcon filled={isFav} size={12} />, onClick: () => toggleFavorite(file.id) },
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
          <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>
            {pageTitle}
          </h1>
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
            {!activeFolder && FOLDERS.length > FOLDER_COLS && (
              <button
                onClick={() => setShowAllFolders(!showAllFolders)}
                className="text-[0.75rem] font-medium cursor-pointer"
                style={{ color: "#b20100", backgroundColor: "transparent", border: "none" }}
              >
                {showAllFolders ? "SHOW LESS" : "VIEW ALL"}
              </button>
            )}
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

        {/* ── Files (only visible when a folder is opened) ── */}
        {activeFolder && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[0.75rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>Files</h2>
          </div>

          {viewMode === "list" ? (
            /* ── List view ── */
            <div>
              {/* Column header */}
              <div
                className="flex items-center px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-wider"
                style={{ color: "#7a7574", borderBottom: "1px solid #e8e4e3" }}
              >
                <div className="w-8" />
                <div className="w-8" />
                <div className="flex-1">Name</div>
                {userRole !== "generic" && <div className="w-28 text-center">Owner</div>}
                <div className="w-28 text-center">Status</div>
                <div className="w-28 text-center">Date Uploaded</div>
                <div className="w-20 text-center">Duration</div>
                <div className="w-24 text-center">Language</div>
                <div className="w-16 text-center">WER</div>
                <div className="w-8" />
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
                {pinnedFiles.length > 0 && unpinnedFiles.length > 0 && (
                  <div style={{ height: "12px" }} />
                )}
                {unpinnedFiles.map(renderListRow)}
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
              {pinnedFiles.length > 0 && unpinnedFiles.length > 0 && (
                <div className="col-span-3" style={{ borderTop: "1px solid #e8e4e3", marginTop: "4px" }} />
              )}
              {unpinnedFiles.map(renderGridCard)}
            </div>
          )}

          {filteredFiles.length === 0 && (
            <div className="px-4 py-12 text-center text-[0.875rem]" style={{ color: "#7a7574" }}>
              {activeFilter !== "all"
                ? `No transcripts in "${activeFolder.name}" match the current filter.`
                : `No transcripts in "${activeFolder.name}" yet.`}
            </div>
          )}
        </div>
        )}

        {!activeFolder && (
          <div className="px-4 py-12 text-center text-[0.875rem]" style={{ color: "#7a7574" }}>
            Select a folder above to view its transcripts.
          </div>
        )}
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
              value={selected.wer != null ? `${selected.absoluteWordErrorRate}/${selected.totalNumberOfWords} words (${selected.wer}%)` : "\u2014"}
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
                <button className="w-full py-2.5 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #e8e4e3", borderRadius: "6px", color: "#1c1b1b" }}>
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
