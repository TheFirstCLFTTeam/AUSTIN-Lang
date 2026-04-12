import { useEffect, useState } from "react";
import { getDashboardStats, triggerRetraining } from "../services/analytics";
import StatCard from "../components/StatCard";
import ErrorChart from "../components/ErrorChart";

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [training, setTraining] = useState(false);

  useEffect(() => {
    getDashboardStats().then(setStats);
  }, []);

  const handleRetrain = async () => {
    setTraining(true);

    await triggerRetraining();

    alert("Retraining complete!");

    setTraining(false);
  };

  if (!stats) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-8">

      {/* Header + Button */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-semibold">
          Analytics Dashboard
        </h1>

        <button
          onClick={handleRetrain}
          disabled={training}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {training ? "Retraining..." : "Retrain Model"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        <StatCard title="Files Processed" value={stats.totalFiles} />

        <StatCard title="Files with Edits" value={stats.totalSegments} />

        <StatCard
          title="Avg. Word Accuracy"
          value={`${stats.estimatedAccuracy}%`}
        />

        <StatCard 
            title="Latest Record Accuracy" 
            value={stats.latestWER !== null ? `${(100 - stats.latestWER).toFixed(1)}%` : "N/A"} 
        />

        <StatCard 
            title="Queue Latency" 
            value={stats.average_queue_latency !== null ? `${stats.average_queue_latency.toFixed(1)}s` : "N/A"} 
        />

        <StatCard 
            title="Transcription Time" 
            value={stats.average_transcription_time !== null ? `${stats.average_transcription_time.toFixed(1)}s` : "N/A"} 
        />
      </div>

      {stats.totalWordsEdited > 0 && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-4 rounded-xl mb-8 flex items-center justify-center font-bold text-center animate-pulse">
          ⚠️ HIGH ERROR RATE ON LATEST RECORD: {stats.latestWER}% WER
        </div>
      )}

      <ErrorChart accuracy={stats.estimatedAccuracy} />
    </div>
  );
}