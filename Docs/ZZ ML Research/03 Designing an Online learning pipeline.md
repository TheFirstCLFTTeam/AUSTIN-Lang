# Re-training pipeline design: How to integrate online learning

## What is online learning

Online learning (also called **incremental learning** or **continual learning**) is a machine learning paradigm where a model is updated continuously as new data arrives, rather than being retrained from scratch on a full dataset. It contrasts with **batch (offline) learning**, where training is performed once on a static dataset.

```text
Batch Learning:       [Full Dataset] → Train once → Fixed Model
Online Learning:      [Stream of data] → Update repeatedly → Evolving Model
                          t=1   t=2   t=3  ...
```

### Core idea

At each time step $t$, the model receives a new sample (or small mini-batch) $(x_t, y_t)$, performs a gradient update, and then discards or archives the sample. The model's parameters $\theta$ are updated via:

$$\theta_{t+1} = \theta_t - \eta \nabla_\theta \mathcal{L}(f_\theta(x_t), y_t)$$

This is essentially stochastic gradient descent (SGD) applied to a stream of data rather than a shuffled static dataset.

### Batch vs. Online vs. Mini-batch

| Property | Batch (Offline) | Mini-batch | Online (Streaming) |
| --- | --- | --- | --- |
| Data required upfront | Yes | Yes | No |
| Update frequency | Once per full pass | Once per mini-batch | Once per sample/small batch |
| Memory footprint | Full dataset in memory | Moderate | Minimal |
| Convergence stability | High | Moderate | Low (noisy) |
| Adaptability to new data | Poor (requires full retrain) | Moderate | High |

---

## Why online learning matters for AUSTIN-Lang

This project has several constraints that make online learning not just convenient, but **architecturally necessary**:

### 1. The 5-working-day data deletion constraint

Per the project requirements, annotated recordings must be deleted within 5 working days. This means:

- We cannot accumulate a large labelled dataset over time for a periodic full retrain.
- Any learning from user corrections or annotations must happen within a narrow window.
- Online / incremental fine-tuning on small batches is the only viable path.

### 2. Domain adaptation (financial terminology)

The model (Whisper-based) is trained on general speech. Financial terms in both Mandarin and English (e.g. "衍生工具", "derivatives", "repo rate") are likely OOV (out-of-vocabulary) or misrecognised. Online fine-tuning on domain-specific corrections lets the model adapt to this vocabulary without a full retrain.

### 3. Code-switching adaptation

Code-switching (Mandarin-English interleaving) is a distribution shift from Whisper's training data. Online learning on local, real-world code-switching utterances lets the model continuously improve its accuracy on the specific patterns observed in production.

### 4. Privacy preservation

Because data is short-lived and cannot be retained, federated or on-device learning approaches can ensure that raw audio is never centralised — only gradient updates or model deltas are transmitted.

---

## Key challenges

### Catastrophic forgetting

The most significant problem in online learning for deep networks. When a model is fine-tuned on new data, it tends to overwrite the weights responsible for previously learned knowledge. Formally, if the model learns task $B$ after task $A$, performance on $A$ degrades:

$$\text{Forgetting}(A) = \text{Acc}(A, \text{before}) - \text{Acc}(A, \text{after training on } B)$$

This is critical for AUSTIN-Lang: fine-tuning on finance domain data should not destroy general multilingual or code-switching ability.

**Mitigations:**

- **Elastic Weight Consolidation (EWC)**: Adds a regularisation term that penalises changes to weights important for previous tasks. Uses the Fisher Information Matrix to estimate importance.
- **Experience Replay / Rehearsal**: Retain a small **memory buffer** of past samples and mix them into each new training batch. Since raw audio is deleted, a compressed representation (e.g. embeddings, spectrograms) can be retained instead.
- **Parameter-Efficient Fine-Tuning (PEFT)**: Only update a small subset of parameters (e.g. adapters, LoRA layers), leaving the pretrained backbone frozen. This naturally limits forgetting.

### The stability-plasticity dilemma

A model that updates aggressively (high plasticity) adapts quickly but forgets fast. A model that updates conservatively (high stability) retains knowledge but adapts slowly. The learning rate $\eta$ and update frequency must be tuned carefully.

