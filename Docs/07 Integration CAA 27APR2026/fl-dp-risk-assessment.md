# Risk Assessment — Federated Learning and Differential Privacy

> Written 2026-04-27 against the `ui_enhancement` branch. Scope: the planned federated learning (FL) and differential privacy (DP) workstream described in `Docs/07 Integration/azure-deployment-requirements.md` and `Docs/ZZ ML Research/03 Designing an Online learning pipeline.md`, against the current implementation in `backend/retraining-pipeline/`.

This document exists because FL and DP are routinely sold as turnkey privacy guarantees. They are not. Both are useful tools — they raise the cost of an attack and provide bounds — but each ships with well-documented failure modes that need to be designed for explicitly. The point of this document is to be honest about what each method does and does not protect against, before the team commits to either as a compliance story.

---

## 1. Where AUSTIN-Lang sits today

| Concern | Documented intent | Implemented? |
|---|---|---|
| LoRA fine-tuning of Whisper-large-v3-turbo on edited transcripts | Yes — `Docs/ZZ ML Research/03 Designing an Online learning pipeline.md` | ✅ `backend/retraining-pipeline/train.py` runs a 50-step LoRA round with PEFT + 4-bit quantisation. |
| DP-SGD via Opacus | Yes — same doc + `pii_scrubbing.py` TODO | ❌ Not in `requirements.txt`; `pii_scrubbing.py` is a docstring + two stubs. |
| Federated learning (Flower / PySyft) | Yes — `Docs/07 Integration/azure-deployment-requirements.md` §3 lists Flower/PySyft as restricted packages to pre-bake into the ACR image. | ❌ No FL framework chosen, no FL coordinator, no client. |
| PII scrubbing on training transcripts (Presidio / spaCy NER) | Yes — `pii_scrubbing.py` plan | ❌ Stubs only. |
| Pseudonymisation of stored transcripts (gliner) | Yes — `Docs/06 server/pseudonymisation-module.md` | ✅ `backend/pseudonymization/` — operates on transcripts after upload, before any retraining ingestion. |
| Replay buffer / EWC for catastrophic-forgetting mitigation | Discussed in research doc | ❌ Not implemented — current pipeline trains adapters in isolation per round. |

**Implication for this assessment.** Most of the risks below are still avoidable because the implementation hasn't been written yet — that is the right time to surface them. Risks that are *already in the codebase* (LoRA without per-sample gradient clipping, no PII scrubbing before training-data assembly) are flagged inline.

---

## 2. Why neither method is a silver bullet

A useful framing before going in:

- **Federated learning controls *where* raw data lives.** Raw samples never leave the client. But model updates derived from those samples *do* leave — and updates leak information about the data that produced them.
- **Differential privacy controls *what* a model release reveals about individuals.** It bounds the influence any single training example can have on the released model. But the bound is statistical, not absolute, and the privacy parameter ε is an opaque dial that most stakeholders cannot interpret.

Neither addresses the other's gap on its own. FL without DP leaks per-round; DP without FL still requires the data to be centralised. Combining them helps, but introduces *its own* complications around budget composition and aggregator trust.

The rest of this document walks through the specific failure modes.

---

## 3. Federated learning — risk register

### 3.1 Gradient leakage (Deep Leakage from Gradients, iDLG, IG, etc.)

**The risk.** A 2019 line of work (Zhu et al. *Deep Leakage from Gradients*; Geiping et al. *Inverting Gradients*) showed that for many model architectures, the **raw training input can be reconstructed pixel-perfectly from a single gradient update** if batch size is small. Subsequent work (Yin et al., Boenisch et al.) extended this to larger batches and to language models — including reconstructing tokens of the original utterance.

**Why it bites Whisper specifically.** Whisper's encoder produces a dense per-frame representation. Gradients of the cross-entropy loss with respect to the encoder are highly informative about the input mel-spectrogram. A malicious aggregator (or anyone observing the wire if updates aren't transport-encrypted) can plausibly reconstruct portions of the original utterance.

**Mitigations that work, partially.**
- Per-sample gradient clipping + Gaussian noise (i.e. DP-SGD) makes inversion much harder, but only in proportion to ε.
- **Secure aggregation** (Bonawitz et al.) ensures the aggregator only sees the *sum* of updates from ≥ K clients, not individual ones — but it requires honest client cooperation and breaks down when the client pool is small or churning.
- Sending only LoRA adapter deltas (rank ≪ d) reduces information per update, but does *not* eliminate it — recent work (Wei et al. 2024) shows LoRA gradients still leak.

