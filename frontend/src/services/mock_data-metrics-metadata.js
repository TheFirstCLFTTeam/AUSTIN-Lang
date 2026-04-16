// Metric metadata — one entry per metric `id`. This is the descriptive side
// of a metric (what it measures, how it's implemented). Runtime display data
// (latest value, sublabel, time-series) lives in mock_data-dashboard.js and
// is joined by `id` at lookup time.
//
// `pythonScript` is stored inline here as a text snippet. In production this
// field is expected to hold either a raw script (as in the mock) or a URL
// pointing at a script stored in the DB / object storage.

export const METRICS_METADATA = [
  {
    id: "overall_accuracy",
    name: "Overall Accuracy",
    shortDescription: "Aggregate word-level accuracy across all transcripts.",
    description: "Computes 1 − WER over the full evaluation corpus, where WER is the Levenshtein edit distance between prediction and reference divided by reference word count. Used as the headline quality signal for the production model.",
    pythonScript: `def compute_overall_accuracy(predictions, references):
    """Aggregate word-level accuracy across all transcripts."""
    total_errors = 0
    total_words = 0
    for pred, ref in zip(predictions, references):
        total_errors += edit_distance(pred.split(), ref.split())
        total_words += len(ref.split())
    return 1 - (total_errors / total_words)
`,
  },
  {
    id: "english_accuracy",
    name: "English Accuracy",
    shortDescription: "Word-level accuracy on English-only transcripts.",
    description: "Same formula as overall accuracy, but restricted to transcripts tagged as English (en-US, en-GB, en-SG). Useful for tracking regression when training data is rebalanced across locales.",
    pythonScript: `def compute_english_accuracy(predictions, references, locales):
    """Word-level accuracy on English-only transcripts."""
    pairs = [(p, r) for p, r, loc in zip(predictions, references, locales) if loc.startswith("en")]
    return compute_overall_accuracy(*zip(*pairs))
`,
  },
  {
    id: "mandarin_accuracy",
    name: "Mandarin Accuracy",
    shortDescription: "Character-level accuracy on Mandarin transcripts.",
    description: "Character Error Rate (CER) inverse on Mandarin (zh-CN, zh-TW) transcripts. Character-level is used instead of word-level because Mandarin has no inter-word spacing.",
    pythonScript: `def compute_mandarin_accuracy(predictions, references, locales):
    """Character-level accuracy on Mandarin transcripts."""
    total_errors = 0
    total_chars = 0
    for p, r, loc in zip(predictions, references, locales):
        if not loc.startswith("zh"):
            continue
        total_errors += edit_distance(list(p), list(r))
        total_chars += len(r)
    return 1 - (total_errors / total_chars)
`,
  },
  {
    id: "financial_term_accuracy",
    name: "Financial Term Accuracy",
    shortDescription: "Recall on a curated glossary of financial terms.",
    description: "Measures how often terms from the internal financial glossary (≈3,200 entries: instrument names, regulatory abbreviations, metric names) are transcribed correctly when they appear in the reference. Tracked separately because these terms dominate downstream extraction quality.",
    pythonScript: `def compute_financial_term_accuracy(predictions, references, glossary):
    """Recall on a curated glossary of financial terms."""
    hits = 0
    total = 0
    for pred, ref in zip(predictions, references):
        for term in glossary:
            if term in ref:
                total += 1
                if term in pred:
                    hits += 1
    return hits / total if total else 0.0
`,
  },
  {
    id: "speaker_diarization",
    name: "Speaker Diarization",
    shortDescription: "Fraction of speaker turns assigned to the correct speaker.",
    description: "Diarization Error Rate (DER) inverse. For each reference speaker turn, counts the fraction of audio time where the predicted speaker label matches, averaged across the corpus.",
    pythonScript: `def compute_speaker_diarization(prediction_turns, reference_turns):
    """Fraction of speaker turns assigned to the correct speaker."""
    correct_duration = 0.0
    total_duration = 0.0
    for ref_turn in reference_turns:
        overlap = find_overlapping(prediction_turns, ref_turn)
        if overlap and overlap.speaker == ref_turn.speaker:
            correct_duration += overlap.duration
        total_duration += ref_turn.duration
    return correct_duration / total_duration
`,
  },
  {
    id: "punctuation_accuracy",
    name: "Punctuation Accuracy",
    shortDescription: "F1 over inserted punctuation tokens.",
    description: "Precision/recall F1 computed over punctuation tokens (period, comma, question mark, em-dash) aligned against reference. Casing is ignored. Important for downstream sentence segmentation.",
    pythonScript: `def compute_punctuation_accuracy(predictions, references):
    """F1 over inserted punctuation tokens."""
    punct = set(".,!?;:—")
    tp, fp, fn = 0, 0, 0
    for pred, ref in zip(predictions, references):
        pred_p = [c for c in pred if c in punct]
        ref_p = [c for c in ref if c in punct]
        tp += sum(1 for c in pred_p if c in ref_p)
        fp += sum(1 for c in pred_p if c not in ref_p)
        fn += sum(1 for c in ref_p if c not in pred_p)
    precision = tp / (tp + fp) if (tp + fp) else 0
    recall = tp / (tp + fn) if (tp + fn) else 0
    return 2 * precision * recall / (precision + recall) if (precision + recall) else 0
`,
  },
  {
    id: "latency_p95",
    name: "P95 Latency",
    shortDescription: "95th-percentile end-to-end transcription latency.",
    description: "End-to-end wall-clock latency from audio upload to final transcript availability, measured per request at the API edge and aggregated as the 95th percentile over a rolling 24-hour window.",
    pythonScript: `def compute_latency_p95(request_log):
    """95th-percentile end-to-end transcription latency."""
    latencies_ms = [r.completed_at_ms - r.received_at_ms for r in request_log]
    latencies_ms.sort()
    idx = int(len(latencies_ms) * 0.95)
    return latencies_ms[idx]
`,
  },
  {
    id: "throughput",
    name: "Throughput",
    shortDescription: "Transcription hours processed per wall-clock hour.",
    description: "Ratio of audio hours transcribed to wall-clock hours elapsed, averaged over the last 24 hours. Captures effective cluster throughput including queueing, preemption, and GPU availability.",
    pythonScript: `def compute_throughput(request_log, window_hours=24):
    """Transcription hours processed per wall-clock hour."""
    recent = [r for r in request_log if r.completed_at > now() - hours(window_hours)]
    audio_hours = sum(r.audio_duration_s for r in recent) / 3600
    return audio_hours / window_hours
`,
  },
];
