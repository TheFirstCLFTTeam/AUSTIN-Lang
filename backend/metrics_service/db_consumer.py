import httpx
import os
from typing import List, Dict

async def fetch_bulk_context(start_date: str = None, end_date: str = None) -> List[Dict]:
    """Fetches data from the Database Service."""
    db_url = os.getenv("DATABASE_URL", "http://database:8002")
    endpoint = f"{db_url}/audio-files/bulk-context"
    
    params = {}
    if start_date and end_date:
        params = {"start_date": start_date, "end_date": end_date}
        
    async with httpx.AsyncClient() as client:
        response = await client.get(endpoint, params=params)
        response.raise_for_status()
        return response.json()

async def fetch_file_context(file_id: int) -> Dict:
    """Fetches context for a specific file."""
    db_url = os.getenv("DATABASE_URL", "http://database:8002")
    endpoint = f"{db_url}/audio-files/{file_id}/full-context"
    
    async with httpx.AsyncClient() as client:
        response = await client.get(endpoint)
        response.raise_for_status()
        return response.json()
