import { useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import AudioPlayer from "../components/AudioPlayer";
import TranscriptEditor from "../components/TranscriptEditor";
import { fetchFileDetail, updateTranscript } from "../services/api";

export default function FileDetailPage() {
  const { id } = useParams();
  const audioRef = useRef(null);

  const [fileData, setFileData] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchFileDetail(id).then(setFileData);
  }, [id]);

  async function handleSubmit(newSegments) {
    const updated = await updateTranscript(id, newSegments);
    setFileData(updated);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
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
      <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-sm p-8">
        <h1 className="text-2xl font-semibold mb-2">
          {fileData.name}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          Review audio and transcription
        </p>

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

        <TranscriptEditor
          segments={fileData.transcriptSegments}
          currentTime={currentTime}
          audioReady={audioReady}
          onSeek={handleSeek}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