**Status here.** The Azure plan envisions sending model deltas to a central coordinator. No secure aggregation is mentioned. **This is a designable-around problem if planned for now; expensive to retrofit.**

### 3.2 Membership inference

**The risk.** Even without reconstructing the input, an attacker can often determine *whether a particular sample was in the training set* by comparing the model's confidence on candidate inputs (Shokri et al. 2017). For an ASR system trained on financial dialogues, this means: given a known utterance, an attacker who can query the deployed model can decide with above-chance confidence whether that utterance was in your training corpus. For UBS-class deployments where the *fact* of a client's voice being in a training set is itself sensitive, this is a real concern.

**Mitigations.** DP-SGD with reasonable ε (≤ 8) substantially reduces membership inference success. Without DP, FL provides essentially no protection here.

### 3.3 Model poisoning and backdoors

**The risk.** A single malicious client can submit crafted updates that either (a) degrade global model performance (untargeted poisoning) or (b) cause the model to misbehave on attacker-chosen inputs while behaving normally on everything else (backdoor attacks — see Bagdasaryan et al. 2020). For ASR, a backdoor could make the model insert or omit specific words when triggered by a specific acoustic pattern.

**Why it bites the AUSTIN-Lang setup specifically.** The training corpus is sourced from user-corrected transcripts. A malicious user can submit *both* the audio *and* the "correction" — i.e. supply paired (audio, label) backdoors directly through the upload + edit flow. This is true *before* FL even enters the picture; FL just amplifies it because individual clients control the gradient.

**Mitigations.**
- Robust aggregation (median, Krum, trimmed mean) instead of FedAvg — but these have utility costs and can still be defeated by coordinated attackers.
- Anomaly detection on submitted updates (norm bounds, cosine-similarity outliers).
- Provenance: tying every contributed sample to an authenticated user (which AUSTIN-Lang already does via `audit_event`), so a poisoned client can be banned and their contributions reverted.

**Status here.** No update validation is planned. The current "approve" workflow on transcripts (`/api/audio-files/[id]/approve`) is a partial mitigation because a reviewer must accept the corrected transcript before it enters the manifest — but that puts the burden on a human reviewer to spot adversarial labels, which is not a real defence at scale.

### 3.4 Sybil attacks and free-riding

**The risk.** If participation in the federation is open (or weakly authenticated), one attacker can spin up many fake clients and dominate the aggregate update — or simply submit zero-effort updates and free-ride on others' contributions, getting a copy of the global model without ever exposing real data.

**Status here.** AUSTIN-Lang's planned topology is a *single-tenant* federation across UBS sites, not an open one. Sybil risk is therefore lower — but only if client identity is enforced via Entra ID + per-site managed identities, not via shared secrets.

### 3.5 Non-IID data and convergence pathologies

**The risk.** FL works well when client data distributions are similar. They never are. AUSTIN-Lang's clients (different UBS desks, different language mixes, different financial sub-domains) will have wildly different distributions; FedAvg can fail to converge or cycle. This is a *utility* risk, not a privacy risk, but it interacts with DP because longer training (more rounds to converge) eats more privacy budget.

### 3.6 Aggregator trust

**The risk.** Without secure aggregation, the central coordinator sees every client's update in the clear. A compromised or curious coordinator is then equivalent to having centralised the raw data, modulo the gradient-inversion attack difficulty.

**Status here.** Azure ML private workspace is planned as the coordinator. This shifts the trust to Microsoft + your VNet config — defensible, but worth being explicit about in the threat model.

### 3.7 The "federated ≠ private" misconception

The most dangerous risk in this category is rhetorical, not technical: a stakeholder concludes that because data is "federated", the system is "private", and therefore PDPA / UBS red-zone obligations are met. They are not. FL is a data-locality architecture, not a privacy guarantee.

---

## 4. Differential privacy — risk register

### 4.1 The epsilon problem

**The risk.** ε (the privacy budget) is the dial that controls "how much" privacy DP gives you. There is no scientific consensus on what value is "good enough":

