"""
gliner inference enclave service.

Single-purpose: load urchade/gliner_medium-v2.1 once at boot, expose a
/pseudonymise endpoint that takes a list of segments + per-label thresholds
and returns detected spans. The orchestrator owns masking policy and
persistence — this service stays narrow so the model can be swapped or
re-deployed without touching business logic.

Auth: shared-secret header in dev, mTLS in prod (handled by the enclave
network — header check still runs as defence-in-depth).
"""

import os
import time
import uuid
from typing import List, Optional, Dict

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from gliner import GLiNER

MODEL_ID = os.getenv("GLINER_MODEL_ID", "urchade/gliner_medium-v2.1")
SHARED_SECRET = os.getenv("GLINER_SHARED_SECRET", "dev-shared-secret")

app = FastAPI(
    title="AUSTIN-Lang gliner Service",
    description="On-prem NER inference for transcript pseudonymisation.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

print(f"Loading {MODEL_ID}...")
model = GLiNER.from_pretrained(MODEL_ID)
print("ready")


class Segment(BaseModel):
    id: str
    text: str
    lang: Optional[str] = None


class PseudonymiseRequest(BaseModel):
    segments: List[Segment]
    labels: List[str]
    thresholds: Dict[str, float] = Field(default_factory=dict)
    default_threshold: float = 0.5


class Span(BaseModel):
    segmentId: str
    start: int
    end: int
    text: str
    label: str
    score: float


class PseudonymiseResponse(BaseModel):
    runId: str
    spans: List[Span]


def _check_auth(secret: Optional[str]) -> None:
    # Constant-time-ish compare; secrets are short and the enclave terminates
    # mTLS upstream so this is belt-and-braces only.
    if not secret or secret != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="bad shared secret")


@app.get("/health")
async def health():
    return {"status": "healthy", "model": MODEL_ID}


@app.post("/pseudonymise", response_model=PseudonymiseResponse)
async def pseudonymise(
    payload: PseudonymiseRequest,
    x_austin_internal: Optional[str] = Header(default=None),
):
    _check_auth(x_austin_internal)

    if not payload.labels:
        raise HTTPException(status_code=400, detail="labels required")
    if not payload.segments:
        raise HTTPException(status_code=400, detail="segments required")

    run_id = f"gl-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    spans: List[Span] = []

    # Per-segment inference. gliner supports a single global threshold; we
    # filter by per-label thresholds in post to keep the contract per-entity.
    floor = min([payload.default_threshold, *payload.thresholds.values()])

    for seg in payload.segments:
        try:
            entities = model.predict_entities(seg.text, payload.labels, threshold=floor)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"inference failed: {exc}")

        for ent in entities:
            label = ent["label"]
            score = float(ent["score"])
            cutoff = payload.thresholds.get(label, payload.default_threshold)
            if score < cutoff:
                continue
            spans.append(
                Span(
                    segmentId=seg.id,
                    start=int(ent["start"]),
                    end=int(ent["end"]),
                    text=ent["text"],
                    label=label,
                    score=score,
                )
            )

    return PseudonymiseResponse(runId=run_id, spans=spans)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("GLINER_PORT", 9001))
    uvicorn.run(app, host="0.0.0.0", port=port)
