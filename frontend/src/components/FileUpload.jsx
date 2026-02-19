import { useState } from "react";
import { uploadAudio } from "../services/api";

export default function FileUpload({ onFileUpload }) {
  const [fileName, setFileName] = useState("");

  const handleChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);

    // Mock transcript for now if backend not ready
    const transcript = await uploadAudio(file).catch(() => "");

    onFileUpload(file, transcript);
  };

  return (
    <div className="mb-6">
      <label className="block mb-2 font-medium">
        Upload audio file
      </label>

      <input
        type="file"
        accept="audio/*"
        onChange={handleChange}
      />

      {fileName && (
        <p className="text-sm text-gray-600 mt-2">
          Selected file: {fileName}
        </p>
      )}
    </div>
  );
}