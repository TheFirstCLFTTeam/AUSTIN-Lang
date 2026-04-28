"""Hand a downloaded recording to the transcription pipeline.

We POST multipart/form-data to transcription-orchestrator:8001/transcribe/
— exactly what frontend/src/app/api/upload/route.js does for human uploads,
so the resulting platform.db row is indistinguishable from a normal upload
once the frontend mirrors it.

After /transcribe/ returns we ping the frontend's /api/integrations/ingest
endpoint with the orchestrator's response + provider attribution. The
frontend writes platform.db (which the dashboard reads from) — we keep that
write inside the frontend's server module so there's exactly one place that
knows the platform schema.
"""
from __future__ import annotations

import logging
from typing import Any, AsyncIterator, Optional

import httpx

from .config import settings

log = logging.getLogger(__name__)


async def submit_to_transcription(
    *,
    audio_stream: AsyncIterator[bytes],
    filename: str,
    content_type: str = "audio/mp4",
    domain: Optional[str] = None,
    language: Optional[str] = None,
) -> dict[str, Any]:
    """Stream the audio bytes into a multipart POST. Returns the orchestrator
    JSON response, which contains {audio_file_id, raw_transcript_id,
    edited_transcript_id, transcription:{language, segments:[…]}}."""
    # httpx multipart accepts an async iterable for the file part — but we
    # need to materialize to bytes for the multipart serialiser. For files
    # under ~200 MB this is acceptable; replace with a streaming uploader
    # (e.g. aiohttp + multipart/form-data) for huge MP4s.
    chunks: list[bytes] = []
    async for chunk in audio_stream:
        chunks.append(chunk)
    body = b"".join(chunks)

    files = {"file": (filename, body, content_type)}
    data: dict[str, str] = {}
    if domain:
        data["domain"] = domain
    if language:
        data["language"] = language

    async with httpx.AsyncClient(timeout=None) as client:
        r = await client.post(
            f"{settings.transcription_orchestrator_url}/transcribe/",
            files=files, data=data,
        )
    if r.status_code >= 400:
        raise RuntimeError(
            f"transcription orchestrator failed: {r.status_code} {r.text[:500]}"
        )
    return r.json()


async def mirror_to_frontend(
    *,
    transcription_response: dict[str, Any],
    filename: str,
    owner_id: str,
    provider: str,
    external_recording_id: str,
    external_meeting_id: Optional[str] = None,
    organiser_email: Optional[str] = None,
    topic: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """POST the orchestrator response to the frontend so platform.db gets the
    row with `source_provider` attribution. Returns the mirrored row, or None
    if the frontend ingest URL is not configured (dev mode)."""
    if not settings.frontend_ingest_url:
        log.info("frontend_ingest_url not set — skipping platform.db mirror")
        return None

    body = {
        "transcription": transcription_response,
        "filename": filename,
        "owner_id": owner_id,
        "provider": provider,
        "external_recording_id": external_recording_id,
        "external_meeting_id": external_meeting_id,
        "organiser_email": organiser_email,
        "topic": topic,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            settings.frontend_ingest_url,
            json=body,
            headers={
                "x-meeting-webhooks-secret": settings.frontend_ingest_secret,
            },
        )
    if r.status_code >= 400:
        log.warning("frontend ingest mirror failed: %s %s", r.status_code, r.text[:300])
        return None
    return r.json()
