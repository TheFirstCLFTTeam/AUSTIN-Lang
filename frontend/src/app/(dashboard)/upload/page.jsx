'use client';

import { useState, useMemo, useEffect } from "react";
import { uploadAudio, fetchAdapters } from "../../../services/api";
import AudioPlayer from "../../../components/AudioPlayer";

// FR-U01: recordings SHALL be at least 2 minutes. Enforced client-side on
// file selection; the server-side orchestrator should re-validate.
const MIN_DURATION_SECONDS = 120;

const LANGUAGES = [
    { code: '', label: 'Auto-detect' },
    { code: 'en', label: 'English' },
    { code: 'zh', label: 'Mandarin' },
    { code: 'yue', label: 'Cantonese' },
    { code: 'ms', label: 'Malay' },
];

function formatDuration(sec) {
    if (!Number.isFinite(sec)) return '—';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

export default function UploadPage() {
    const [file, setFile] = useState(null);
    const [duration, setDuration] = useState(null);
    const [durationError, setDurationError] = useState(null);
    const [domain, setDomain] = useState('base');
    const [language, setLanguage] = useState('');
    const [adapters, setAdapters] = useState(['base']);
    const [uploaded, setUploaded] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);

    const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

    useEffect(() => {
        let cancelled = false;
        fetchAdapters()
            .then((r) => { if (!cancelled) setAdapters(r?.adapters?.length ? r.adapters : ['base']); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!file) {
            setDuration(null);
            setDurationError(null);
            return;
        }
        setDuration(null);
        setDurationError(null);
        const url = URL.createObjectURL(file);
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.src = url;
        audio.onloadedmetadata = () => {
            const d = audio.duration;
            setDuration(d);
            if (d < MIN_DURATION_SECONDS) {
                setDurationError(`Recording is ${formatDuration(d)}. Minimum is 2:00.`);
            }
            URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
            setDurationError('Could not read audio metadata.');
            URL.revokeObjectURL(url);
        };
    }, [file]);

    const handleUpload = async () => {
        if (!file || durationError) return;
        setUploading(true);
        setUploadError(null);
        try {
            await uploadAudio(file, { domain, language: language || undefined });
            setUploaded(true);
            setTimeout(() => setUploaded(false), 3000);
        } catch (err) {
            setUploadError(err?.message || 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const canUpload = !!file && !durationError && !uploading;

    return (
        <div>
            <div className="flex items-center gap-2 text-[0.6875rem] mb-1" style={{ color: "#7a7574" }}>
                <span>HOME</span><span>/</span><span style={{ color: "#1c1b1b" }}>UPLOAD</span>
            </div>

            <h1 className="text-[2rem] font-bold tracking-tight mb-8" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>
                NEW TRANSCRIPTION
            </h1>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                <div>
                    <h2 className="text-[1.25rem] font-bold mb-3" style={{ color: "#1c1b1b" }}>Upload an audio file</h2>
                    <p className="text-[0.875rem] max-w-md" style={{ color: "#7a7574" }}>
                        Supported formats include WAV, MP3, FLAC, and M4A. Recordings must be at least 2 minutes long.
                        You&#39;ll be able to review and correct the transcript after processing.
                    </p>
                </div>

                <div className="p-8 flex flex-col gap-4" style={{ backgroundColor: "#ffffff" }}>
                    <label
                        className="w-full flex flex-col items-center px-4 py-10 cursor-pointer transition-colors"
                        style={{ backgroundColor: "#f6f3f2", border: "2px dashed rgba(233, 188, 181, 0.3)", borderRadius: "0px" }}
                    >
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="1.5">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <span className="mt-3 text-[0.8125rem] font-medium" style={{ color: "#1c1b1b" }}>
                            {file ? file.name : "Choose an audio file"}
                        </span>
                        <span className="text-[0.6875rem] mt-1" style={{ color: "#7a7574" }}>Drag and drop or click to browse</span>
                        <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files[0])} className="hidden" />
                    </label>

                    {file && (
                        <>
                            <AudioPlayer fileUrl={fileUrl} />

                            <div className="flex items-center justify-between text-[0.75rem]" style={{ color: "#7a7574" }}>
                                <span>Duration</span>
                                <span style={{ color: durationError ? "#b20100" : "#1c1b1b" }}>
                                    {duration == null ? 'Reading…' : formatDuration(duration)}
                                </span>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-[0.6875rem] font-semibold uppercase tracking-wide" style={{ color: "#7a7574" }}>
                                    Model adapter
                                </label>
                                <select
                                    value={domain}
                                    onChange={(e) => setDomain(e.target.value)}
                                    className="w-full px-3 py-2 text-[0.8125rem]"
                                    style={{ backgroundColor: "#f6f3f2", border: "1px solid rgba(28,27,27,0.1)", borderRadius: "0px", color: "#1c1b1b" }}
                                >
                                    {adapters.map((a) => (
                                        <option key={a} value={a}>
                                            {a === 'base' ? 'Base model (no adapter)' : a}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-[0.6875rem] font-semibold uppercase tracking-wide" style={{ color: "#7a7574" }}>
                                    Language
                                </label>
                                <select
                                    value={language}
                                    onChange={(e) => setLanguage(e.target.value)}
                                    className="w-full px-3 py-2 text-[0.8125rem]"
                                    style={{ backgroundColor: "#f6f3f2", border: "1px solid rgba(28,27,27,0.1)", borderRadius: "0px", color: "#1c1b1b" }}
                                >
                                    {LANGUAGES.map((l) => (
                                        <option key={l.code || 'auto'} value={l.code}>{l.label}</option>
                                    ))}
                                </select>
                            </div>

                            {durationError && (
                                <div className="p-3 text-[0.8125rem]" style={{ backgroundColor: "rgba(178, 1, 0, 0.05)", color: "#b20100" }}>
                                    {durationError}
                                </div>
                            )}

                            <button
                                onClick={handleUpload}
                                disabled={!canUpload}
                                className="w-full py-3 text-[0.8125rem] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}
                            >
                                {uploading ? "UPLOADING..." : "UPLOAD & TRANSCRIBE"}
                            </button>
                        </>
                    )}

                    {uploadError && (
                        <div className="p-3 text-[0.8125rem]" style={{ backgroundColor: "rgba(178, 1, 0, 0.05)", color: "#b20100" }}>
                            {uploadError}
                        </div>
                    )}

                    {uploaded && (
                        <div className="p-3 text-[0.8125rem]" style={{ backgroundColor: "rgba(0, 78, 198, 0.05)", color: "#004ec6" }}>
                            Upload successful. Processing transcription.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
