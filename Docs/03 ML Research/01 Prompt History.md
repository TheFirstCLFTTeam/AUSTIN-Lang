# prompt History

Recording what prompts were used for research

## Prompt V1

You are a highly experienced Machine learning engineer, and an expert in audio transcription models and other related models that deal with unstructured audio data. list some developments in speech to text AI models that specifically focus on the following tasks:

- multi-lingual transcription: where a recording interleaves 2 or more languages, the transcript must be able to generate a recording to fit the generated tokens(so if I speak chinese and english in the recording, they may be mixed but the transcripted document must contain both langauges and be perfectly transcribed).

- Fast Retraining: data for each annotated recording is to be stored for a macimum of 5 working days before it has to be deleted. We also need to ensure that the retraining data cannot be retraced and that PIIs are not traceable.

- Domain-specific terms: Finance terms in both languages need to be recognisable. However, I want this feature of the model modular and editable such that I can "hot swap" domains i.e. finance to healthcare and biomedical

## Prompt Refinement by Undermind

You are a highly experienced Machine learning engineer, and an expert in audio transcription models and other related models that deal with unstructured audio data. list some developments in speech to text AI models that specifically focus on the following tasks:

I want to find research on multilingual, code-switching speech-to-text models (especially Chinese–English) that (1) accurately transcribe mixed-language audio into transcripts preserving each language and providing explicit language tagging or segmentation at token or span level, (2) support fast, privacy-preserving continual retraining under a strict ≤5-day data retention regime with PII-scrubbing and non-traceable training signals, and (3) enable modular, hot-swappable domain adaptation so that domain-specific terminology (e.g., finance, healthcare, biomedical) can be added, removed, or exchanged at runtime without retraining the full base model, considering both internal adaptation methods (e.g., adapters/LoRA) and external mechanisms (e.g., domain LMs, contextual biasing)
