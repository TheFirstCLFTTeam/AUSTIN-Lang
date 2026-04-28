"""Architecture-fingerprint algorithm — slice B prep for #4 (training-
job-pipeline.md §4.3).

The reference implementation in the doc takes a live torch `model` +
HF config dict + optional adapter config. The orchestrator container
should not pull torch + transformers (~3 GB) just to compute a
fingerprint, so this module factors the algorithm into a pure function
that takes a pre-extracted iterable of `(name, shape_tuple, dtype_str)`
triples instead of `model.named_parameters()`.

A future companion service (`fingerprint-service` container, or an
in-orchestrator subprocess that shells out to a uv-managed torch
environment) is responsible for opening the safetensors / .bin file
and producing the triples. This module then computes the hashes —
fast, pure, deterministic, and easy to test against canned input.

The algorithm is identical to §4.3's reference; the only deviation is
that `model.named_parameters()` is the caller's job, not ours.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Iterable, Mapping, Optional, Sequence, Tuple


# Stable config keys. The doc's allow-list verbatim. Anything missing
# from the source config silently drops out of the hash; anything
# present but not on this list silently doesn't enter it.
CONFIG_ALLOWLIST = frozenset({
    "model_type", "architectures",
    "hidden_size", "intermediate_size",
    "num_hidden_layers", "num_attention_heads", "num_key_value_heads",
    "vocab_size", "max_position_embeddings",
    "tie_word_embeddings", "is_encoder_decoder",
    "d_model", "encoder_layers", "decoder_layers",
    "encoder_attention_heads", "decoder_attention_heads",
    "encoder_ffn_dim", "decoder_ffn_dim",
    "num_mel_bins", "max_source_positions", "max_target_positions",
    "scale_embedding", "activation_function",
    "bos_token_id", "eos_token_id", "pad_token_id", "decoder_start_token_id",
    "rope_scaling", "rope_theta",
})

ADAPTER_ALLOWLIST = frozenset({
    "peft_type", "r", "lora_alpha", "target_modules",
    "modules_to_save", "bias", "task_type",
})


def _canon(obj: Any) -> str:
    """Deterministic JSON encoding — sorted keys, no whitespace, str() for
    anything that's not natively JSON-able. Identical formatting to the
    reference algorithm so the fingerprint matches what a torch-side
    implementation would produce given the same inputs."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _norm_dtype(dt: str) -> str:
    """Collapses precision-only differences so mixed-precision training
    doesn't masquerade as architectural drift. Quantization keeps a
    distinct bucket because a quantized model *does* differ at the
    weight level — that's what `weight_fp` is for. The returned tag is
    also the one the doc uses, for round-trip stability."""
    dt = str(dt).lower()
    if any(k in dt for k in ("float32", "float16", "bfloat16", "float64")):
        return "float"
    if any(k in dt for k in ("int8", "uint8", "int4", "fp8")):
        return "quantized"
    return dt


