import { useEffect, useRef, useState } from "react";

export default function TranscriptEditor({
  segments,
  currentTime,
  audioReady,
  saving,
  onSeek,
  onSubmit
}) {
  const [localSegments, setLocalSegments] = useState(segments || []);

  useEffect(() => {
    setLocalSegments(segments || []);
  }, [segments]);

  const activeId = localSegments.find(
    (s) => currentTime >= s.start && currentTime < s.end
  )?.id;

  const containerRef = useRef(null);

  useEffect(() => {
    const el = document.getElementById(activeId);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeId]);

  function updateText(id, newText) {
    if (saving) return;
    setLocalSegments((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, text: newText } : s
      )
    );
  }

  return (
    <div className="mt-6">
      <h2 className="font-semibold mb-2">
        Transcript (click to seek, edit inline)
      </h2>

      {!audioReady && (
        <p className="text-sm text-gray-400 mb-2">
          Loading audio…
        </p>
      )}

      <div
        ref={containerRef}
        className={`border rounded-lg p-3 max-h-80 overflow-y-auto space-y-2 transition ${
          !audioReady || saving ? "opacity-50 pointer-events-none" : ""
        }`}
      >
        {localSegments.map((seg) => (
          <div
            key={seg.id}
            id={seg.id}
            onClick={() => onSeek(seg.start)}
            className={`p-2 rounded cursor-pointer ${
              seg.id === activeId
                ? "bg-blue-100"
                : "hover:bg-gray-50"
            }`}
          >
            <span className="text-xs text-gray-400 mr-2">
              [{seg.start.toFixed(1)}s]
            </span>

            <span
              contentEditable={!saving}
              suppressContentEditableWarning
              onBlur={(e) =>
                updateText(seg.id, e.target.innerText)
              }
              className={`outline-none ${saving ? "cursor-not-allowed" : ""}`}
            >
              {seg.text}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={() => onSubmit(localSegments)}
        disabled={saving || !audioReady}
        className={`mt-4 px-6 py-2 text-white rounded font-medium transition flex items-center gap-2 ${
          saving || !audioReady
            ? "bg-blue-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700"
        }`}
      >
        {saving ? (
          <>
            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Saving...
          </>
        ) : (
          "Save Transcript"
        )}
      </button>
    </div>
  );
}