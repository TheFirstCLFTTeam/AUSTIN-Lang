# Research

## Task definition

Main Task: Automatic Speech Recognition (ASR)

- Take audio and transcribe it into text.

## Objectives

### GOAL01 model architecture

Distill / propose a new model for the following subtasks:

- multi-lingual transcription / code-switching
    - where a recording involves the use of multiple languages, the model must be able to transcribe the spoken languages accurately and quickly
- interleaved conversation
    - If 2 people are speaking simultaneously, the model should be able to distinguish them and split them apart
    - generate a recording to fit the generated tokens (so if I speak chinese and english in the recording, they may be mixed but the transcripted document must contain both languages and be perfectly transcribed
    - the task is formally defined as "Code-switching"

- Domain-specific terms
    - The model must be able to handle finance terms in both languages need to be recognisable.
    - ideally, this should be implemented as a model adapter that can be swapped out (and updated) as required.

### GOAL02 Retraining Pipeline

- Data restrictions 1
    - Data for each annotated recording is to be stored for a maximum of 5 working days before it has to be deleted. We also need to ensure that the retraining data cannot be retraced and that PIIs are not traceable.

- Data restrictions 2
    - model must be capable of "exact unlearning" since storing of model weights is ambiguously considered storage of private info and infringement on the right of bank clients to remain anonymous, so we need to make sure these weights can be forgotten at a moment's notice, or to use synthetic data that cannot be retraced to specific individuals.
    - follow as per 5 working day forgetting scheme, data cannot be retained after 5 days
        - alternatively, due to association, model retraining pipeline should not retain model weights associated to data after said data has "expired" i.e. retention date has exceeded.

- Synthetic data generation (stretch goal)
    - Data for each recording should be modified to sustain contiuous training since it is no longer associated with a model, to update the long-term model weights to be used.
    - ideally, we separate the information into 2 classes:
        - sementically relelvant personal information
            - i.e. x person traded stock y &#8594; censoring y will remove critical info from the recording and hinder the model's reasoning abilities
        - semantically irrelevant personal information
            - x person was involved in a car crash &#8594; censoring x won't impact the accuracy of the model

### GOAL03 Misc features for users

- There are 3 types of users:
    - commercial users / editors
    - Admin staff for permission control and monitoring
    - ML Engineers

- commercial users can review their transcripts and edit them.
- the edits are stored as diffs that are applied onto the original transcribed document.
    - these documents are never seen by the
- these edits are then used for retraining the model over time, and obtaining long-term versions of the weights for our model to be trained on.

---

## Sources

- platforms used for research can be found under [`Sources and Links.md`](Sources%20and%20Links.md).
- Prompting history for searching for papers on AI-driven research platforms can be found under [`Prompt History.md`](Prompt%20History.md).

## Existing literature

## Proposed solutions

### GOAL03 solution: Model Alternatives

- WhisperV3 (Baseline to beat)

  - Architecture feats
        - 

- Whisper Family Alternatives
    - Whisper-X
    - faster-whisper

- OWSM v3.1
    - 

- MERaLiON
    - Latest Model: MERaLiON-3-10B-preview /
    -

- Qwen3-ASR
    - [Latest Model: Qwen/Qwen3-ASR-1.7B](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)
    - 


#### Some current difficulties experienced by models

- Research analyzing the internal attention mechanisms of Transformer-based ASR models reveals that self-attention tends to "smooth" language transitions. To maximize the probability of the next token, the model often retains the internal state of the dominant language across a switch point

#### Model architecture proposals (from Perplexity)

1. Probabilistic Language-Aware Mechanisms
    -

## Retraining Task

##

## Datasets

### References

- <https://arxiv.org/abs/2403.05887>
    - Aligning Speech to Languages to Enhance Code-switching Speech Recognition
- <https://www.isca-archive.org/interspeech_2010/lyu10_interspeech.pdf>
    - SEAME: a Mandarin-English Code-switching Speech Corpus in South-East Asia

- WhisperV3
    -

- MeRALion
    - arxiv:2412.09818
    - arxiv:2501.01034
    - arxiv:2409.06635
    - arxiv:2501.08335

- Qwen3
    - arxiv: 2601.21337