def fingerprint(
    config: Mapping[str, Any],
    parameters: Iterable[Tuple[str, Sequence[int], str]],
    adapter_config: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Compute the two-layer fingerprint.

    Inputs:
        config: HuggingFace `model.config.to_dict()` output (or any
            dict-like). Only keys in CONFIG_ALLOWLIST are hashed.
        parameters: iterable of (name, shape, dtype_str). Will be sorted
            internally, so caller order doesn't matter. `shape` can be
            any sequence of ints (tuple, list, torch.Size — they all
            serialise identically through _canon).
        adapter_config: optional `adapter_config.json` contents. When
            provided, the result includes `adapter_fp` and the kind
            promotes from `base` to `adapter` or `candidate_base`.

    Returns: dict with keys
        arch_fp:    sha256 of the allow-listed config (architecture)
        weight_fp:  sha256 of normalised parameter triples (precision-
                    insensitive, quantization-sensitive)
        kind:       'base' | 'adapter' | 'candidate_base'
        adapter_fp: sha256 of (arch_fp + allow-listed adapter config) if
                    adapter_config is provided
        promotion_reason: present only when kind == 'candidate_base';
                    cites which non-norm modules forced the promotion

    The function is deterministic — same inputs always produce the same
    hashes — and side-effect-free.
    """
    cfg = {k: config[k] for k in CONFIG_ALLOWLIST if k in config}
    if isinstance(cfg.get("architectures"), list):
        cfg["architectures"] = sorted(cfg["architectures"])
    arch_fp = hashlib.sha256(_canon(cfg).encode()).hexdigest()

    wt_items = sorted(
        (name, tuple(int(x) for x in shape), _norm_dtype(dtype))
        for (name, shape, dtype) in parameters
    )
    weight_fp = hashlib.sha256(_canon(wt_items).encode()).hexdigest()

    out: Dict[str, Any] = {
        "arch_fp": arch_fp,
        "weight_fp": weight_fp,
        "kind": "base",
    }

    if adapter_config is not None:
        a = {k: adapter_config[k] for k in ADAPTER_ALLOWLIST if k in adapter_config}
        for key in ("target_modules", "modules_to_save"):
            if isinstance(a.get(key), list):
                a[key] = sorted(a[key])
        out["adapter_fp"] = hashlib.sha256(
            (arch_fp + _canon(a)).encode()
        ).hexdigest()
        out["kind"] = "adapter"
        # Adapter promotion rule. PEFT marks layers it persists in
        # `modules_to_save`; LayerNorm / RMSNorm being saved is
        # benign (PEFT 0.15+ default for some configs), but anything
        # else means the fine-tune has structurally extended the
        # base — flag for human review (training-job-pipeline.md
        # §4.3 promotion-rule matrix, row 3).
        non_norm = [
            m for m in (a.get("modules_to_save") or [])
            if "norm" not in m.lower() and "ln" not in m.lower()
        ]
        if non_norm:
            out["kind"] = "candidate_base"
            out["promotion_reason"] = f"modules_to_save adds: {non_norm}"

    return out


def classify_promotion(
    *,
    parent: Mapping[str, Any],
    candidate: Mapping[str, Any],
) -> Dict[str, Any]:
    """Apply the promotion-rule matrix to a parent + candidate fingerprint.

    `parent` is the fingerprint of the base model the job started from
    (read from `base_model.architecture_fingerprint` via the registry
    if it's been computed once before, else the torch caller computes
    it on the fly from the loaded checkpoint). `candidate` is the just-
    computed fingerprint of the worker's artifact.

    Returns: dict with
        outcome: 'duplicate' | 'adapter_or_finetune' | 'candidate_base'
                 | 'new_base'
        kind:    artifact-kind tag for `training_artifact.kind`
        reason:  human-readable hint surfaced on the detail page

    Same-arch + same-weights = duplicate publish (409 by the time it
    reaches the API layer). Same-arch + different-weights = the regular
    fine-tune / adapter path. Different arch = new derived base owned
    by the submitter. Candidate-base from non-norm modules_to_save
    short-circuits both regardless of weight diff.
    """
    if candidate.get("kind") == "candidate_base":
        return {
            "outcome": "candidate_base",
            "kind": "candidate_base",
            "reason": candidate.get("promotion_reason", "non-norm modules_to_save"),
        }
    if parent.get("arch_fp") != candidate.get("arch_fp"):
        return {
            "outcome": "new_base",
            "kind": "base_model",
            "reason": "architecture fingerprint differs from parent",
        }
    if parent.get("weight_fp") == candidate.get("weight_fp"):
        return {
            "outcome": "duplicate",
            "kind": "checkpoint",
            "reason": "identical architecture and weights as parent",
        }
    # arch matches, weights differ — the common path.
    return {
        "outcome": "adapter_or_finetune",
        "kind": "adapter" if candidate.get("adapter_fp") else "checkpoint",
        "reason": "weights differ from parent within same architecture",
    }
