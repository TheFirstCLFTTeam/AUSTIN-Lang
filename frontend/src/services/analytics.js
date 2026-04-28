import { MOCK_FILE_STORE } from "./mock-data";
import { totalRawWords } from "../lib/transcriptEdits";
import { fetchDashboardMetrics } from "./metrics";

const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_API === 'true';

// Aggregate stats across the corpus. In mock mode, edit count = sum of
// `edits.length` across files and estimated accuracy is derived from total
// edits relative to total raw words (1 - edit-rate, floored at 70%). In real
// mode we ask the metrics service and project its shape onto the dashboard's
// expected fields — see notes at each assignment for the mapping.
export async function getDashboardStats() {
  if (MOCK_MODE) {
    await new Promise((r) => setTimeout(r, 200));

    let totalFiles = 0;
    let totalSegments = 0;
    let totalWordsEdited = 0;
    let totalWords = 0;

    for (const file of MOCK_FILE_STORE) {
      if (file.deletedAt) continue;
      totalFiles++;
      const segments = file.rawTranscript?.transcript_segments || [];
      totalSegments += segments.length;
      totalWords += totalRawWords(segments);
      totalWordsEdited += (file.edits || []).length;
    }

    const editRate = totalWords === 0 ? 0 : totalWordsEdited / totalWords;
    const estimatedAccuracy = Math.max(70, (1 - editRate) * 100);

    return {
      totalFiles,
      totalSegments,
      totalWordsEdited,
      estimatedAccuracy: estimatedAccuracy.toFixed(1),
    };
  }

  try {
    const m = await fetchDashboardMetrics();
    // The service has no segment-level counter; leave totalSegments at 0 so
    // the existing UI still renders (it isn't surfaced on the dashboard today).
    // files_with_edits stands in for totalWordsEdited since the service reports
    // files touched, not individual word-edit counts.
    const accuracy =
      m.average_wer == null ? null : Math.max(0, (1 - m.average_wer) * 100);
    return {
      totalFiles: m.total_files ?? 0,
      totalSegments: 0,
      totalWordsEdited: m.files_with_edits ?? 0,
      estimatedAccuracy: accuracy == null ? '—' : accuracy.toFixed(1),
      latestWer: m.latest_wer,
      averageWer: m.average_wer,
      averageQueueLatency: m.average_queue_latency,
      averageTranscriptionTime: m.average_transcription_time,
      needsAttention: m.needs_attention,
    };
  } catch (err) {
    console.error('getDashboardStats: metrics service failed', err);
    return {
      totalFiles: 0,
      totalSegments: 0,
      totalWordsEdited: 0,
      estimatedAccuracy: '—',
    };
  }
}

export async function triggerRetraining() {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return { status: "success", message: "Model retrained successfully" };
}