- ε ≤ 1: strong, hard to achieve at useful utility for deep models.
- ε ∈ [1, 10]: the academic norm; meaningful but not airtight.
- ε ∈ [10, ∞): provides *some* protection against worst-case adversaries but the bound is so loose that it tells you very little in practice. Many production "DP" deployments live here.

Reporting "we use DP" without reporting (ε, δ) and the unit of accounting (per-sample? per-user? per-day?) is meaningless. **This is the most common DP failure mode in industry — the math checks out, the story does not.**

**Action.** Whichever (ε, δ) the team picks must be (a) documented, (b) tied to a specific accounting unit (per-utterance, per-speaker, per-day), and (c) defensible against a regulator who will ask "why this number".

### 4.2 Composition eats your budget

**The risk.** Privacy loss accumulates over training steps, training rounds, and model releases. The DP-SGD per-step privacy cost composes non-trivially across the typical hundreds-of-thousands of steps in ASR training. With Opacus's RDP accountant the bound is tight, but even so, a 50-step LoRA round on Whisper-turbo with `noise_multiplier=1.1, batch_size=5, dataset_size=250` gives ε ≈ small only for *that one round*. Repeat the round daily for a month, refresh the adapter, and ε grows unless reset.

**Why it matters here.** The Azure plan describes online / continual learning with frequent adapter updates. Each update consumes budget against the same individuals' data. Without an explicit budget ledger per data subject, the system will silently exceed its declared ε within weeks.

### 4.3 Utility collapse on small datasets

**The risk.** DP-SGD's noise-to-signal ratio is brutal when the dataset is small and the model is large. Whisper-large-v3-turbo has ~800M parameters; a LoRA adapter at rank=8 has ~5M. Even with the LoRA shrinkage, hitting useful WER under DP needs orders of magnitude more data than the current pipeline produces (current `train.py` runs at `BATCH_SIZE=5, MAX_STEPS=50` — 250 samples). Expect WER to regress meaningfully when DP is turned on for the first time.

**Action.** Run a non-DP baseline and a DP run side by side from day one of the Opacus integration, and accept that the tradeoff curve will be ugly until either dataset size grows or ε is loosened.

### 4.4 DP-SGD doesn't protect mid-training observers

**The risk.** DP-SGD's guarantee is on the *released* model — the post-training weights. It does *not* protect against an attacker who sees intermediate gradients during training (e.g. a curious cloud admin reading GPU memory, or a compromised training node). For FL, this matters: each round's transmitted update is a "released model" from the participating client's perspective and must be DP-protected at the client.

This is the difference between **central DP** (noise added at the aggregator) and **local DP** (noise added at the client). Local DP gives a stronger threat model but worse utility.

### 4.5 Hyperparameters as a side channel

**The risk.** Choices like learning rate, batch size, gradient-clipping norm, and number of epochs are themselves often selected based on the private data. If those hyperparameters are released alongside the model (as is standard practice — they end up in `training_args.bin`, `trainer_state.json`, `adapter_config.json`), they leak information that is not accounted for in ε. Papernot & Steinke (2022) describe this clearly.

**Status here.** `train.py` writes `training_args.bin`, `trainer_state.json`, etc. straight into the adapter output dir. These are intended to be consumed by the inference service. **Strip or redact these from any adapter that is published outside the training enclave.**

### 4.6 Library bugs

**The risk.** Opacus is the best-maintained DP-SGD library for PyTorch, but it has had non-trivial soundness bugs in its history (e.g. the 0.x-series issues with batch memory manager, the secure_mode flag confusion). The reported ε from the accountant is only as correct as the code path it audits.

**Action.** Pin Opacus to a known-good release in `requirements.txt`, and run the test suite as part of CI for any image that bakes Opacus in. Treat upgrades as a privacy-relevant change requiring re-evaluation of ε.

### 4.7 DP protects training data, not inference inputs

**The risk.** A user-facing ASR model can be queried by anyone with API access. DP says: "the model's parameters do not reveal much about whether your utterance was in training." DP says nothing about *what the model does with your utterance at inference time*. PII in inference inputs is governed by the pseudonymisation pipeline, not DP. These two stories must not be conflated for stakeholders.

### 4.8 Group privacy

