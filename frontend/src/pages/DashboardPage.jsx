import { useEffect, useState } from "react";
import { getDashboardStats } from "../services/analytics";
import StatCard from "../components/StatCard";
import ErrorChart from "../components/ErrorChart";

export default function DashboardPage() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getDashboardStats().then(setStats);
  }, []);

  if (!stats) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-3xl font-semibold mb-8">
        Analytics Dashboard
      </h1>

      <div className="grid grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Files Processed"
          value={stats.totalFiles}
        />

        <StatCard
          title="Transcript Segments"
          value={stats.totalSegments}
        />

        <StatCard
          title="Words Corrected"
          value={stats.totalWordsEdited}
        />

        <StatCard
          title="Estimated Accuracy"
          value={`${stats.estimatedAccuracy}%`}
        />
      </div>

      <ErrorChart accuracy={stats.estimatedAccuracy} />
    </div>
  );
}