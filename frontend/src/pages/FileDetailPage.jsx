import { useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import AudioPlayer from "../components/AudioPlayer";
import TranscriptEditor from "../components/TranscriptEditor";
import TranscriptionComparison from "../components/TranscriptionComparison";
import { fetchFileDetail, updateTranscript, fetchSubmittedFiles } from "../services/api";

export default function FileDetailPage() {
  const { id } = useParams();
  const audioRef = useRef(null);

  const [fileData, setFileData] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  // Comparison State
  const [allFiles, setAllFiles] = useState([]);
  const [comparisonId, setComparisonId] = useState("");
  const [comparisonData, setComparisonData] = useState(null);
  const [isComparing, setIsComparing] = useState(false);

  useEffect(() => {
    fetchFileDetail(id).then(setFileData);
    fetchSubmittedFiles().then(files => {
      // Don't include current file in the comparison list
      setAllFiles(files.filter(f => f.id !== id));
    });
  }, [id]);

  async function handleStartComparison() {
    if (!comparisonId) return;
    const data = await fetchFileDetail(comparisonId);
    setComparisonData(data);
    setIsComparing(true);
  }

  async function handleSubmit(newSegments) {
    if (!fileData.editedTranscript) {
      console.error("No edited transcript found for update.");
      return;
    }
    
    setSaving(true);
    setSuccess(false);

    try {
      await updateTranscript(
        fileData.editedTranscript.id,
        fileData.rawTranscript.id,
        newSegments
      );
      // After update, re-fetch the entire file detail to get the latest state
      const updatedData = await fetchFileDetail(id);
      setFileData(updatedData);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error("Update failed:", error);
      alert("Failed to save transcript. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleSeek(time) {
    if (!audioRef.current || !audioReady) return;

    audioRef.current.currentTime = time;

    if (audioRef.current.readyState >= 2) {
      audioRef.current.play();
    }
  }

  if (!fileData) return null;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-6">
      <div className={`mx-auto bg-white rounded-xl shadow-sm p-8 transition-all ${isComparing ? "max-w-7xl" : "max-w-4xl"}`}>
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-semibold mb-1">
              {fileData.name}
            </h1>
            <p className="text-sm text-gray-500">
              Review audio and transcription
            </p>
          </div>

          <div className="flex items-center gap-3">
            {!isComparing ? (
              <div className="flex items-center gap-2">
                <select 
                  value={comparisonId}
                  onChange={(e) => setComparisonId(e.target.value)}
                  className="text-sm border rounded-lg p-2 bg-white"
                >
                  <option value="">Compare with another record...</option>
                  {allFiles.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <button 
                  onClick={handleStartComparison}
                  disabled={!comparisonId}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Compare
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setIsComparing(false)}
                className="text-blue-600 hover:underline text-sm font-medium"
              >
                Exit Comparison
              </button>
            )}
          </div>
        </div>

        <AudioPlayer
          fileUrl={fileData.audioUrl}
          audioRef={audioRef}
          onTimeUpdate={setCurrentTime}
          onReady={() => setAudioReady(true)}
        />

        {success && (
          <div className="mt-4 p-3 rounded bg-green-50 text-green-700 border">
            Transcript updated successfully
          </div>
        )}

        {isComparing ? (
          <TranscriptionComparison 
            leftName={fileData.name}
            leftSegments={fileData.transcriptSegments}
            rightName={comparisonData.name}
            rightSegments={comparisonData.transcriptSegments}
          />
        ) : (
          <TranscriptEditor
            segments={fileData.transcriptSegments}
            currentTime={currentTime}
            audioReady={audioReady}
            saving={saving}
            onSeek={handleSeek}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}
