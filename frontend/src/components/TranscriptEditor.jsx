import { useState } from "react";

export default function TranscriptEditor({ transcript, onSubmit }) {
  const [text, setText] = useState(transcript);

  return (
    <div className="mt-6">
      <h2 className="font-semibold mb-2">
        Transcript (Editable)
      </h2>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full h-48 p-3 border rounded mb-4"
      />

      <button
        onClick={() => onSubmit(text)}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Submit Corrected Transcript
      </button>
    </div>
  );
}