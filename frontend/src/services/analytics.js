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
  const files = await fetchSubmittedFiles();

  let totalFiles = files.length;
  let totalSegments = 0;
  let totalWordsEdited = 0;

  files.forEach((file) => {
    if (!file.transcriptSegments) return;

    totalSegments += file.transcriptSegments.length;

    file.transcriptSegments.forEach((seg) => {
      if (seg.originalText) {
        totalWordsEdited += wordDifference(
          [seg.originalText],
          [seg.text]
        );
      }
    });
  });

  const estimatedAccuracy =
    totalSegments === 0
      ? 100
      : Math.max(
          70,
          100 - totalWordsEdited / totalSegments
        );

  return {
    totalFiles,
    totalSegments,
    totalWordsEdited,
    estimatedAccuracy: estimatedAccuracy.toFixed(1)
  };
}