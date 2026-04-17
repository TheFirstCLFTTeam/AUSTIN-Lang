// Metric metadata — one entry per metric `id`. This is the descriptive side
// of a metric (what it measures, how it's implemented, its target, and when
// it was last revised). Runtime display data (latest value, sublabel,
// time-series) lives in mock_data-dashboard.js and is joined by `id` at
// lookup time.
//
// `pythonScript` is stored inline here as a text snippet. In production this
// field is expected to hold either a raw script (as in the mock) or a URL
// pointing at a script stored in the DB / object storage.
//
// `target` is the authoritative goal for the metric (units match the series'
// `unit`). `dateRevised` is an ISO-8601 date marking the last time the target
// (or other metadata) was edited — it's auto-updated whenever a control
// member saves changes, not entered manually.

export const METRICS_METADATA = [
  {
    id: "overall_accuracy",
    name: "Overall Accuracy",
    shortDescription: "Aggregate word-level accuracy across all transcripts.",
    description: "Computes 1 − WER over the full evaluation corpus, where WER is the Levenshtein edit distance between prediction and reference divided by reference word count. Used as the headline quality signal for the production model.",
    target: 97.5,
    dateRevised: "2026-03-12",
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
    target: 98.5,
    dateRevised: "2025-11-04",
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
    target: 96.0,
    dateRevised: "2026-01-22",
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
    target: 99.0,
    dateRevised: "2026-02-18",
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
    target: 94.0,
    dateRevised: "2025-10-30",
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
    target: 98.0,
    dateRevised: "2025-12-14",
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
    target: 400,
    dateRevised: "2026-02-05",
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
    target: 3.0,
    dateRevised: "2026-01-28",
    pythonScript: `def compute_throughput(request_log, window_hours=24):
    """Transcription hours processed per wall-clock hour."""
    recent = [r for r in request_log if r.completed_at > now() - hours(window_hours)]
    audio_hours = sum(r.audio_duration_s for r in recent) / 3600
    return audio_hours / window_hours
`,
  },
  {
    id: "weighted_wer",
    name: "Weighted WER",
    shortDescription: "WER weighted by information value of words.",
    description: "Weighted Word Error Rate. Applies higher weights to content words (nouns, verbs, named entities) than function words, so poor performance on critical terms is not hidden behind correctly transcribed fillers. Formula: W-WER = Σ(w_s·S + w_d·D + w_i·I) / Σ(w_n·N). Target: <5% clean audio, <12% noisy/telephony.",
    target: 5.0,
    dateRevised: "2026-04-10",
    pythonScript: `def compute_weighted_wer(predictions, references, word_weights):
    """WER weighted by information value of words."""
    weighted_errors = 0.0
    weighted_total = 0.0
    for pred, ref in zip(predictions, references):
        ops = align(pred.split(), ref.split())
        for op in ops:
            w = word_weights.get(op.word, 1.0)
            if op.kind in ("sub", "del", "ins"):
                weighted_errors += w
        for token in ref.split():
            weighted_total += word_weights.get(token, 1.0)
    return weighted_errors / weighted_total if weighted_total else 0.0
`,
  },
  {
    id: "language_cer",
    name: "Language-Agnostic CER",
    shortDescription: "Character-level error rate normalised across languages.",
    description: "Character Error Rate computed consistently across languages with different morphologies (agglutinative vs. analytic) and scripts (whitespace-separated vs. not). Avoids the WER pitfall of being undefined for languages like Mandarin, Japanese, or Thai. Formula: CER = (i_c + s_c + d_c) / n_c. Target: <3% high-resource, <8% low-resource.",
    target: 3.0,
    dateRevised: "2026-04-10",
    pythonScript: `def compute_language_cer(predictions, references):
    """Character-level error rate normalised across languages."""
    errors = 0
    chars = 0
    for pred, ref in zip(predictions, references):
        errors += edit_distance(list(pred), list(ref))
        chars += len(ref)
    return errors / chars if chars else 0.0
`,
  },
  {
    id: "code_switch_pier",
    name: "Code-Switch PIER",
    shortDescription: "WER localised to the 2 words around each language switch.",
    description: "Code-Switching Point-of-Interest Error Rate. A localised WER calculated over a ±2-word window around each language transition. Prevents standard WER from diluting switch-point failures across the whole sentence. Formula: CS-PIER = Errors_switch_window / Total_Words_switch_window. Target: <15% at switch points.",
    target: 15.0,
    dateRevised: "2026-04-10",
    pythonScript: `def compute_code_switch_pier(predictions, references, language_tags, window=2):
    """WER localised to the 2 words around each language switch."""
    errors = 0
    total = 0
    for pred, ref, tags in zip(predictions, references, language_tags):
        ref_tokens = ref.split()
        switch_indices = [i for i in range(1, len(tags)) if tags[i] != tags[i - 1]]
        covered = set()
        for idx in switch_indices:
            for j in range(max(0, idx - window), min(len(ref_tokens), idx + window)):
                covered.add(j)
        window_ref = [ref_tokens[j] for j in sorted(covered)]
        window_pred = extract_aligned(pred, ref, covered)
        errors += edit_distance(window_pred, window_ref)
        total += len(window_ref)
    return errors / total if total else 0.0
`,
  },
  {
    id: "word_diarization_error",
    name: "Word Diarization ER",
    shortDescription: "Percentage of words attributed to the wrong speaker.",
    description: "Word Diarization Error Rate. Measures attribution at the word level rather than by time blocks, so a missed 0.5s 'No' inside a 5s 'Yes' is no longer masked by a low time-based DER. Formula: WDER = (S_wrong_speaker + S_missed_speaker) / N_total_words. Target: <10% for 2-3 speakers, <18% for cocktail-party scenarios.",
    target: 10.0,
    dateRevised: "2026-04-10",
    pythonScript: `def compute_word_diarization_error(pred_word_turns, ref_word_turns):
    """Percentage of words attributed to the wrong speaker."""
    wrong = 0
    missed = 0
    total = len(ref_word_turns)
    for ref_word in ref_word_turns:
        match = find_predicted_word(pred_word_turns, ref_word)
        if match is None:
            missed += 1
        elif match.speaker != ref_word.speaker:
            wrong += 1
    return (wrong + missed) / total if total else 0.0
`,
  },
  {
    id: "entity_f1",
    name: "Entity F1 (F-NER)",
    shortDescription: "Precision/recall F1 over financial named entities.",
    description: "Entity-Level F1-Score. Treats financial terms (instruments, metrics, regulators, tickers) as a retrieval task — compares sets of entities found in reference vs. prediction rather than per-word edits. Protects the downstream NER pipeline: 'Amortization' → 'A mortisation' is a total failure, not a two-word edit. Formula: F1 = 2·(Precision·Recall)/(Precision+Recall). Target: >92% F1.",
    target: 92.0,
    dateRevised: "2026-04-10",
    pythonScript: `def compute_entity_f1(predictions, references, ner_model):
    """Precision/recall F1 over financial named entities."""
    tp, fp, fn = 0, 0, 0
    for pred, ref in zip(predictions, references):
        pred_ents = set(ner_model(pred))
        ref_ents = set(ner_model(ref))
        tp += len(pred_ents & ref_ents)
        fp += len(pred_ents - ref_ents)
        fn += len(ref_ents - pred_ents)
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    return 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
`,
  },
  {
    id: "sequence_match_rate",
    name: "Sequence Match Rate",
    shortDescription: "All-or-nothing accuracy on SWIFT/IBAN/GST-style codes.",
    description: "Binary match rate for structured alphanumeric strings (SWIFT, IBAN, GST, tickers, phone numbers). One character wrong = 0 utility, so the sequence is treated as a single unit of truth rather than letting per-character metrics paper over failures. Typically paired with a post-processing RegEx or fuzzy-match layer. Formula: SMR = Correctly_Transcribed_Sequences / Total_Expected_Sequences. Target: >98% SMR.",
    target: 98.0,
    dateRevised: "2026-04-10",
    pythonScript: `def compute_sequence_match_rate(predictions, references, sequence_patterns):
    """All-or-nothing accuracy on SWIFT/IBAN/GST-style codes."""
    matched = 0
    total = 0
    for pred, ref in zip(predictions, references):
        for pattern in sequence_patterns:
            ref_seqs = pattern.findall(ref)
            pred_seqs = pattern.findall(pred)
            for seq in ref_seqs:
                total += 1
                if seq in pred_seqs:
                    matched += 1
    return matched / total if total else 0.0
`,
  },
];
