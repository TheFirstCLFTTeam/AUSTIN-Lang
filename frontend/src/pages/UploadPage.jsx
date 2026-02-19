import { useState } from "react";
import { uploadAudio } from "../services/api";
import AudioPlayer from "../components/AudioPlayer";

export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [uploaded, setUploaded] = useState(false);

  const handleUpload = async () => {
    await uploadAudio(file);
    setUploaded(true);
    setTimeout(() => setUploaded(false), 3000);
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
            onChange={(e) => setFile(e.target.files[0])}
            className="hidden"
          />
        </label>

        {file && (
          <>
            <AudioPlayer file={file} />

            <button
              onClick={handleUpload}
              className="mt-2 w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
            >
              Upload & Transcribe
            </button>
          </>
        )}

        {uploaded && (
          <div className="mt-4 text-green-700 bg-green-50 border border-green-200 rounded p-3 text-sm">
            Upload successful. Processing transcription.
          </div>
        )}
      </div>
    </div>
  );
}