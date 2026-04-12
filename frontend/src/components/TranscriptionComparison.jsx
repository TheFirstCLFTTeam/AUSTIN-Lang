import { useState, useMemo } from "react";
import * as Diff from "diff";

export default function TranscriptionComparison({
  leftName,
  leftSegments,
  rightName,
  rightSegments
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [showDiff, setShowDiff] = useState(true); // Default to true now as it's the main feature

  // Combine segments into full texts
  const leftFullText = useMemo(() => leftSegments.map(s => s.text.trim()).join(" "), [leftSegments]);
  const rightFullText = useMemo(() => rightSegments.map(s => s.text.trim()).join(" "), [rightSegments]);

  // Calculate word-level diff
  const diffResult = useMemo(() => {
    return Diff.diffWords(leftFullText, rightFullText);
  }, [leftFullText, rightFullText]);

  const highlightMatch = (text) => {
    if (!searchTerm) return text;
    const parts = String(text).split(new RegExp(`(${searchTerm})`, "gi"));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === searchTerm.toLowerCase() ? (
            <mark key={i} className="bg-yellow-200 rounded px-0.5">{part}</mark>
          ) : part
        )}
      </>
    );
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* Search & Toggle Bar */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <input 
            type="text"
            placeholder="Search for words in comparison..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full p-3 pl-10 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
          />
          <svg className="w-5 h-5 absolute left-3 top-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        
        <button 
          onClick={() => setShowDiff(!showDiff)}
          className={`px-4 py-3 rounded-xl font-medium transition flex items-center gap-2 border shadow-sm ${
            showDiff 
              ? "bg-blue-600 text-white border-blue-700" 
              : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
          }`}
        >
          {showDiff ? "Diff View Active" : "Show Full Texts"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6 h-[600px]">
        {/* LEFT COLUMN - Removed/Changed parts highlighted */}
        <div className="flex flex-col">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 px-2">
            Source: {leftName}
          </h3>
          <div className="flex-1 border border-gray-200 rounded-xl overflow-y-auto p-6 bg-white shadow-inner leading-relaxed text-base">
            {diffResult.map((part, index) => {
              if (part.added) return null; // Don't show added parts in the source column
              
              if (part.removed) {
                return (
                  <span 
                    key={index} 
                    className={`${showDiff ? "bg-red-100 text-red-800 border-b-2 border-red-300" : ""}`}
                  >
                    {highlightMatch(part.value)}
                  </span>
                );
              }
              
              return <span key={index}>{highlightMatch(part.value)}</span>;
            })}
          </div>
        </div>

        {/* RIGHT COLUMN - Added/Changed parts highlighted */}
        <div className="flex flex-col">
          <h3 className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2 px-2">
            Target: {rightName}
          </h3>
          <div className="flex-1 border border-blue-100 rounded-xl overflow-y-auto p-6 bg-blue-50/10 shadow-inner leading-relaxed text-base">
            {diffResult.map((part, index) => {
              if (part.removed) return null; // Don't show removed parts in the target column
              
              if (part.added) {
                return (
                  <span 
                    key={index} 
                    className={`${showDiff ? "bg-green-100 text-green-800 border-b-2 border-green-300" : ""}`}
                  >
                    {highlightMatch(part.value)}
                  </span>
                );
              }
              
              return <span key={index}>{highlightMatch(part.value)}</span>;
            })}
          </div>
        </div>
      </div>
      
      <div className="flex justify-between items-center px-2">
        <div className="flex gap-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-3 h-3 bg-red-100 border-b border-red-300"></span>
            <span>Removed from {leftName}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-3 h-3 bg-green-100 border-b border-green-300"></span>
            <span>Added in {rightName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
