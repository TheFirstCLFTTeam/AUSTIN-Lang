# Metrics to consider for the dashboard

> **Implementation status:** each metric below maps onto a `MetricStrategy` in `backend/metrics_service/strategies/` (see [`../../06 server/metrics-service-module.md`](../../06%20server/metrics-service-module.md) §4 for the strategy pattern + how to add a new one). `f1` (Entity-Level F1, §5 of this doc) is the first one shipped; the rest are one-file additions.

For a production-grade ASR system in 2026, we need a **Multi-Dimensional Signal-to-Noise** approach. Some metrics and frameworks to consider are outlined below.

## Baselines

- Word error Rate per language for a user group
    - i.e. if a user group interacts with models that handle languages like:
        - Group A = English + Tagalog
        - Group B = English + Chinese + Yeo_Chinese / Cantonese

    There should thusly be associated word error groups as per that metric

- Custom word error metrics
    - we should facilitate for ML engineers to be able to code up their own formulas of metrics to assess their model by. This should just be a python function that they can request to the control member of their user group to create. It will be as simple as having the control user create a new metric, submitting a python script with a single defined function for how the metric should be made with these requirements:
        - 2 pandas dataframes, the raw transcript and edited transcript
        - a single numpy float of up to 3 decimal places.

---

## 1. General Accuracy: Beyond the Global Average

**Metric:** **Weighted Word Error Rate (W-WER)**

- **Definition:** Measures the cost of restoring the output word sequence to the reference, but applies weights based on the "Information Value" of words (e.g., nouns and verbs weighted higher than fillers).
- **Formula:** $$W\text{-}WER = \frac{\sum (w_s \cdot S + w_d \cdot D + w_i \cdot I)}{\sum (w_n \cdot N)}$$
- **Justification:** Standard WER is "unweighted," meaning "I am buying [Company]" and "I was buying [Company]" are penalized equally. In finance, the tense or the entity is critical. W-WER ensures we don't hide poor performance on critical keywords behind a high volume of correctly transcribed "ands" and "thes."
- **Target Threshold:** $< 5\%$ for clean audio; $< 12\%$ for noisy/telephony.

---

## 2. Multilingualism: Cross-Linguistic Stability

**Metric:** **Language-Agnostic Character Error Rate (L-CER)**

- **Definition:** Measures error at the character level, normalized across languages with different morphologies (e.g., agglutinative vs. analytic).
- **Formula:** $$CER = \frac{i_c + s_c + d_c}{n_c}$$
- **Justification:** For languages like Mandarin or Japanese where "words" are not whitespace-separated, WER is problematic. CER provides a consistent ground truth across a global portfolio, ensuring the model isn't just "good at English" while failing in Thai or Arabic.
- **Target Threshold:** $< 3\%$ CER for high-resource; $< 8\%$ for low-resource.

---

## 3. Code-Switching: The "Bilingual Pivot"

**Metric:** **Code-Switching Point-of-Interest Error Rate (CS-PIER)**

- **Definition:** A localized WER calculated specifically at the "Switch Points"—the 2 words before and 2 words after a language transition.
- **Formula:** $$CS\text{-}PIER = \frac{Errors_{switch\_window}}{Total\ Words_{switch\_window}}$$
- **Justification:** Models often "drift" or hallucinate at the moment a speaker pivots (e.g., "The deal is *challa gaya*"). Standard WER dilutes this failure by averaging it over the whole sentence. CS-PIER forces the model to prove it can handle the syntactic shift.
- **Target Threshold:** $< 15\%$ at the switch points.

---

## 4. Diarization & Overlap: Who Said What?

**Metric:** **Word Diarization Error Rate (WDER)**

- **Definition:** Measures the percentage of words assigned to the wrong speaker, rather than just measuring "time" blocks.
- **Formula:** $$WDER = \frac{S_{wrong\_speaker} + S_{missed\_speaker}}{N_{total\_words}}$$
- **Justification:** Traditional Diarization Error Rate (DER) is time-based. However, if a model misses a 0.5s "No" during a 5s "Yes," the DER is low, but the semantic error is 100%. WDER aligns the diarization quality directly with the transcript's utility.
- **Target Threshold:** $< 10\%$ for 2-3 speakers; $< 18\%$ for "cocktail party" (high overlap) scenarios.

---

## 5. Financial NER: The "EBITDA" Integrity

**Metric:** **Entity-Level F1-Score (F-NER)**

- **Definition:** Treats specific financial terms (Entities) as a retrieval task, calculating the Precision and Recall of transcribed jargon.
- **Formula:** $$F1 = 2 \cdot \frac{Precision \cdot Recall}{Precision + Recall}$$
- **Justification:** If Whisper transcribes "Amortization" as "A mortisation," WER counts it as two errors, but the downstream NER system sees it as a total failure. This metric ensures that the core business data—the reason for the transcript—is intact.
- **Target Threshold:** $> 92\%$ F1 for standard finance entities.

---

## 6. Structured Alphanumerics: Code Precision

**Metric:** **Sequence Match Rate (SMR)**

- **Definition:** A binary "All-or-Nothing" metric for specific alphanumeric strings like SWIFT, GST, or IBAN codes.
- **Formula:** $$SMR = \frac{Correctly\ Transcribed\ Sequences}{Total\ Expected\ Sequences}$$
- **Justification:** For a SWIFT code, 90% accuracy is 0% utility. If one character is wrong, the wire transfer fails. Unlike WER/CER, SMR treats the sequence as a single unit of truth.
- **Target Threshold:** $> 98\%$ SMR (typically requires a post-processing RegEx or Fuzzy-Match layer).

---

### Summary Table for Stakeholder Reporting

| Dimension | Primary Metric | Focus |
| :--- | :--- | :--- |
| **General** | W-WER | Semantic weightage |
| **Multilingual** | L-CER | Character-level consistency |
| **Code-Switching** | CS-PIER | Transition stability |
| **Diarization** | WDER | Attribution accuracy |
| **Financial NER** | F1-Score | Jargon extraction |
| **Alphanumerics** | SMR | String integrity |

How would you like to proceed with the benchmarking? I can assist in setting up the **sclite** scripts for the W-WER or design a synthetic test set for the Alphanumeric SMR.
