import { MOCK_FILE_STORE } from "./mock-data";
import { totalRawWords } from "../lib/transcriptEdits";

// Aggregate stats across the corpus. Edit count = sum of `edits.length` across
// files. Estimated accuracy is derived from total edits relative to total
// raw words (1 - edit-rate, floored at 70%).
export async function getDashboardStats() {
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

export async function triggerRetraining() {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return { status: "success", message: "Model retrained successfully" };
}
