"""Tests for the base-model + training-artifact registry (slice A of #4)
and the pure-Python fingerprint algorithm (slice B prep).

Storage:  seed idempotency, list filters, register_derived FK check,
          find_by_hf_id, artifact record + list.
HTTP:     GET /base-models default vendor list, family filter, owner
          filter with/without vendor, /base-models/{id} 404, /jobs/{id}/
          artifacts 404 + empty list shape.
Algorithm: arch_fp determinism, allow-list filtering, dtype collapse to
          float vs quantized, adapter detection (LoRA → adapter; LM-head
          modules_to_save → candidate_base), classify_promotion matrix.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fingerprint import (  # noqa: E402
    ADAPTER_ALLOWLIST,
    CONFIG_ALLOWLIST,
    classify_promotion,
    fingerprint,
)
from registry import (  # noqa: E402
    VENDOR_SEEDS,
    ArtifactStore,
    BaseModelStore,
    RegistryError,
)
from storage import JobStore  # noqa: E402


# ---------------------------------------------------------------------------
# Storage — BaseModelStore
# ---------------------------------------------------------------------------

@pytest.fixture()
def fresh_db(tmp_path):
    db = tmp_path / "training.db"
    JobStore(db_path=str(db))  # init schema
    return str(db)


def test_seed_vendors_inserts_all_seeds_on_first_call(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    inserted = bm.seed_vendors()
    assert inserted == len(VENDOR_SEEDS)
    rows = bm.list()
    assert len(rows) == len(VENDOR_SEEDS)
    families = {r.family for r in rows}
    assert "whisper" in families
    assert "meralion" in families


def test_seed_vendors_is_idempotent(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    bm.seed_vendors()
    again = bm.seed_vendors()
    assert again == 0
    assert len(bm.list()) == len(VENDOR_SEEDS)


def test_seed_vendors_backfills_missing_id(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    # First seed only the first two; on the next call the rest backfill.
    bm.seed_vendors(seeds=VENDOR_SEEDS[:2])
    backfilled = bm.seed_vendors()
    assert backfilled == len(VENDOR_SEEDS) - 2


def test_get_returns_seeded_record(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    bm.seed_vendors()
    rec = bm.get("bm_whisper_large_v3_turbo")
    assert rec is not None
    assert rec.display_name == "Whisper Large-v3"
    assert rec.hf_id == "openai/whisper-large-v3-turbo"
    assert rec.owner_user_id is None  # vendor


def test_get_unknown_returns_none(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    assert bm.get("bm_does_not_exist") is None


def test_find_by_hf_id(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    bm.seed_vendors()
    rec = bm.find_by_hf_id("openai/whisper-large-v3-turbo")
    assert rec is not None
    assert rec.id == "bm_whisper_large_v3_turbo"


def test_list_filter_by_family(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    bm.seed_vendors()
    whisper_only = bm.list(family="whisper")
    assert all(r.family == "whisper" for r in whisper_only)
    assert len(whisper_only) == 2  # Large-v3 + Tiny


def test_register_derived_with_known_parent(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    bm.seed_vendors()
    derived = bm.register_derived(
        family="whisper",
        display_name="whisper-fin-q2 (derived)",
        owner_user_id="u2",
        parent_base_model_id="bm_whisper_large_v3_turbo",
        architecture_fingerprint="a" * 64,
        weights_uri="/blob/derived/u2/whisper-fin-q2.safetensors",
    )
    assert derived.id.startswith("bm_derived_")
    assert derived.owner_user_id == "u2"
    assert derived.parent_base_model_id == "bm_whisper_large_v3_turbo"
    assert derived.hf_id is None


def test_register_derived_rejects_unknown_parent(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    bm.seed_vendors()
    with pytest.raises(RegistryError) as exc:
        bm.register_derived(
            family="whisper",
            display_name="orphan",
            owner_user_id="u2",
            parent_base_model_id="bm_does_not_exist",
            architecture_fingerprint="a" * 64,
            weights_uri="/blob/x.safetensors",
        )
    assert exc.value.status_code == 404


def test_register_derived_requires_owner(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    bm.seed_vendors()
    with pytest.raises(RegistryError):
        bm.register_derived(
            family="whisper",
            display_name="orphan",
            owner_user_id="",
            parent_base_model_id="bm_whisper_large_v3_turbo",
            architecture_fingerprint="a" * 64,
            weights_uri="/blob/x.safetensors",
        )


def test_list_owner_filter_includes_vendor_by_default(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    bm.seed_vendors()
    bm.register_derived(
        family="whisper",
        display_name="u2's derived",
        owner_user_id="u2",
        parent_base_model_id="bm_whisper_large_v3_turbo",
        architecture_fingerprint="a" * 64,
        weights_uri="/blob/u2.safetensors",
    )
    visible = bm.list(owner_user_id="u2")
    # Vendor entries + u2's row.
    assert any(r.owner_user_id == "u2" for r in visible)
    assert any(r.owner_user_id is None for r in visible)


def test_list_owner_filter_excludes_vendor_when_asked(fresh_db):
    bm = BaseModelStore(db_path=fresh_db)
    bm.seed_vendors()
    bm.register_derived(
        family="whisper",
        display_name="u2's derived",
        owner_user_id="u2",
        parent_base_model_id="bm_whisper_large_v3_turbo",
        architecture_fingerprint="a" * 64,
        weights_uri="/blob/u2.safetensors",
    )
    visible = bm.list(owner_user_id="u2", include_vendor=False)
    assert all(r.owner_user_id == "u2" for r in visible)


# ---------------------------------------------------------------------------
# Storage — ArtifactStore
# ---------------------------------------------------------------------------

def _submit_job(db_path):
    js = JobStore(db_path=db_path)
    return js.submit(
        name="whisper-fin",
        submitted_by="u2",
        target="cloud",
        base_model="openai/whisper-large-v3-turbo",
        dataset_ref="u2@example.com/x",
    )


def test_artifact_store_record_and_get(fresh_db):
    job = _submit_job(fresh_db)
    art = ArtifactStore(db_path=fresh_db).record(
        job_id=job.id,
        kind="adapter",
        uri=f"/blob/adapters/{job.id}/adapter_model.safetensors",
        sha256="b" * 64,
        size_bytes=12345,
        arch_fp="a" * 64,
        adapter_fp="c" * 64,
    )
    assert art.id.startswith("art_")
    assert art.kind == "adapter"
    fetched = ArtifactStore(db_path=fresh_db).get(art.id)
    assert fetched is not None
    assert fetched.sha256 == "b" * 64


def test_artifact_store_rejects_invalid_kind(fresh_db):
    job = _submit_job(fresh_db)
    with pytest.raises(RegistryError):
        ArtifactStore(db_path=fresh_db).record(
            job_id=job.id,
            kind="dance",
            uri="/blob/x",
            sha256="a" * 64,
            size_bytes=10,
        )


def test_artifact_list_for_job(fresh_db):
    job = _submit_job(fresh_db)
    other = _submit_job(fresh_db)
    arts = ArtifactStore(db_path=fresh_db)
    arts.record(job_id=job.id, kind="adapter", uri="/x", sha256="a" * 64, size_bytes=1)
    arts.record(job_id=job.id, kind="checkpoint", uri="/y", sha256="b" * 64, size_bytes=2)
    arts.record(job_id=other.id, kind="adapter", uri="/z", sha256="c" * 64, size_bytes=3)
    rows = arts.list_for_job(job.id)
    assert len(rows) == 2
    assert {r.kind for r in rows} == {"adapter", "checkpoint"}


# ---------------------------------------------------------------------------
# Algorithm — fingerprint()
# ---------------------------------------------------------------------------

def _whisper_config():
    return {
        "model_type": "whisper",
        "architectures": ["WhisperForConditionalGeneration"],
        "d_model": 1280,
        "encoder_layers": 32,
        "decoder_layers": 32,
        "encoder_attention_heads": 20,
        "decoder_attention_heads": 20,
        "encoder_ffn_dim": 5120,
        "decoder_ffn_dim": 5120,
        "vocab_size": 51866,
        "max_source_positions": 1500,
        "num_mel_bins": 128,
        "is_encoder_decoder": True,
        # These keys are excluded by the allow-list.
        "transformers_version": "4.46.0",
        "torch_dtype": "float16",
        "_name_or_path": "openai/whisper-large-v3-turbo",
        "task_specific_params": {"forced_decoder_ids": [[1, 50259]]},
    }


def _fake_params():
    return [
        ("encoder.embed_positions.weight", (1500, 1280), "torch.float16"),
        ("encoder.layers.0.self_attn.q_proj.weight", (1280, 1280), "torch.float16"),
        ("encoder.layers.0.self_attn.k_proj.weight", (1280, 1280), "torch.float16"),
    ]


def test_fingerprint_is_deterministic():
    fp1 = fingerprint(_whisper_config(), _fake_params())
    fp2 = fingerprint(_whisper_config(), _fake_params())
    assert fp1 == fp2


def test_fingerprint_excludes_runtime_keys():
    base = _whisper_config()
    drift = dict(base)
    # Runtime concerns that the algorithm must ignore.
    drift["transformers_version"] = "9.99.0"
    drift["torch_dtype"] = "bfloat16"
    drift["_name_or_path"] = "/somewhere/else"
    drift["task_specific_params"] = {"forced_decoder_ids": []}
    a = fingerprint(base, _fake_params())
    b = fingerprint(drift, _fake_params())
    assert a["arch_fp"] == b["arch_fp"]


def test_fingerprint_responds_to_real_arch_diff():
    a = fingerprint(_whisper_config(), _fake_params())
    diff = dict(_whisper_config())
    diff["d_model"] = 1024  # genuine architecture change
    b = fingerprint(diff, _fake_params())
    assert a["arch_fp"] != b["arch_fp"]


def test_fingerprint_dtype_collapses_float_precision():
    # float16 ↔ bfloat16 ↔ float32 should hash identically.
    p_f16 = [("w", (4, 4), "torch.float16")]
    p_bf16 = [("w", (4, 4), "torch.bfloat16")]
    p_f32 = [("w", (4, 4), "torch.float32")]
    a = fingerprint(_whisper_config(), p_f16)
    b = fingerprint(_whisper_config(), p_bf16)
    c = fingerprint(_whisper_config(), p_f32)
    assert a["weight_fp"] == b["weight_fp"] == c["weight_fp"]


def test_fingerprint_dtype_isolates_quantization():
    # int8 must produce a different weight_fp than the float bucket.
    p_float = [("w", (4, 4), "torch.float16")]
    p_int8 = [("w", (4, 4), "torch.int8")]
    a = fingerprint(_whisper_config(), p_float)
    q = fingerprint(_whisper_config(), p_int8)
    assert a["weight_fp"] != q["weight_fp"]


def test_fingerprint_param_order_independent():
    a = fingerprint(_whisper_config(), _fake_params())
    b = fingerprint(_whisper_config(), list(reversed(_fake_params())))
    assert a["weight_fp"] == b["weight_fp"]


def test_fingerprint_lora_adapter_kind():
    cfg = _whisper_config()
    adapter = {
        "peft_type": "LORA",
        "r": 16,
        "lora_alpha": 32,
        "target_modules": ["k_proj", "q_proj", "v_proj"],
        "modules_to_save": [],
        "bias": "none",
        "task_type": "FEATURE_EXTRACTION",
    }
    fp = fingerprint(cfg, _fake_params(), adapter_config=adapter)
    assert fp["kind"] == "adapter"
    assert "adapter_fp" in fp
    assert "promotion_reason" not in fp


def test_fingerprint_layer_norm_modules_to_save_stays_adapter():
    # PEFT default for some configs persists LayerNorm — that's benign.
    cfg = _whisper_config()
    adapter = {
        "peft_type": "LORA",
        "r": 16,
        "lora_alpha": 32,
        "target_modules": ["q_proj"],
        "modules_to_save": ["encoder.LayerNorm", "decoder.LayerNorm"],
    }
    fp = fingerprint(cfg, _fake_params(), adapter_config=adapter)
    assert fp["kind"] == "adapter"


def test_fingerprint_lm_head_modules_to_save_promotes_to_candidate_base():
    cfg = _whisper_config()
    adapter = {
        "peft_type": "LORA",
        "target_modules": ["q_proj"],
        "modules_to_save": ["lm_head", "encoder.LayerNorm"],
    }
    fp = fingerprint(cfg, _fake_params(), adapter_config=adapter)
    assert fp["kind"] == "candidate_base"
    assert "lm_head" in fp["promotion_reason"]


def test_fingerprint_target_modules_order_independent():
    cfg = _whisper_config()
    a = fingerprint(cfg, _fake_params(), adapter_config={
        "peft_type": "LORA", "target_modules": ["q_proj", "k_proj", "v_proj"],
    })
    b = fingerprint(cfg, _fake_params(), adapter_config={
        "peft_type": "LORA", "target_modules": ["v_proj", "q_proj", "k_proj"],
    })
    assert a["adapter_fp"] == b["adapter_fp"]


# ---------------------------------------------------------------------------
# Algorithm — classify_promotion()
# ---------------------------------------------------------------------------

def test_classify_duplicate():
    parent = {"arch_fp": "a", "weight_fp": "w"}
    candidate = {"arch_fp": "a", "weight_fp": "w", "kind": "base"}
    out = classify_promotion(parent=parent, candidate=candidate)
    assert out["outcome"] == "duplicate"


def test_classify_adapter_or_finetune():
    parent = {"arch_fp": "a", "weight_fp": "w_old"}
    candidate = {
        "arch_fp": "a", "weight_fp": "w_new", "kind": "adapter",
        "adapter_fp": "ad",
    }
    out = classify_promotion(parent=parent, candidate=candidate)
    assert out["outcome"] == "adapter_or_finetune"
    assert out["kind"] == "adapter"


def test_classify_new_base_on_arch_diff():
    parent = {"arch_fp": "a", "weight_fp": "w"}
    candidate = {"arch_fp": "b", "weight_fp": "w", "kind": "base"}
    out = classify_promotion(parent=parent, candidate=candidate)
    assert out["outcome"] == "new_base"
    assert out["kind"] == "base_model"


def test_classify_candidate_base_short_circuits():
    parent = {"arch_fp": "a", "weight_fp": "w"}
    candidate = {
        "arch_fp": "a", "weight_fp": "w_new", "kind": "candidate_base",
        "promotion_reason": "modules_to_save adds: ['lm_head']",
    }
    out = classify_promotion(parent=parent, candidate=candidate)
    assert out["outcome"] == "candidate_base"
    assert out["kind"] == "candidate_base"


def test_allow_lists_are_frozenset_for_immutability():
    # Defensive: callers shouldn't be able to mutate the algorithm's
    # allow-list at runtime by appending to it.
    assert isinstance(CONFIG_ALLOWLIST, frozenset)
    assert isinstance(ADAPTER_ALLOWLIST, frozenset)


# ---------------------------------------------------------------------------
# HTTP — read-only registry endpoints
# ---------------------------------------------------------------------------

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAINING_DB_PATH", str(tmp_path / "training.db"))
    monkeypatch.setenv("WORKER_ENABLED", "false")
    import main
    importlib.reload(main)
    # The seed runs on FastAPI startup — TestClient triggers it via
    # ASGI lifespan.
    with TestClient(main.app) as tc:
        yield tc


def test_get_base_models_lists_seeded_vendors(client):
    res = client.get("/base-models")
    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == len(VENDOR_SEEDS)
    ids = {r["id"] for r in rows}
    assert "bm_whisper_large_v3_turbo" in ids


def test_get_base_models_filter_by_family(client):
    res = client.get("/base-models", params={"family": "whisper"})
    rows = res.json()
    assert all(r["family"] == "whisper" for r in rows)


def test_get_base_model_404(client):
    res = client.get("/base-models/bm_does_not_exist")
    assert res.status_code == 404


def test_get_base_model_detail(client):
    res = client.get("/base-models/bm_meralion")
    assert res.status_code == 200
    body = res.json()
    assert body["display_name"] == "MERaLiON"


def test_get_artifacts_for_unknown_job_404(client):
    res = client.get("/jobs/job-missing/artifacts")
    assert res.status_code == 404


def test_get_artifacts_for_known_job_empty_list(client):
    submitted = client.post(
        "/jobs",
        json={
            "name": "wf",
            "submitted_by": "u2",
            "target": "cloud",
            "base_model": "openai/whisper-large-v3-turbo",
            "dataset_ref": "u2@example.com/x",
        },
    ).json()
    res = client.get(f"/jobs/{submitted['id']}/artifacts")
    assert res.status_code == 200
    assert res.json() == []
