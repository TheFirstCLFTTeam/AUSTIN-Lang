'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import {
    fetchSubmittedFiles,
    fetchAllFilesMetadata,
    getCurrentUser,
} from "../../../services/api";
import {
    getAccessMap,
    clearAccess,
    groupByDateBucket,
    RECENTS_EVENT,
} from "../../../lib/recents";
import { getTimeFormat, TIME_FORMAT_EVENT, TIME_FORMAT_KEY } from "../../../lib/timeFormat";

function formatAccessTime(iso, timeFormat) {
    if (!iso) return "\u2014";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "\u2014";
    return d.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: timeFormat === "12h",
    });
}

export default function RecentPage() {
    const [files, setFiles] = useState([]);
    const [accessMap, setAccessMap] = useState({});
    const [loading, setLoading] = useState(true);
    const [timeFormat, setTimeFormatState] = useState("12h");

    const user = getCurrentUser();
    const userRole = user?.role || "generic";
    const userId = user?.id || "anon";

    useEffect(() => {
        setLoading(true);
        const fetchFn = (userRole === "engineer" || userRole === "admin")
            ? fetchAllFilesMetadata
            : () => fetchSubmittedFiles().then((d) => d.map((f) => ({ ...f, isOwned: true })));
        fetchFn()
            .then((data) => setFiles(data))
            .catch((err) => console.error("Error fetching files:", err))
            .finally(() => setLoading(false));
    }, [userRole]);

    useEffect(() => {
        const load = () => setAccessMap(getAccessMap(userId));
        load();
        const onStorage = (e) => {
            if (e.key && e.key.startsWith("austin.recents.")) load();
        };
        const onCustom = () => load();
        window.addEventListener("storage", onStorage);
        window.addEventListener(RECENTS_EVENT, onCustom);
        return () => {
            window.removeEventListener("storage", onStorage);
            window.removeEventListener(RECENTS_EVENT, onCustom);
        };
    }, [userId]);

    useEffect(() => {
        setTimeFormatState(getTimeFormat());
        const onCustom = (e) => setTimeFormatState(e.detail ?? getTimeFormat());
        const onStorage = (e) => { if (e.key === TIME_FORMAT_KEY) setTimeFormatState(getTimeFormat()); };
        window.addEventListener(TIME_FORMAT_EVENT, onCustom);
        window.addEventListener("storage", onStorage);
        return () => {
            window.removeEventListener(TIME_FORMAT_EVENT, onCustom);
            window.removeEventListener("storage", onStorage);
        };
    }, []);

    const recentItems = files
        .filter((f) => accessMap[f.id])
        .map((f) => ({ file: f, accessedAt: accessMap[f.id] }))
        .sort((a, b) => new Date(b.accessedAt) - new Date(a.accessedAt));

    const groups = groupByDateBucket(recentItems);

    return (
        <div>
            <div className="flex items-center gap-2 text-[0.75rem] mb-1" style={{ color: "#7a7574" }}>
                <span>HOME</span><span>/</span><span style={{ color: "#1c1b1b" }}>RECENT</span>
            </div>
            <h1 className="text-[2rem] font-bold tracking-tight mb-6" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>RECENT</h1>

            {loading ? (
                <div className="py-16 text-center text-[0.875rem]" style={{ color: "#7a7574" }}>Loading…</div>
            ) : recentItems.length === 0 ? (
                <div className="py-16 text-center" style={{ backgroundColor: "#ffffff" }}>
                    <svg className="mx-auto mb-4" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4c4c4" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="9" />
                        <polyline points="12 7 12 12 15 14" />
                    </svg>
                    <p className="text-[0.875rem] font-semibold mb-1" style={{ color: "#1c1b1b" }}>No recent transcripts</p>
                    <p className="text-[0.75rem]" style={{ color: "#7a7574" }}>Open a transcript and it will appear here, sorted by when you last viewed it.</p>
                </div>
            ) : (
                <div style={{ backgroundColor: "#ffffff" }}>
                    {groups.map((group) => (
                        <div key={group.label}>
                            <div
                                className="flex items-center gap-3 px-5 py-2 text-[0.6875rem] font-semibold uppercase tracking-wider"
                                style={{
                                    color: "#7a7574",
                                    backgroundColor: "#faf9f8",
                                    borderTop: "1px solid #e8e4e3",
                                    borderBottom: "1px solid #e8e4e3",
                                }}
                            >
                                <span>{group.label}</span>
                                <span style={{ color: "#c4bfbe" }}>·</span>
                                <span style={{ color: "#c4bfbe" }}>{group.entries.length}</span>
                            </div>
                            {group.entries.map(({ file, accessedAt }) => {
                                const canOpen = file.isOwned || userRole === "admin";
                                const rowInner = (
                                    <>
                                        <div className="w-8">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                <polyline points="14 2 14 8 20 8" />
                                            </svg>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[0.8125rem] font-semibold truncate" style={{ color: "#1c1b1b" }}>
                                                {file.name.replace(/\.[^.]+$/, "")}
                                            </p>
                                            {!file.isOwned && userRole !== "generic" && (
                                                <p className="text-[0.6875rem] truncate" style={{ color: "#7a7574" }}>
                                                    Owned by {file.ownerName || "another user"}
                                                </p>
                                            )}
                                        </div>
                                        <div className="w-28 text-right text-[0.75rem]" style={{ color: "#7a7574" }}>
                                            {formatAccessTime(accessedAt, timeFormat)}
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                clearAccess(userId, file.id);
                                            }}
                                            className="ml-3 w-7 h-7 flex items-center justify-center rounded-full cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                            style={{ backgroundColor: "transparent", border: "none" }}
                                            aria-label="Remove from recents"
                                            title="Remove from recents"
                                            onMouseEnter={(ev) => { ev.currentTarget.style.backgroundColor = "rgba(0,0,0,0.06)"; }}
                                            onMouseLeave={(ev) => { ev.currentTarget.style.backgroundColor = "transparent"; }}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2">
                                                <line x1="6" y1="6" x2="18" y2="18" />
                                                <line x1="6" y1="18" x2="18" y2="6" />
                                            </svg>
                                        </button>
                                    </>
                                );
                                const baseClasses = "group flex items-center px-5 py-3 transition-colors no-underline";
                                const rowStyle = { borderBottom: "1px solid #f0edec" };
                                return canOpen ? (
                                    <Link
                                        key={file.id}
                                        href={`/files/${file.id}`}
                                        className={`${baseClasses} cursor-pointer hover:bg-[#f6f3f2]`}
                                        style={rowStyle}
                                    >
                                        {rowInner}
                                    </Link>
                                ) : (
                                    <div
                                        key={file.id}
                                        className={baseClasses}
                                        style={{ ...rowStyle, cursor: "not-allowed", opacity: 0.7 }}
                                        title="Content restricted"
                                    >
                                        {rowInner}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
