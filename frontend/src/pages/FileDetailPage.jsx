import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import AudioPlayer from "../components/AudioPlayer";
import TranscriptEditor from "../components/TranscriptEditor";
import { fetchFileDetail, updateTranscript } from "../services/api";

export default function FileDetailPage() {
  const { id } = useParams();
  const [fileData, setFileData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchFileDetail(id).then(setFileData);
  }, [id]);

  const handleSubmit = async (text) => {
    await updateTranscript(id, text);
    setEditing(false);
    setSuccess(true);

    setTimeout(() => setSuccess(false), 3000);
  };

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

        <AudioPlayer fileUrl={fileData.audioUrl} />

        {success && (
          <div className="mt-4 p-3 rounded bg-green-50 text-green-700 border border-green-200">
            Transcript updated successfully
          </div>
        )}

        {!editing ? (
          <>
            <div className="mt-6 p-4 bg-gray-50 border rounded-lg whitespace-pre-wrap">
              {fileData.transcript}
            </div>

            <button
              onClick={() => setEditing(true)}
              className="mt-6 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
            >
              Update Transcript
            </button>
          </>
        ) : (
          <TranscriptEditor
            transcript={fileData.transcript}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}