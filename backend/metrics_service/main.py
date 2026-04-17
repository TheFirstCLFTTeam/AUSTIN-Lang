from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import time
from typing import Optional, Dict
from dotenv import load_dotenv
from db_consumer import fetch_bulk_context, fetch_file_context
from calculator import aggregate_metrics, calculate_wer

load_dotenv()

app = FastAPI(title="AUSTIN-Lang Metrics Service")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In prod, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple In-Memory Cache
cache = {
    "dashboard_data": None,
    "last_updated": 0
}
CACHE_TTL = 60 # Seconds

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/metrics/dashboard")
async def get_dashboard():
    """Returns aggregated metrics with 60s caching."""
    now = time.time()
    if cache["dashboard_data"] and (now - cache["last_updated"] < CACHE_TTL):
        return cache["dashboard_data"]

    try:
        data = await fetch_bulk_context()
        metrics = aggregate_metrics(data)
        
        # Add a flag if latest WER is high (Spec rule: check only the latest record)
        if metrics["latest_wer"] is not None:
            metrics["needs_attention"] = metrics["latest_wer"] > 0.20
        else:
            metrics["needs_attention"] = False

        cache["dashboard_data"] = metrics
        cache["last_updated"] = now
        return metrics
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch metrics: {str(e)}")

@app.get("/metrics/accuracy/{file_id}")
async def get_file_accuracy(file_id: int):
    """Calculates detailed WER for a specific file."""
    try:
        item = await fetch_file_context(file_id)
        raw = item.get("raw_text") or ""
        edited = item.get("edited_text") or ""
        
        if not item.get("is_user_edited"):
             return {
                "file_id": file_id,
                "wer": None,
                "status": "pending_edit",
                "message": "File has not been edited yet."
            }

        wer = calculate_wer(edited, raw)
        return {
            "file_id": file_id,
            "wer": wer,
            "raw_text_preview": raw[:100] + "..." if len(raw) > 100 else raw,
            "edited_text_preview": edited[:100] + "..." if len(edited) > 100 else edited
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Database fetch failed: {str(e)}")

@app.post("/metrics/refresh")
async def refresh_cache():
    """Clears the in-memory cache."""
    cache["dashboard_data"] = None
    cache["last_updated"] = 0
    return {"message": "Cache cleared"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("METRICS_SERVICE_PORT", 8006))
    uvicorn.run(app, host="0.0.0.0", port=port)
