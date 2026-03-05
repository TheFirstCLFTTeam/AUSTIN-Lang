# Research

## Task definition

Main Task: Automatic Speech Recognition (ASR)

- Take audio and transcribe it into text.

## Objectives

### 01 model architecture

Distill / propose a new model for the following subtasks:

- multi-lingual transcription / code-switching
    - where a recording involves the use of multiple languages, the model must be able to transcribe the spoken languages accurately and quickly
- interleaved conversation
    - If 2 people are speaking simultaneously, the model should be able to distinguish them and split them apart
    - generate a recording to fit the generated tokens (so if I speak chinese and english in the recording, they may be mixed but the transcripted document must contain both langauges and be perfectly transcribed
    - the task is formally defined as "Code-switching"

- Domain-specific terms
    - The model must be able to handle finance terms in both languages need to be recognisable.

### Retraining Pipeline

- Data restrictions
    - Data for each annotated recording is to be stored for a macimum of 5 working days before it has to be deleted. We also need to ensure that the retraining data cannot be retraced and that PIIs are not traceable.

### Misc features for users

---

## Sources

- platforms used for research can be found under [`Sources and Links.md`](Sources%20and%20Links.md).
- Prompting history for searching for papers on AI-driven research platforms can be found under [`Prompt History.md`](Prompt%20History.md).

## Existing literature

### Model Alternatives

- WhisperV3 (Baseline to beat)
    -

- Whisper Family Alternatives
    - Whisper-X
    - faster-whisper

- MERaLiON
    - Latest Model: MERaLiON-3-10B-preview

### References

- <https://arxiv.org/abs/2403.05887>
    - Aligning Speech to Languages to Enhance Code-switching Speech Recognition
- <https://www.isca-archive.org/interspeech_2010/lyu10_interspeech.pdf>
    - SEAME: a Mandarin-English Code-switching Speech Corpus in South-East Asia

#### Some current difficulties experienced by models

- Research analyzing the internal attention mechanisms of Transformer-based ASR models reveals that self-attention tends to "smooth" language transitions. To maximize the probability of the next token, the model often retains the internal state of the dominant language across a switch point

#### Model architecture proposals (from Perplexity)

1. Probabilistic Language-Aware Mechanisms
    -

## Retraining Task

##

## Datasets