### Distribution shift detection

Not all incoming data is equally informative. A mechanism to detect when the incoming data distribution has shifted significantly (e.g. a new speaker, new accent, new domain) can trigger a targeted fine-tuning cycle rather than continuous updates.

---

## Proposed pipeline architecture

```text
[User submits audio]
        │
        ▼
[ASR Model → Transcription]
        │
        ▼
[User reviews / corrects transcript]  ←── optional human-in-the-loop
        │
        ▼
[Correction stored as (audio_segment, corrected_text) pair]
        │
        ▼
[Fine-tuning job triggered]
        │  ├─ Apply LoRA / Adapter update on base model
        │  ├─ Mix in replay buffer samples (to prevent forgetting)
        │  └─ Evaluate on held-out validation set
        │
        ▼
[Updated model weights (LoRA delta only)]
        │
        ▼
[Deploy updated model] ──► [Delete raw audio after 5 working days]
```

Key architectural decisions:

- **LoRA adapters** are updated, not the full model — fast, memory-efficient, and the base Whisper weights are never touched.
- A **small replay buffer** stores compressed features (not raw audio) for EWC or rehearsal. This can satisfy the privacy constraint since raw audio is not retained.
- Fine-tuning runs are asynchronous and scheduled (e.g. nightly), not per-sample, to avoid instability from ultra-high-frequency updates.

---

## Techniques in detail

### LoRA (Low-Rank Adaptation)

Instead of updating the full weight matrix $W \in \mathbb{R}^{d \times k}$, LoRA decomposes the update as:

$$W' = W + \Delta W = W + BA$$

where $B \in \mathbb{R}^{d \times r}$ and $A \in \mathbb{R}^{r \times k}$, with rank $r \ll \min(d, k)$. Only $A$ and $B$ are trained; $W$ is frozen. This reduces trainable parameters by orders of magnitude.

For Whisper-large-v3 (~1.5B params), a LoRA rank of $r=16$ on the attention layers reduces trainable params to ~10M, making fine-tuning feasible on a single GPU or even CPU.

### Elastic Weight Consolidation (EWC)

Adds a penalty term to the loss:

$$\mathcal{L}_\text{EWC} = \mathcal{L}_\text{task} + \frac{\lambda}{2} \sum_i F_i (\theta_i - \theta^*_i)^2$$

where $F_i$ is the diagonal of the Fisher Information Matrix (importance of weight $i$), $\theta^*_i$ are the weights before the current update, and $\lambda$ controls regularisation strength.

### Rehearsal / Experience Replay

Maintain a buffer $\mathcal{M}$ of size $N$ (e.g. 500 samples). On each update batch, combine new samples with a random draw from $\mathcal{M}$:

$$\mathcal{L} = \mathcal{L}(\text{new batch}) + \mathcal{L}(\text{buffer sample})$$

For privacy compliance, the buffer can store **encoder embeddings** (latent representations) rather than raw audio, making re-identification from the buffer infeasible.

### Adapter Layers

Small bottleneck modules inserted into each Transformer block. During fine-tuning, only adapter weights are updated. The Whisper backbone is frozen entirely. Less flexible than LoRA but even simpler to implement and swap.

---

## Relevant packages

### Fine-tuning Whisper (primary use case)

| Package | Purpose | Notes |
| --- | --- | --- |
| `transformers` (HuggingFace) | Load, fine-tune, and serve Whisper models | Core library. `WhisperForConditionalGeneration` + `Seq2SeqTrainer` |
| `peft` (HuggingFace) | LoRA, IA³, Prefix Tuning, Adapters on top of HF models | Drop-in with `get_peft_model()`. Works directly on Whisper |
| `trl` (HuggingFace) | Trainer utilities, SFT (Supervised Fine-Tuning) | Cleaner API for supervised fine-tuning over `Trainer` |
| `datasets` (HuggingFace) | Streaming dataset construction from audio files | `load_dataset(..., streaming=True)` — avoids loading full dataset into RAM |
| `bitsandbytes` | 8-bit / 4-bit quantisation | Required for QLoRA (quantised LoRA) — enables fine-tuning on low-memory GPUs |
| `accelerate` (HuggingFace) | Device-agnostic training (CPU/GPU/multi-GPU) | Wraps PyTorch training loop |

