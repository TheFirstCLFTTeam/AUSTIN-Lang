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

      <div className="grid grid-cols-4 gap-6 mb-8">
        <StatCard title="Files Processed" value={stats.totalFiles} />

        <StatCard title="Transcript Segments" value={stats.totalSegments} />

        <StatCard title="Words Corrected" value={stats.totalWordsEdited} />

        <StatCard
          title="Estimated Accuracy"
          value={`${stats.estimatedAccuracy}%`}
        />
      </div>

      <ErrorChart accuracy={stats.estimatedAccuracy} />
    </div>
  );
}