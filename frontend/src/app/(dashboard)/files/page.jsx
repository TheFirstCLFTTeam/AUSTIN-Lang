'use client';

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { fetchSubmittedFiles, fetchAllFilesMetadata, getCurrentUser } from "../../../services/api";

/* ── Mock folders (until folder API exists) ── */
const MOCK_FOLDERS = [
  { id: "f1", name: "Q1 Earnings", fileCount: 12 },
  { id: "f2", name: "Legal Reviews", fileCount: 8 },
  { id: "f3", name: "Market Prep", fileCount: 5 },
  { id: "f4", name: "Board Meetings", fileCount: 3 },
  { id: "f5", name: "Compliance", fileCount: 7 },
];

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
function FolderCard({ folder }) {
  return (
    <div
      className="group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors"
      style={{ backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #e8e4e3" }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f6f3f2"; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#ffffff"; }}
    >
      <FolderIcon />
      <span className="flex-1 text-[0.8125rem] font-medium truncate" style={{ color: "#1c1b1b" }}>
        {folder.name}
      </span>
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
  const router = useRouter();
  const user = getCurrentUser();
  const userRole = user?.role || "generic";

  useEffect(() => {
    setLoading(true);
    const fetchFn = (userRole === "engineer" || userRole === "admin")
      ? fetchAllFilesMetadata
      : () => fetchSubmittedFiles().then((data) => data.map((f) => ({ ...f, isOwned: true })));

    fetchFn()
      .then((data) => {
        setFiles(data);
        if (data.length > 0) setSelected(data[0]);
      })
      .catch((error) => console.error("Error fetching files:", error))
      .finally(() => setLoading(false));
  }, [userRole]);

  const pageTitle = userRole === "generic" ? "MY TRANSCRIPTS" : "ALL TRANSCRIPTS";
  const visibleFolders = showAllFolders ? MOCK_FOLDERS : MOCK_FOLDERS.slice(0, 4);

  const filters = [
    { key: "all", label: "All" },
    { key: "completed", label: "Completed" },
    { key: "in review", label: "In Review" },
    { key: "transcribing", label: "Transcribing" },
  ];

  const filteredFiles = files.map((f, i) => ({ ...f, _status: getFileStatus(i) }))
    .filter((f) => activeFilter === "all" || f._status === activeFilter);

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
          <span>HOME</span><span>/</span><span style={{ color: "#1c1b1b" }}>{pageTitle}</span>
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
            {MOCK_FOLDERS.length > 4 && (
              <button
                onClick={() => setShowAllFolders(!showAllFolders)}
                className="text-[0.75rem] font-medium cursor-pointer"
                style={{ color: "#b20100", backgroundColor: "transparent", border: "none" }}
              >
                {showAllFolders ? "SHOW LESS" : "VIEW ALL"}
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-3">
            {visibleFolders.map((folder) => (
              <FolderCard key={folder.id} folder={folder} />
            ))}
          </div>
        </div>

        {/* ── Files ── */}
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
                {filteredFiles.map((file) => {
                  const isSelected = selected?.id === file.id;
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
                      <div className="w-8"><FileIcon /></div>
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
                      <div className="w-8 flex justify-center"><ThreeDotMenu /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ── Grid view ── */
            <div className="grid grid-cols-3 gap-4">
              {filteredFiles.map((file) => {
                const isSelected = selected?.id === file.id;
                return (
                  <div
                    key={file.id}
                    onClick={() => setSelected(file)}
                    onDoubleClick={() => {
                      if (file.isOwned || userRole === "admin") router.push(`/files/${file.id}`);
                    }}
                    className="group cursor-pointer transition-colors overflow-hidden"
                    style={{
                      backgroundColor: isSelected ? "#eef0fc" : "#ffffff",
                      borderRadius: "8px",
                      border: isSelected ? "2px solid #b20100" : "1px solid #e8e4e3",
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "#f6f3f2"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = isSelected ? "#eef0fc" : "#ffffff"; }}
                  >
                    {/* Thumbnail / preview area */}
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
                    {/* Card info */}
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <FileIcon />
                      <div className="flex-1 min-w-0">
                        <p className="text-[0.8125rem] font-medium truncate" style={{ color: "#1c1b1b" }}>
                          {file.name.replace(/\.[^.]+$/, "")}
                        </p>
                        <p className="text-[0.6875rem] truncate" style={{ color: "#7a7574" }}>
                          {formatDate(file.uploaded_at)}
                        </p>
                      </div>
                      <ThreeDotMenu />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filteredFiles.length === 0 && (
            <div className="px-4 py-12 text-center text-[0.875rem]" style={{ color: "#7a7574" }}>
              {activeFilter !== "all"
                ? "No transcripts match the selected filter."
                : "No transcripts yet. Upload an audio file to get started."}
            </div>
          )}
        </div>
      </div>

      {/* ══ Right side: full-height preview panel ══ */}
      {selected && (
        <div
          className="w-80 shrink-0 p-5 flex flex-col"
          style={{ backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #e8e4e3" }}
        >
          {/* Preview thumbnail */}
          {(selected.isOwned || userRole === "admin") ? (
            <div className="w-full h-40 mb-4 flex items-center justify-center" style={{ backgroundColor: "#1c1b1b", borderRadius: "6px" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            </div>
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
          <div className="mt-4 pt-4 space-y-3" style={{ borderTop: "1px solid #e8e4e3" }}>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>METADATA DETAILS</p>
            <DetailRow label="File Name" value={selected.name} />
            <DetailRow label="Date Uploaded" value={selected.uploaded_at ? new Date(selected.uploaded_at).toLocaleDateString() : "\u2014"} />
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
    </div>
  );
}