**Minimal example (LoRA on Whisper):**

```python
from transformers import WhisperForConditionalGeneration, WhisperProcessor
from peft import get_peft_model, LoraConfig, TaskType

model = WhisperForConditionalGeneration.from_pretrained("openai/whisper-large-v3")

lora_config = LoraConfig(
    task_type=TaskType.SEQ_2_SEQ_LM,
    r=16,                     # rank
    lora_alpha=32,
    target_modules=["q_proj", "v_proj"],  # attention layers
    lora_dropout=0.05,
)

peft_model = get_peft_model(model, lora_config)
peft_model.print_trainable_parameters()
# trainable params: ~10M / 1.5B  (< 1%)
```

### Continual / online learning frameworks

| Package | Purpose | Notes |
| --- | --- | --- |
| `avalanche-lib` | Full continual learning framework (EWC, replay, GEM, etc.) | Research-grade. Supports PyTorch models. Strategies include `EWC`, `Replay`, `GEM`, `LwF` |
| [`river`](https://riverml.xyz/latest/) | Classical online learning for tabular / streaming data | Not suitable for deep speech models, but useful for lightweight downstream components (e.g. language model scoring, keyword detection) |
| `sequoia` | Continual learning research library (UdeM) | More experimental than Avalanche; useful for benchmarking forgetting |

**EWC with Avalanche:**

```python
from avalanche.training.supervised import EWC
from avalanche.training.plugins import EvaluationPlugin

strategy = EWC(
    model=peft_model,
    optimizer=optimizer,
    criterion=criterion,
    ewc_lambda=0.4,
    train_mb_size=8,
    eval_mb_size=8,
    device="cuda",
)
```

### Data handling and privacy

| Package | Purpose | Notes |
| --- | --- | --- |
| `librosa` | Audio loading, feature extraction (MFCCs, mel spectrograms) | Useful for extracting compressed features for the replay buffer |
| `soundfile` | Fast audio I/O | Used alongside librosa |
| `opacus` (Meta) | Differential Privacy for PyTorch | Adds DP-SGD: guarantees that individual training samples cannot be inferred from gradients — directly relevant to the PII constraint |
| `cryptography` | Encryption of stored features/embeddings | Ensure replay buffer features are encrypted at rest |

**Differential Privacy with Opacus:**

```python
from opacus import PrivacyEngine

privacy_engine = PrivacyEngine()
model, optimizer, train_loader = privacy_engine.make_private(
    module=peft_model,
    optimizer=optimizer,
    data_loader=train_loader,
    noise_multiplier=1.1,   # controls privacy budget (ε)
    max_grad_norm=1.0,
)
```

### Evaluation and monitoring

| Package | Purpose | Notes |
| --- | --- | --- |
| `evaluate` (HuggingFace) | WER (Word Error Rate), CER, BLEU | `evaluate.load("wer")` — standard ASR metric |
| `jiwer` | Fast WER/CER computation | Lightweight alternative to `evaluate` for production monitoring |
| `wandb` / `mlflow` | Experiment tracking | Track WER per fine-tuning run, detect performance regression |

---

## Summary of recommendations

1. **Use LoRA via `peft`** as the primary fine-tuning mechanism. It limits forgetting by construction (frozen backbone), has minimal memory overhead, and LoRA adapter weights are small enough to version and roll back easily.

2. **Build a compressed replay buffer** using mel spectrogram features (not raw audio) to enable rehearsal without violating the data retention policy. Encrypt at rest.

3. **Evaluate EWC** as an additional regulariser on top of LoRA, particularly when fine-tuning on financial domain data that could degrade general code-switching performance.

4. **Use `opacus`** for differential privacy during training to provide a formal privacy guarantee over the training data, in addition to the raw deletion policy.

5. **Trigger fine-tuning asynchronously** (e.g. nightly batch), not in real-time per request, to avoid unstable updates and to aggregate enough correction signal for a meaningful gradient step.

6. **Track WER** before and after each fine-tuning run on a held-out validation set. If WER regresses, roll back to the previous LoRA checkpoint.
