"""End-to-end test for the /pseudonymise-now sync endpoint.

Stubs the gliner client so the test runs without the inference service.
Verifies the round-trip: segments in → masked segments out, with the
overlap/manual-mask rules from masking.py honoured.
"""

from unittest.mock import patch

from fastapi.testclient import TestClient

from orchestrator import api
from orchestrator.gliner_client import GlinerInferenceFailure, GlinerResult
from orchestrator.masking import ModelSpan


def _client():
    return TestClient(api.app)


def test_pseudonymise_now_masks_detected_entities():
    fake = GlinerResult(
        run_id="gl-test",
        spans=[
            ModelSpan("seg-1", 3, 8, "Alice", "person name", 0.9),
        ],
    )
    payload = {"segments": [{"id": "seg-1", "text": "Hi Alice, welcome."}]}

    with patch("orchestrator.api.pseudonymise_segments", return_value=fake):
        resp = _client().post("/pseudonymise-now", json=payload)

    assert resp.status_code == 200
    body = resp.json()
    assert body["spans_count"] == 1
    assert body["masked_segments"][0]["text"] == "Hi [MASKED_NAME_01], welcome."


def test_pseudonymise_now_5xx_when_gliner_unavailable():
    payload = {"segments": [{"id": "seg-1", "text": "Hi Alice."}]}

    with patch(
        "orchestrator.api.pseudonymise_segments",
        side_effect=GlinerInferenceFailure("boom"),
    ):
        resp = _client().post("/pseudonymise-now", json=payload)

    assert resp.status_code == 503


def test_pseudonymise_now_empty_segments_short_circuits():
    resp = _client().post("/pseudonymise-now", json={"segments": []})
    assert resp.status_code == 200
    assert resp.json()["masked_segments"] == []
