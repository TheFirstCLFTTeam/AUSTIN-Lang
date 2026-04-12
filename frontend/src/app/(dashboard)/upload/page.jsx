'use client';

import { useState, useMemo } from "react";
import { uploadAudio } from "../../../services/api";
import AudioPlayer from "../../../components/AudioPlayer";

export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [uploaded, setUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileUrl = useMemo(() => {
    if (file) return URL.createObjectURL(file);
    return null;
  }, [file]);

  const handleUpload = async () => {
    setUploading(true);
    await uploadAudio(file);
    setUploading(false);
    setUploaded(true);
    setTimeout(() => setUploaded(false), 3000);
  };

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
            Supported formats include WAV, MP3, FLAC, and M4A.
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
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="w-full py-3 text-[0.8125rem] font-semibold cursor-pointer disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", border: "none", borderRadius: "0px" }}
              >
                {uploading ? "UPLOADING..." : "UPLOAD & TRANSCRIBE"}
              </button>
            </>
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