**The risk.** DP's standard guarantee is per-record. If a single user contributes many utterances (which is the default in AUSTIN-Lang — a reviewer corrects many transcripts over time), the effective ε *per user* is `k × ε_per_record` for k contributions. Without group-DP accounting (which is much harder to satisfy at useful utility), the per-user privacy budget can be exhausted quickly.

**Action.** Decide whether the unit of privacy is "per utterance" or "per user", and account accordingly. The two answers can differ by orders of magnitude in ε.

### 4.9 DP on quantised models

**The risk.** `train.py` uses 4-bit NF4 quantisation (`BitsAndBytesConfig`). DP-SGD's noise calibration assumes full-precision floating-point arithmetic. Adding Gaussian noise to gradients computed in low-precision arithmetic can break the privacy bound — the noise distribution is no longer what the accountant thinks it is. Opacus does not officially support quantised training as of the latest stable release.

**Action.** Either (a) drop quantisation when DP is on, accepting the memory cost, or (b) carry out an empirical privacy audit (e.g. `auditing-dp` techniques: train shadow models, measure membership inference success) on the quantised + DP combination before relying on the analytic ε.

---

## 5. FL + DP combined — additional risks

### 5.1 Where do you add the noise?

Local DP (client-side noise before sending) gives the strongest threat model but the worst utility. Central DP (server-side noise during aggregation) gives the best utility but trusts the server. Neither is a free choice.

### 5.2 Privacy budget across heterogeneous clients

Different clients contribute different amounts of data with different sensitivities. A naive single global ε under-protects the high-volume clients and over-protects the low-volume ones. Per-client privacy accounting is the correct answer but is rarely implemented.

### 5.3 Secure aggregation has a cost

It assumes a minimum number of clients per round and breaks if too many drop out. With small federations (a handful of UBS sites), this can mean the aggregator either waits for stragglers (latency) or aggregates fewer updates (privacy loss).

---

## 6. Project-specific risks (mapped to current code)

