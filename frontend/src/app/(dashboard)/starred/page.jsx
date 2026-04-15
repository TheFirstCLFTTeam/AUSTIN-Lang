'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSubmittedFiles, fetchAllFilesMetadata, getCurrentUser } from "../../../services/api";

function formatDate(dateStr) {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

function StarIcon({ filled, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "#f5a623" : "none"} stroke={filled ? "#f5a623" : "#7a7574"} strokeWidth="1.5" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
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

export default function StarredPage() {
  const router = useRouter();
  const [files, setFiles] = useState([]);
  const [favorites, setFavorites] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const user = getCurrentUser();
  const userRole = user?.role || "generic";
  const userId = user?.id || "anon";

  useEffect(() => {
    setLoading(true);
    const fetchFn = (userRole === "engineer" || userRole === "admin")
      ? fetchAllFilesMetadata
      : () => fetchSubmittedFiles().then((data) => data.map((f) => ({ ...f, isOwned: true })));
    fetchFn()
      .then((data) => setFiles(data))
      .catch((err) => console.error("Error fetching files:", err))
      .finally(() => setLoading(false));
  }, [userRole]);

  useEffect(() => {
    const load = () => {
      try {
        const favs = JSON.parse(localStorage.getItem(`austin.favorites.${userId}`) || "[]");
        setFavorites(new Set(favs));
      } catch {
        setFavorites(new Set());
      }
    };
    load();
    const onStorage = (e) => {
      if (e.key === `austin.favorites.${userId}`) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  const toggleFavorite = (id) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(`austin.favorites.${userId}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const starredFiles = files.filter((f) => favorites.has(f.id));

  return (
    <div>
      <div className="flex items-center gap-2 text-[0.75rem] mb-1" style={{ color: "#7a7574" }}>
        <span>HOME</span><span>/</span><span style={{ color: "#1c1b1b" }}>STARRED</span>
      </div>
      <h1 className="text-[2rem] font-bold tracking-tight mb-6" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>STARRED</h1>

      {loading ? (
        <div className="py-16 text-center text-[0.875rem]" style={{ color: "#7a7574" }}>Loading…</div>
      ) : starredFiles.length === 0 ? (
        <div className="py-16 text-center" style={{ backgroundColor: "#ffffff" }}>
          <svg className="mx-auto mb-4" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4c4c4" strokeWidth="1.5">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <p className="text-[0.875rem] font-semibold mb-1" style={{ color: "#1c1b1b" }}>No starred transcripts</p>
          <p className="text-[0.75rem]" style={{ color: "#7a7574" }}>Star important transcripts from the file browser to access them quickly here.</p>
        </div>
      ) : (
        <div>
          <div
            className="flex items-center px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-wider"
            style={{ color: "#7a7574", borderBottom: "1px solid #e8e4e3" }}
          >
            <div className="w-8" />
            <div className="w-8" />
            <div className="flex-1">Name</div>
            {userRole !== "generic" && <div className="w-28 text-center">Owner</div>}
            <div className="w-28 text-center">Date Uploaded</div>
            <div className="w-20 text-center">Duration</div>
            <div className="w-24 text-center">Language</div>
          </div>
          {starredFiles.map((file) => (
            <div
              key={file.id}
              onClick={() => {
                if (file.isOwned || userRole === "admin") router.push(`/files/${file.id}`);
              }}
              className="group flex items-center px-4 py-3 cursor-pointer transition-colors"
              style={{ backgroundColor: "#ffffff", borderBottom: "1px solid #f0edec" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f6f3f2"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#ffffff"; }}
            >
              <div className="w-8 flex justify-center">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(file.id); }}
                  className="w-7 h-7 flex items-center justify-center rounded-full cursor-pointer"
                  style={{ backgroundColor: "transparent", border: "none" }}
                  aria-label="Unstar"
                  title="Unstar"
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.06)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <StarIcon filled size={14} />
                </button>
              </div>
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
              <div className="w-28 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{formatDate(file.uploaded_at)}</div>
              <div className="w-20 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{file.duration || "\u2014"}</div>
              <div className="w-24 text-center text-[0.8125rem]" style={{ color: "#7a7574" }}>{file.detectedLanguage || "\u2014"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
