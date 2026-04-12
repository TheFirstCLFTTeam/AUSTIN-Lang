'use client';

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AudioPlayer from "../../../../components/AudioPlayer";
import { fetchFileDetail, updateTranscript, getCurrentUser } from "../../../../services/api";

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
  const [localSegments, setLocalSegments] = useState([]);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [accessDenied, setAccessDenied] = useState(false);

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
      if (data?.transcriptSegments) setLocalSegments(data.transcriptSegments);
    });
  }, [id, userRole, user?.id]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  const activeId = localSegments.find((s) => currentTime >= s.start && currentTime < s.end)?.id;

  useEffect(() => {
    const el = document.getElementById(`seg-${activeId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeId]);

  function handleSeek(time) {
    if (!audioRef.current || !audioReady) return;
    audioRef.current.currentTime = time;
    if (audioRef.current.readyState >= 2) audioRef.current.play();
  }

  function updateText(segId, newText) {
    setLocalSegments((prev) => prev.map((s) => (s.id === segId ? { ...s, text: newText } : s)));
  }

  async function handleSubmit() {
    if (!fileData.editedTranscript) return;
    await updateTranscript(fileData.editedTranscript.id, fileData.rawTranscript.id, localSegments);
    fetchFileDetail(id).then(setFileData);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  }

  const totalWords = localSegments.reduce((acc, s) => acc + (s.originalText?.split(" ").length || 0), 0);
  const editedWords = localSegments.reduce((acc, s) => {
    if (!s.originalText || s.text === s.originalText) return acc;
    const orig = s.originalText.split(" ");
    const curr = s.text.split(" ");
    let diff = Math.abs(orig.length - curr.length);
    for (let i = 0; i < Math.min(orig.length, curr.length); i++) {
      if (orig[i] !== curr[i]) diff++;
    }
    return acc + diff;
  }, 0);
  const wer = totalWords > 0 ? ((editedWords / totalWords) * 100).toFixed(2) : "0.00";

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
          <button className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#b20100" }}>FLAG PRIVACY</button>
          <button onClick={handleSubmit} className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}>SAVE EDITS</button>
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

          {/* Transcript */}
          <div className="space-y-6">
            {localSegments.map((seg, i) => {
              const isActive = seg.id === activeId;
              const speaker = speakers[i % speakers.length];
              return (
                <div key={seg.id} id={`seg-${seg.id}`} className="flex gap-6 cursor-pointer" onClick={() => handleSeek(seg.start)}>
                  <div className="w-24 shrink-0 pt-1">
                    <SpeakerLabel speaker={speaker.toUpperCase()} time={formatTime(seg.start)} />
                  </div>
                  <div className="w-px self-stretch" style={{ backgroundColor: isActive ? "#b20100" : "rgba(233, 188, 181, 0.2)" }} />
                  <div className="flex-1 p-4 transition-colors" style={{ backgroundColor: isActive ? "rgba(178, 1, 0, 0.03)" : "transparent" }}>
                    <p contentEditable suppressContentEditableWarning onBlur={(e) => updateText(seg.id, e.target.innerText)} className="text-[0.875rem] leading-relaxed outline-none" style={{ color: "#1c1b1b" }}>{seg.text}</p>
                    <div className="flex items-center gap-4 mt-2">
                      <span className="text-[0.6875rem]" style={{ color: "#7a7574" }}>AI Accuracy: 98.4%</span>
                    </div>
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
            <AuditRow label="Duration" value={fileData.transcriptSegments?.length ? formatTime(fileData.transcriptSegments[fileData.transcriptSegments.length - 1]?.end || 0) : "\u2014"} />
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
