<<<<<<< HEAD
import { useEffect, useRef, useState } from "react";

export default function TranscriptEditor({
  segments,
  currentTime,
  audioReady,
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
          !audioReady ? "opacity-50 pointer-events-none" : ""
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
                : "hover:bg-gray-100"
            }`}
          >
            <span className="text-xs text-gray-400 mr-2">
              [{seg.start.toFixed(1)}s]
            </span>

            <span
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) =>
                updateText(seg.id, e.target.innerText)
              }
              className="outline-none"
            >
              {seg.text}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={() => onSubmit(localSegments)}
        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Save Transcript
      </button>
    </div>
  );
=======
import { useEffect, useRef, useState } from "react";

export default function TranscriptEditor({
  segments,
  currentTime,
  audioReady,
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
          !audioReady ? "opacity-50 pointer-events-none" : ""
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
                : "hover:bg-gray-100"
            }`}
          >
            <span className="text-xs text-gray-400 mr-2">
              [{seg.start.toFixed(1)}s]
            </span>

            <span
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) =>
                updateText(seg.id, e.target.innerText)
              }
              className="outline-none"
            >
              {seg.text}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={() => onSubmit(localSegments)}
        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Save Transcript
      </button>
    </div>
  );
>>>>>>> origin/main
}