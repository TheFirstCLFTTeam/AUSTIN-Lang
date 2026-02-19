# Research

Task: Improve whisperV3 for the two subtasks:

- multi-lingual transcription / code-switching: where a recording interleaves 2 or more languages, the transcript must be able to generate a recording to fit the generated tokens(so if I speak chinese and english in the recording, they may be mixed but the transcripted document must contain both langauges and be perfectly transcribed
    - the task is formally defined as "Code-switching"

- Fast Retraining: data for each annotated recording is to be stored for a macimum of 5 working days before it has to be deleted. We also need to ensure that the retraining data cannot be retraced and that PIIs are not traceable.

- Domain-specific terms: Finance terms in both languages need to be recognisable.

## Sources

- [Gemini](https://gemini.google.com/share/e539690391bc)
- [Perplexity](https://www.perplexity.ai/search/you-are-a-highly-experienced-m-AYamp0oiRHqON3kBuSPkdA#0)
- [Undermind](https://app.undermind.ai/report/5f3e6d134857867d670c4be244446cf05dd23789192882546fd1840d1912edf9)
- [Consensus](https://consensus.app/search/multilingual-code-switching-speech-recognition/6bs6AhdGRI2CLee7VR1irA/?utm_source=share&utm_medium=clipboard)
- [Scite](https://scite-ai.libproxy.smu.edu.sg/assistant/shared/06d74462d74e4befaa858f69f4b42d4f)
- Bohrium (see other doc)

## Prompting History for searching for papers

#### Prompt V1

You are a highly experienced Machine learning engineer, and an expert in audio transcription models and other related models that deal with unstructured audio data. list some developments in speech to text AI models that specifically focus on the following tasks:

- multi-lingual transcription: where a recording interleaves 2 or more languages, the transcript must be able to generate a recording to fit the generated tokens(so if I speak chinese and english in the recording, they may be mixed but the transcripted document must contain both langauges and be perfectly transcribed).

- Fast Retraining: data for each annotated recording is to be stored for a macimum of 5 working days before it has to be deleted. We also need to ensure that the retraining data cannot be retraced and that PIIs are not traceable.

- Domain-specific terms: Finance terms in both languages need to be recognisable. However, I want this feature of the model modular and editable such that I can "hot swap" domains i.e. finance to healthcare and biomedical

#### After Prompt Refinement by Undermind

You are a highly experienced Machine learning engineer, and an expert in audio transcription models and other related models that deal with unstructured audio data. list some developments in speech to text AI models that specifically focus on the following tasks:

I want to find research on multilingual, code-switching speech-to-text models (especially Chinese–English) that (1) accurately transcribe mixed-language audio into transcripts preserving each language and providing explicit language tagging or segmentation at token or span level, (2) support fast, privacy-preserving continual retraining under a strict ≤5-day data retention regime with PII-scrubbing and non-traceable training signals, and (3) enable modular, hot-swappable domain adaptation so that domain-specific terminology (e.g., finance, healthcare, biomedical) can be added, removed, or exchanged at runtime without retraining the full base model, considering both internal adaptation methods (e.g., adapters/LoRA) and external mechanisms (e.g., domain LMs, contextual biasing)

## Existing literature

### Initial set

- <https://arxiv.org/abs/2403.05887>
    - Aligning Speech to Languages to Enhance Code-switching Speech Recognition
- <https://www.isca-archive.org/interspeech_2010/lyu10_interspeech.pdf>
    - SEAME: a Mandarin-English Code-switching Speech Corpus in South-East Asia

### Week 2

#### Some current difficulties experienced by models

- Research analyzing the internal attention mechanisms of Transformer-based ASR models reveals that self-attention tends to "smooth" language transitions. To maximize the probability of the next token, the model often retains the internal state of the dominant language across a switch point

#### Model architecture proposals (from Perplexity)

1. Probabilistic Language-Aware Mechanisms
    -
