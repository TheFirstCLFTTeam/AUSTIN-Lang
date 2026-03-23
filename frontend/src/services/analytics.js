import { fetchSubmittedFiles } from "./api";

/*
Compare original vs edited transcript
(simple word difference estimator)
*/
function wordDifference(original, edited) {
  const o = original.join(" ").split(" ");
  const e = edited.join(" ").split(" ");

  let diff = Math.abs(o.length - e.length);

  for (let i = 0; i < Math.min(o.length, e.length); i++) {
    if (o[i] !== e[i]) diff++;
  }

  return diff;
}

export async function getDashboardStats() {
  try {
    const response = await fetch("http://localhost:8006/metrics/dashboard");
    if (!response.ok) {
      throw new Error("Failed to fetch dashboard stats");
    }
    const metrics = await response.json();
    
    return {
      totalFiles: metrics.total_files,
      totalSegments: metrics.files_with_edits, // Reuse this field to show progress
      totalWordsEdited: metrics.needs_attention ? 1 : 0, // Flag for high WER
      estimatedAccuracy: metrics.average_wer !== null 
        ? ((1 - metrics.average_wer) * 100).toFixed(1) 
        : "100.0",
      average_queue_latency: metrics.average_queue_latency,
      average_transcription_time: metrics.average_transcription_time
    };
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return {
      totalFiles: 0,
      totalSegments: 0,
      totalWordsEdited: 0,
      estimatedAccuracy: "100.0"
    };
  }
}

export async function triggerRetraining() {
  console.log("Retraining started...");

  // simulate training time
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("Retraining finished");

  return {
    status: "success",
    message: "Model retrained successfully"
  };
}