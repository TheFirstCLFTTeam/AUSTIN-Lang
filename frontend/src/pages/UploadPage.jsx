import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { uploadAudio } from "../services/api";
import AudioPlayer from "../components/AudioPlayer";

export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleUpload = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await uploadAudio(file);
      setResult(data);
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">

      {/* Instructions */}
      <div>
        <h2 className="text-3xl font-semibold">
          Upload an audio file
        </h2>
        <p className="mt-3 text-gray-600 max-w-md">
          Supported formats include WAV and MP3. You’ll be able to
          review and correct the transcript after processing.
        </p>
      </div>

      {/* Upload Card */}
      <div className="bg-white rounded-2xl shadow-lg p-8 flex flex-col gap-4">

        {/* Custom file input */}
        <label className="w-full flex flex-col items-center px-4 py-6 bg-white text-blue-600 border-2 border-dashed border-blue-300 rounded-lg cursor-pointer hover:bg-blue-50 hover:border-blue-400 transition">
          <span className="text-sm font-medium">
            {file ? file.name : "Choose an audio file"}
          </span>
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => { setFile(e.target.files[0]); setResult(null); setError(null); }}
            className="hidden"
          />
        </label>

        {file && !result && (
          <>
            <AudioPlayer file={file} />

            <button
              onClick={handleUpload}
              disabled={loading}
              className="mt-2 w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {loading ? "Transcribing\u2026" : "Upload & Transcribe"}
            </button>
          </>
        )}

        {error && (
          <div className="mt-4 text-red-700 bg-red-50 border border-red-200 rounded p-3 text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="text-green-700 bg-green-50 border border-green-200 rounded p-3 text-sm">
              Transcription complete.
              {result.language && (
                <span className="ml-2 text-gray-500">
                  Language: <strong>{result.language}</strong>
                </span>
              )}
            </div>

            <div className="p-4 bg-gray-50 border rounded-lg whitespace-pre-wrap text-sm text-gray-800">
              {result.transcript}
            </div>

            <button
              onClick={() => navigate(`/files/${result.id}`)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
            >
              View &amp; Edit Transcript
            </button>

            <button
              onClick={() => { setFile(null); setResult(null); }}
              className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition"
            >
              Upload Another
            </button>
          </div>
        )}
      </div>
    </div>
  );
}