| # | Risk | Where in repo | Severity | Likelihood (today) |
|---|---|---|---|---|
| P1 | Opacus listed in design docs but absent from `requirements.txt` — first cloud build will pull a different version than dev | `backend/retraining-pipeline/requirements.txt` | High | High |
| P2 | LoRA training in `train.py` runs without per-sample gradient clipping; any accidental "we have DP" claim today is false | `backend/retraining-pipeline/train.py` | High | Medium (claim hasn't been made yet) |
| P3 | 4-bit NF4 quantisation + future DP-SGD = un-audited privacy bound (see §4.9) | `train.py` lines 117-122 | High | High once Opacus lands |
| P4 | `pii_scrubbing.py` is a stub — training data is currently raw edited transcripts, no Presidio/spaCy redaction | `backend/retraining-pipeline/pii_scrubbing.py` | Critical | Already realised |
| P5 | Adapter output dir contains `training_args.bin`, `trainer_state.json` — hyperparameter side channel if published | `train.py` `OUTPUT_DIR` writes | Medium | High once adapters are exported |
| P6 | Manifests built from user-corrected transcripts with no provenance check; backdoor injection is possible via the upload+edit flow | `dataset_builder.py` (WIP) → `train.py` | High | Medium |
| P7 | No FL framework chosen — Flower, NVFlare, and PySyft each have different threat models, secure-aggregation support, and client-trust assumptions | `Docs/07 Integration/azure-deployment-requirements.md` §3 | Medium | High once the FL workstream begins |
| P8 | Voice biometrics in raw audio bypass transcript-only pseudonymisation — DP on transcripts ≠ DP on audio | `backend/pseudonymization/` operates on text spans only | Medium | High |
| P9 | LoRA adapters (`*.safetensors`) themselves are PII per the Azure plan, but `compose.yaml` mounts the adapter dir to the inference container as a plain volume | `compose.yaml` lines 36-39 | Medium | Medium |
| P10 | No per-user / per-utterance privacy ledger — composition over rounds will silently exceed declared ε (§4.2) | (not yet built) | High | High once continual training starts |
| P11 | The `audit_event` log captures *who* contributed *what*, which is good for poisoning forensics but is itself a privacy risk if the log is leaked | `frontend/src/server/audit.js` → `platform.db.audit_event` | Low | Low |
| P12 | "Federated learning" appears in the Azure plan as a compliance bullet — risk that stakeholders treat its presence as proof of privacy (§3.7) | `Docs/07 Integration/azure-deployment-requirements.md` | Medium | Already realised |

Severity = blast radius if the risk fires. Likelihood = chance of it firing within 6 months of go-live given current trajectory.

---

## 7. What "good" looks like for AUSTIN-Lang

The list of things that would let this project credibly say "we use FL and DP responsibly":

1. **Pin Opacus** at a known-good version in `requirements.txt`, before any cloud image bakes it in (P1).
2. **Replace `pii_scrubbing.py` stubs** with a real Presidio + audio-redaction pipeline that runs *before* manifests are built (P4). DP on top of un-scrubbed PII is theatre.
3. **Decide and document (ε, δ, accounting unit)** *before* turning Opacus on (§4.1, P10). Write the answer into the model card emitted alongside every adapter.
4. **Build a per-user privacy budget ledger** that decrements on each training round and refuses to ingest the user's data when the budget is exhausted (§4.2, P10).
5. **Drop 4-bit quantisation when DP is on**, or commission an empirical privacy audit on the quantised pipeline (§4.9, P3).
6. **Strip hyperparameter artifacts** (`training_args.bin`, `trainer_state.json`) from any adapter that crosses the red-zone / green-zone boundary (§4.5, P5).
7. **Pick an FL framework with secure aggregation built in** (Flower's `SecAgg+`, NVFlare's homomorphic option) and require a minimum client count per round (§3.1, §5.3, P7).
8. **Add update-norm clipping and anomaly detection** at the aggregator before any client update is averaged in (§3.3, P6).
9. **Keep the audit trail**, but encrypt it at rest with a separately-managed key and restrict read access (§3.3, P11).
10. **Write a stakeholder-facing one-pager** that says, in plain English, what FL and DP do *not* protect against (§3.7, P12). The biggest risk in this whole document is not technical — it is the perception that FL+DP is a complete privacy story.

---

## 8. References

The risks above are drawn from the following lines of work. Not exhaustive; chosen for relevance.

- Zhu, Liu, Han (2019). *Deep Leakage from Gradients.* NeurIPS.
- Geiping et al. (2020). *Inverting Gradients — How easy is it to break privacy in federated learning?* NeurIPS.
- Boenisch et al. (2023). *When the Curious Abandon Honesty: Federated Learning Is Not Private.* IEEE S&P.
- Wei et al. (2024). *LoRA Leaks: Gradient Leakage Attacks on LoRA Fine-tuning.*
- Shokri et al. (2017). *Membership Inference Attacks against Machine Learning Models.* IEEE S&P.
- Bagdasaryan et al. (2020). *How To Backdoor Federated Learning.* AISTATS.
- Bonawitz et al. (2017). *Practical Secure Aggregation for Privacy-Preserving Machine Learning.* CCS.
- Abadi et al. (2016). *Deep Learning with Differential Privacy.* CCS. (DP-SGD foundational paper.)
- Papernot & Steinke (2022). *Hyperparameter Tuning with Renyi Differential Privacy.* ICLR.
- Carlini et al. (2021). *Extracting Training Data from Large Language Models.* USENIX Security.
- Jagielski et al. (2020). *Auditing Differentially Private Machine Learning: How Private is Private SGD?* NeurIPS.
- Kairouz et al. (2021). *Advances and Open Problems in Federated Learning.* (Survey, comprehensive.)
- Opacus documentation, release notes, and known-issue tracker — particularly relevant for §4.6.

---

## 9. One-paragraph summary for non-technical readers

Federated learning keeps raw audio on each user's device, but the model updates that leave the device still leak information about the audio — sometimes enough to reconstruct it. Differential privacy bounds how much any single user's data can influence the trained model, but the bound is a knob with no objectively "safe" setting, the budget runs out the more the model is updated, and the bound silently breaks if any of the many implementation assumptions (full precision, no hyperparameter tuning on private data, no quantisation, correct library version) aren't met. Combining the two helps, but it is a designed system that needs explicit choices about where noise is added, how the budget is accounted, and how clients are authenticated — not a checkbox. AUSTIN-Lang's current pipeline has neither FL nor DP wired in; that is the right time to design these in properly, rather than retrofit them after the fact.
