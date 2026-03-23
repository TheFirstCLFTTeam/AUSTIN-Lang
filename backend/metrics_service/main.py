from fastapi import FastAPI
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AUSTIN-Lang Metrics Service")

@app.get("/health")
async def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("METRICS_SERVICE_PORT", 8003))
    uvicorn.run(app, host="0.0.0.0", port=port)
