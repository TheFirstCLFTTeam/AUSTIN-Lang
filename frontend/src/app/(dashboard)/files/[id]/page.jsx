'use client';

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AudioPlayer from "../../../../components/AudioPlayer";
import { fetchFileDetail, saveEdits, getCurrentUser } from "../../../../services/api";
import { recordAccess } from "../../../../lib/recents";
import { applyEdits, buildDiffView, computeWER, rawWordIntervals, recomputeSegmentEdits } from "../../../../lib/transcriptEdits";

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function SpeakerLabel({ speaker, time }) {
  const color = speaker === "AGENT" ? "#7a7574" : "#b20100";
  return (
    <div className="mb-1">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color }}>{time}</span>
      <br />
      <span className="text-[0.75rem] font-bold uppercase tracking-wider" style={{ color }}>{speaker}</span>
    </div>
  );
}

export default function FileDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const audioRef = useRef(null);

  const [fileData, setFileData] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [success, setSuccess] = useState(false);
  const [edits, setEdits] = useState([]);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [accessDenied, setAccessDenied] = useState(false);
  const [editingSeg, setEditingSeg] = useState(null);
  const editRef = useRef(null);

  // Editor UX state — undo/redo stacks, save status, find bar, help overlay.
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [savedEdits, setSavedEdits] = useState([]);
  const [saveStatus, setSaveStatus] = useState("idle"); // 'idle' | 'saving' | 'saved' | 'error'
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const searchInputRef = useRef(null);

  const user = getCurrentUser();
  const userRole = user?.role || "generic";

  useEffect(() => {
    fetchFileDetail(id).then((data) => {
      if (!data) return;
      // Engineers can only view their own files' content
      if (userRole === "engineer" && data.ownerId && data.ownerId !== user?.id) {
        setAccessDenied(true);
        return;
      }
      setFileData(data);
      const initial = data.edits || [];
      setEdits(initial);
      setSavedEdits(initial);
      setUndoStack([]);
      setRedoStack([]);
      recordAccess(user?.id || "anon", id);
    });
  }, [id, userRole, user?.id]);

  const rawSegments = fileData?.rawTranscript?.transcript_segments || [];
  // Applied text per segment — only consumed by edit mode, where the user
  // edits the post-edit version they see. View mode renders the diff
  // directly from rawSegments + edits.
  const appliedSegments = applyEdits(rawSegments, edits);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  const activeId = rawSegments.find((s) => currentTime >= s.start && currentTime < s.end)?.id;

  useEffect(() => {
    const el = document.getElementById(`seg-${activeId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeId]);

  // When entering edit mode, focus the editable paragraph and put the caret
  // at the end so the user can start typing immediately.
  useEffect(() => {
    if (editingSeg == null || !editRef.current) return;
    editRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(editRef.current);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, [editingSeg]);

  function handleSeek(time) {
    if (!audioRef.current || !audioReady) return;
    audioRef.current.currentTime = time;
    if (audioRef.current.readyState >= 2) audioRef.current.play();
  }

  // Commit a new edits array and record the previous one for undo. Every
  // user-initiated change to `edits` (text edit, revert segment) funnels
  // through this so undo/redo semantics stay consistent.
  function commitEdits(nextEdits) {
    setUndoStack((s) => [...s, edits]);
    setRedoStack([]);
    setEdits(nextEdits);
  }

  function undo() {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, edits]);
    setEdits(prev);
  }

  function redo() {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, edits]);
    setEdits(next);
  }

  function updateText(segId, newText) {
    const rawSeg = rawSegments.find((s) => s.id === segId);
    if (!rawSeg) return;
    const next = recomputeSegmentEdits(edits, segId, rawSeg.text, newText, { editedBy: user?.id });
    // Skip the undo entry if the text didn't actually change.
    if (next.length === edits.length && next.every((e, i) => e === edits[i])) return;
    commitEdits(next);
  }

  function revertSegment(segId) {
    const next = edits.filter((e) => e.segmentId !== segId);
    if (next.length === edits.length) return;
    commitEdits(next);
  }

  // Segments that have edits, in reading order. Used for Alt+↓/↑ navigation.
  const editedSegmentIds = rawSegments
    .filter((s) => edits.some((e) => e.segmentId === s.id))
    .map((s) => s.id);

  function jumpToEdit(direction) {
    if (editedSegmentIds.length === 0) return;
    const activeIndex = editedSegmentIds.indexOf(activeId);
    let nextIndex;
    if (direction === "next") {
      nextIndex = activeIndex === -1
        ? editedSegmentIds.findIndex((sid) => {
            const seg = rawSegments.find((s) => s.id === sid);
            return seg && seg.start >= currentTime;
          })
        : activeIndex + 1;
      if (nextIndex < 0 || nextIndex >= editedSegmentIds.length) nextIndex = 0;
    } else {
      nextIndex = activeIndex <= 0 ? editedSegmentIds.length - 1 : activeIndex - 1;
    }
    const targetId = editedSegmentIds[nextIndex];
    const el = document.getElementById(`seg-${targetId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const target = rawSegments.find((s) => s.id === targetId);
    if (target) handleSeek(target.start);
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
  }

  // `edits` is considered "dirty" when it differs from the last-saved
  // snapshot. Shallow length check plus per-entry identity is enough
  // because every edit commit produces fresh objects.
  const isDirty = edits.length !== savedEdits.length
    || edits.some((e, i) => e !== savedEdits[i]);

  async function handleSubmit() {
    if (!fileData || !isDirty) return;
    setSaveStatus("saving");
    try {
      await saveEdits(fileData.id, edits);
      setSavedEdits(edits);
      setSaveStatus("saved");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      setSaveStatus("error");
    }
  }

  // Reflect dirty state back into the save-status chip while idle.
  useEffect(() => {
    if (saveStatus === "saving" || saveStatus === "error") return;
    setSaveStatus(isDirty ? "idle" : "saved");
  }, [isDirty, saveStatus]);

  // Focus the find input when the bar opens.
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Global keyboard shortcuts. Inside editable content we defer to the
  // browser for undo/redo so the native text-level history wins; our
  // app-level history only fires outside edit mode.
  useEffect(() => {
    function onKey(e) {
      const t = e.target;
      const isTyping = t?.isContentEditable
        || t?.tagName === "INPUT"
        || t?.tagName === "TEXTAREA";
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === "Escape") {
        if (showHelp) { setShowHelp(false); return; }
        if (searchOpen) { setSearchOpen(false); setSearchQuery(""); return; }
        return;
      }

      if (isTyping) return;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        jumpToEdit("next");
        return;
      }
      if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        jumpToEdit("prev");
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const wer = computeWER(rawSegments, edits).toFixed(2);

  if (accessDenied) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2" className="mb-4"><rect x="3" y="11" width="18" height="11" rx="0" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        <h2 className="text-[1.25rem] font-bold mb-2" style={{ color: "#1c1b1b" }}>Access Restricted</h2>
        <p className="text-[0.875rem] mb-6" style={{ color: "#7a7574" }}>You can only view metadata for this file. Audio and transcript content are not available.</p>
        <button onClick={() => router.push("/files")} className="px-6 py-2 text-[0.8125rem] font-semibold cursor-pointer" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}>
          BACK TO FILES
        </button>
      </div>
    );
  }

  if (!fileData) return null;

  const speakers = ["Agent", "CEO", "Agent"];

  return (
    <div>
      {/* Top Action Bar */}
      <div className="flex items-center justify-between px-6 py-3 mb-6 -mx-6 -mt-6" style={{ backgroundColor: "#ffffff" }}>
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/files")} className="text-[0.8125rem] cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#7a7574" }}>
            &larr;
          </button>
          <span className="text-[0.875rem] font-semibold" style={{ color: "#1c1b1b" }}>{fileData.name}</span>
          <span className="inline-block px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider" style={{ backgroundColor: "rgba(0, 78, 198, 0.08)", color: "#004ec6", borderRadius: "0px" }}>IN REVIEW</span>
        </div>
        <div className="flex items-center gap-3">
          <SaveStatus status={saveStatus} isDirty={isDirty} />
          <button className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#b20100" }}>FLAG PRIVACY</button>
          <button
            onClick={handleSubmit}
            disabled={!isDirty || saveStatus === "saving"}
            className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}
          >
            {saveStatus === "saving" ? "SAVING…" : "SAVE EDITS"}
          </button>
          <button className="px-4 py-1.5 text-[0.8125rem] font-semibold cursor-pointer" style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}>APPROVE TRANSCRIPT</button>
        </div>
      </div>

      {success && (
        <div className="mb-4 p-3 text-[0.8125rem]" style={{ backgroundColor: "rgba(0, 78, 198, 0.05)", color: "#004ec6" }}>
          Transcript updated successfully.
        </div>
      )}

      <div className="flex gap-6">
        <div className="flex-1">
          {/* Audio Player */}
          <div className="p-4 mb-6" style={{ backgroundColor: "#ffffff" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <button className="w-8 h-8 flex items-center justify-center cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#7a7574" }} onClick={() => { if (audioRef.current) audioRef.current.currentTime -= 10; }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                </button>
                <button className="w-10 h-10 flex items-center justify-center cursor-pointer" style={{ backgroundColor: "#1c1b1b", border: "none", borderRadius: "0px", color: "#ffffff" }} onClick={() => { if (!audioRef.current) return; audioRef.current.paused ? audioRef.current.play() : audioRef.current.pause(); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                </button>
                <button className="w-8 h-8 flex items-center justify-center cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#7a7574" }} onClick={() => { if (audioRef.current) audioRef.current.currentTime += 10; }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[0.6875rem] uppercase tracking-wider" style={{ color: "#7a7574" }}>Playback Speed</span>
                <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))} className="text-[0.8125rem] px-2 py-1 cursor-pointer" style={{ backgroundColor: "#f6f3f2", border: "none", borderRadius: "0px", color: "#1c1b1b" }}>
                  <option value={0.5}>0.5x</option><option value={0.75}>0.75x</option><option value={1.0}>1.0x</option>
                  <option value={1.25}>1.25x</option><option value={1.5}>1.5x</option><option value={2.0}>2.0x</option>
                </select>
              </div>
            </div>

            <div className="relative h-16 mb-2" style={{ backgroundColor: "#f6f3f2" }}>
              <div className="absolute inset-0 flex items-center justify-center gap-px px-2">
                {Array.from({ length: 80 }).map((_, i) => {
                  const h = 8 + Math.sin(i * 0.5) * 20 + Math.sin(i * 1.3) * 12;
                  return (<div key={i} className="w-1" style={{ height: `${h}px`, backgroundColor: i / 80 < (audioRef.current ? currentTime / (audioRef.current.duration || 1) : 0) ? "#b20100" : "#c4c4c4" }} />);
                })}
              </div>
            </div>

            <div className="flex justify-between text-[0.75rem]" style={{ color: "#7a7574" }}>
              <span>{formatTime(currentTime)}</span>
              <span>{audioRef.current?.duration ? formatTime(audioRef.current.duration) : "\u2014"}</span>
            </div>

            <AudioPlayer fileUrl={fileData.audioUrl} audioRef={audioRef} onTimeUpdate={setCurrentTime} onReady={() => setAudioReady(true)} />
          </div>

          {/* Editor toolbar — undo/redo, find, jump-between-edits, help. */}
          <div className="flex items-center justify-between px-4 py-2 mb-4" style={{ backgroundColor: "#ffffff", border: "1px solid #f0edec" }}>
            <div className="flex items-center gap-1">
              <ToolbarButton onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-7 3L3 13" /></svg>
              </ToolbarButton>
              <ToolbarButton onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Shift+Z)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 7 3l2 2" /></svg>
              </ToolbarButton>
              <div className="w-px h-5 mx-1" style={{ backgroundColor: "#f0edec" }} />
              <ToolbarButton onClick={() => setSearchOpen((v) => !v)} title="Find (Ctrl+F)" active={searchOpen}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              </ToolbarButton>
              <div className="w-px h-5 mx-1" style={{ backgroundColor: "#f0edec" }} />
              <ToolbarButton onClick={() => jumpToEdit("prev")} disabled={editedSegmentIds.length === 0} title="Previous edit (Alt+↑)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
              </ToolbarButton>
              <ToolbarButton onClick={() => jumpToEdit("next")} disabled={editedSegmentIds.length === 0} title="Next edit (Alt+↓)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </ToolbarButton>
              <span className="ml-2 text-[0.6875rem]" style={{ color: "#7a7574" }}>
                {editedSegmentIds.length === 0 ? "No edits" : `${edits.length} edit${edits.length === 1 ? "" : "s"} across ${editedSegmentIds.length} segment${editedSegmentIds.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <ToolbarButton onClick={() => setShowHelp(true)} title="Keyboard shortcuts (?)">
              <span className="text-[0.75rem] font-semibold" style={{ fontFamily: "monospace" }}>?</span>
            </ToolbarButton>
          </div>

          {searchOpen && (
            <div className="flex items-center gap-2 px-4 py-2 mb-4" style={{ backgroundColor: "#fffbea", border: "1px solid #f5e6a8" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Find in transcript…"
                className="flex-1 text-[0.8125rem] outline-none"
                style={{ backgroundColor: "transparent", border: "none", color: "#1c1b1b" }}
              />
              <button onClick={() => { setSearchOpen(false); setSearchQuery(""); }} className="text-[0.75rem] cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#7a7574" }}>
                Esc
              </button>
            </div>
          )}

          {/* Transcript */}
          <div className="space-y-6">
            {rawSegments.map((rawSeg, i) => {
              const isActive = rawSeg.id === activeId;
              const speaker = speakers[i % speakers.length];
              const intervals = rawWordIntervals(rawSeg);
              const tokens = buildDiffView(rawSeg, edits);
              const editCount = edits.filter((e) => e.segmentId === rawSeg.id).length;
              const appliedText = appliedSegments[i]?.text ?? rawSeg.text;
              return (
                <div key={rawSeg.id} id={`seg-${rawSeg.id}`} className="flex gap-6 cursor-pointer" onClick={() => handleSeek(rawSeg.start)}>
                  <div className="w-24 shrink-0 pt-1">
                    <SpeakerLabel speaker={speaker.toUpperCase()} time={formatTime(rawSeg.start)} />
                    {editCount > 0 && (
                      <div className="flex items-center gap-1 mt-1">
                        <span
                          className="inline-block px-1.5 py-0.5 text-[0.625rem] font-semibold"
                          style={{ backgroundColor: "rgba(26, 127, 55, 0.10)", color: "#1a7f37", borderRadius: "2px" }}
                          title={`${editCount} edit${editCount === 1 ? "" : "s"} in this segment`}
                        >
                          +{editCount}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); revertSegment(rawSeg.id); }}
                          className="text-[0.625rem] cursor-pointer"
                          style={{ backgroundColor: "transparent", border: "none", color: "#7a7574", padding: 0 }}
                          title="Revert this segment to the model output"
                        >
                          revert
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="w-px self-stretch" style={{ backgroundColor: isActive ? "#b20100" : "rgba(233, 188, 181, 0.2)" }} />
                  <div className="flex-1 p-4 transition-colors" style={{ backgroundColor: isActive ? "rgba(178, 1, 0, 0.06)" : "transparent" }}>
                    {editingSeg === rawSeg.id ? (
                      <p
                        ref={editRef}
                        contentEditable
                        suppressContentEditableWarning
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => { updateText(rawSeg.id, e.target.innerText); setEditingSeg(null); }}
                        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditingSeg(null); } }}
                        className="text-[0.875rem] leading-relaxed outline-none"
                        style={{ color: "#1c1b1b", boxShadow: "0 0 0 2px rgba(178, 1, 0, 0.25)", padding: "2px 4px" }}
                      >
                        {appliedText}
                      </p>
                    ) : (
                      <p
                        onDoubleClick={(e) => { e.stopPropagation(); setEditingSeg(rawSeg.id); }}
                        className="text-[0.875rem] leading-relaxed"
                        style={{ color: "#1c1b1b" }}
                        title="Double-click to edit"
                      >
                        {tokens.map((tok, ti) => {
                          const interval = tok.rawIndex != null ? intervals[tok.rawIndex] : null;
                          const isWordActive = isActive && interval && currentTime >= interval.start && currentTime < interval.end;
                          const base = {
                            padding: "0 1px",
                            borderRadius: "2px",
                            transition: "background-color 0.1s ease-out",
                          };
                          if (tok.kind === "inserted") {
                            return (
                              <span
                                key={ti}
                                style={{
                                  ...base,
                                  color: "#1a7f37",
                                  textDecoration: "underline",
                                  textDecorationStyle: "solid",
                                  textUnderlineOffset: "2px",
                                }}
                                title="Inserted by reviewer"
                              >
                                {tok.text}{" "}
                              </span>
                            );
                          }
                          if (tok.kind === "deleted") {
                            return (
                              <span
                                key={ti}
                                onClick={(e) => { e.stopPropagation(); if (interval) handleSeek(interval.start); }}
                                style={{
                                  ...base,
                                  color: "#b20100",
                                  textDecoration: "line-through",
                                  backgroundColor: isWordActive ? "rgba(178, 1, 0, 0.15)" : "transparent",
                                  cursor: "pointer",
                                }}
                                title="Removed by reviewer — click to seek"
                              >
                                {tok.text}{" "}
                              </span>
                            );
                          }
                          return (
                            <span
                              key={ti}
                              onClick={(e) => { e.stopPropagation(); if (interval) handleSeek(interval.start); }}
                              style={{
                                ...base,
                                color: isWordActive ? "#1c1b1b" : "inherit",
                                backgroundColor: isWordActive ? "rgba(178, 1, 0, 0.20)" : "transparent",
                                fontWeight: isWordActive ? 600 : "inherit",
                                cursor: "pointer",
                              }}
                            >
                              {tok.text}{" "}
                            </span>
                          );
                        })}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-64 shrink-0 space-y-6">
          <div className="p-4" style={{ backgroundColor: "#ffffff" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574" }}>Word Error Rate</span>
              <span className="text-[0.625rem] px-1.5 py-0.5 font-semibold" style={{ backgroundColor: "rgba(178, 1, 0, 0.08)", color: "#b20100", borderRadius: "0px" }}>REAL-TIME</span>
            </div>
            <p className="text-[2rem] font-bold" style={{ color: "#1c1b1b" }}>{wer}%</p>
            <p className="text-[0.6875rem]" style={{ color: "#7a7574" }}>Institutional threshold met.</p>
          </div>

          <div className="p-4" style={{ backgroundColor: "#ffffff" }}>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-3" style={{ color: "#7a7574" }}>Compliance Protocol (FR-A01)</p>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4" style={{ accentColor: "#b20100" }} />
              <span className="text-[0.8125rem] font-medium" style={{ color: "#1c1b1b" }}>PII Redacted</span>
            </label>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4" style={{ accentColor: "#b20100" }} />
              <span className="text-[0.8125rem] font-medium" style={{ color: "#1c1b1b" }}>Legal Disclaimers</span>
            </label>
          </div>

          <div className="p-4" style={{ backgroundColor: "#ffffff", borderLeft: "3px solid #b20100" }}>
            <p className="text-[0.6875rem] font-bold uppercase tracking-wider mb-1" style={{ color: "#b20100" }}>SENSITIVITY ALERT</p>
            <p className="text-[0.75rem]" style={{ color: "#1c1b1b" }}>Non-public data disclosure detected.</p>
            <button className="text-[0.6875rem] font-semibold mt-2 cursor-pointer" style={{ backgroundColor: "transparent", border: "none", color: "#b20100" }}>REVIEW ALERT &rarr;</button>
          </div>

          <div className="p-4" style={{ backgroundColor: "#ffffff" }}>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-3" style={{ color: "#7a7574" }}>Institutional Audit</p>
            <AuditRow label="Duration" value={rawSegments.length ? formatTime(rawSegments[rawSegments.length - 1]?.end || 0) : "\u2014"} />
            <AuditRow label="Asset Quality" value="HIGH" />
            <AuditRow label="Source Format" value="WAV (48kHz)" />
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditRow({ label, value }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-[0.75rem]" style={{ color: "#7a7574" }}>{label}</span>
      <span className="text-[0.75rem] font-semibold" style={{ color: "#1c1b1b" }}>{value}</span>
    </div>
  );
}
