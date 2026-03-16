import { useState, useMemo } from "react";
import { uploadAudio } from "../services/api";
import AudioPlayer from "../components/AudioPlayer";

export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [uploaded, setUploaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const fileUrl = useMemo(() => {
    if (file) {
      return URL.createObjectURL(file);
    }
    return null;
  }, [file]);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setUploaded(false);

    try {
      await uploadAudio(file);
      setUploaded(true);
      setTimeout(() => setUploaded(false), 5000);
    } catch (error) {
      console.error("Transcription failed:", error);
      alert("Transcription failed. Please try again.");
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
        <label className={`w-full flex flex-col items-center px-4 py-6 bg-white text-blue-600 border-2 border-dashed border-blue-300 rounded-lg transition ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-blue-50 hover:border-blue-400"}`}>
          <span className="text-sm font-medium">
            {file ? file.name : "Choose an audio file"}
          </span>
          <input
            type="file"
            accept="audio/*"
            disabled={loading}
            onChange={(e) => setFile(e.target.files[0])}
            className="hidden"
          />
        </label>

        {file && (
          <>
            <AudioPlayer fileUrl={fileUrl} />

            <button
              onClick={handleUpload}
              disabled={loading}
              className={`mt-2 w-full px-4 py-3 text-white rounded-lg font-medium transition ${
                loading 
                  ? "bg-blue-400 cursor-not-allowed" 
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Transcribing...
                </span>
              ) : (
                "Upload & Transcribe"
              )}
            </button>
          </>
        )}

        {loading && (
          <div className="mt-4 text-blue-700 bg-blue-50 border border-blue-200 rounded p-3 text-sm flex items-center gap-2">
             <div className="animate-pulse flex space-x-4">
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-2 bg-blue-200 rounded"></div>
                  <div className="text-xs">Processing audio file. This may take a minute...</div>
                </div>
             </div>
          </div>
        )}

        {uploaded && !loading && (
          <div className="mt-4 text-green-700 bg-green-50 border border-green-200 rounded p-3 text-sm">
            Success! Transcription complete. You can find it in "Submitted Files".
          </div>
        )}
      </div>
    </div>
  );
}