"""The bit that runs after a webhook is acknowledged.

FastAPI's BackgroundTasks fire after the response is sent, so the receiver
hits its sub-second SLA (Zoom: 3 s, Graph: 3 s typical, 10 s extended) and
the heavy lifting — minting tokens, streaming MB of audio, calling
/transcribe/ — happens in this module without holding the response open.

For prod, swap BackgroundTasks for a real queue (Celery/RQ/SQS). The
function signature here is queue-agnostic so that swap is local to main.py.
"""
from __future__ import annotations

import logging
from typing import Any

from .db import (
    credentials_of,
    get_connection_by_id,
    has_seen_recording,
    mark_recording_seen,
)
from .orchestrator import mirror_to_frontend, submit_to_transcription
from .providers.base import RecordingEvent, get_provider

log = logging.getLogger(__name__)


async def process_recording_event(
    *,
    provider_id: str,
    connection_id: int,
    event_dict: dict[str, Any],
) -> None:
    """The end-to-end ingest job for a single recording.

    1. Dedupe on (provider, external_recording_id).
    2. Stream-download the media via the provider.
    3. POST to transcription-orchestrator.
    4. Mirror the row into platform.db via the frontend ingest endpoint.
    """
    event = RecordingEvent(**event_dict)
    if has_seen_recording(provider_id, event.external_recording_id):
        log.info("skip duplicate recording %s/%s", provider_id, event.external_recording_id)
        return

    conn = get_connection_by_id(connection_id)
    if conn is None:
        log.warning("connection %s vanished mid-flight", connection_id)
        return

    provider = get_provider(provider_id)
    creds = credentials_of(conn)

    filename = (
        f"{provider_id}-{event.external_recording_id}.{event.file_extension}"
    )
    audio_stream = provider.download_recording(
        connection_credentials=creds, event=event,
    )

    try:
        transcribed = await submit_to_transcription(
            audio_stream=audio_stream,
            filename=filename,
            content_type=_content_type_for(event.file_extension),
        )
    except NotImplementedError as exc:
        log.warning(
            "provider %s download not implemented yet: %s", provider_id, exc,
        )
        return
    except Exception:
        log.exception("transcription submission failed")
        return

    await mirror_to_frontend(
        transcription_response=transcribed,
        filename=filename,
        owner_id=conn["user_id"],
        provider=provider_id,
        external_recording_id=event.external_recording_id,
        external_meeting_id=event.external_meeting_id,
        organiser_email=event.organiser_email,
        topic=event.topic,
    )

    audio_file_id = str(transcribed.get("audio_file_id") or "") or None
    mark_recording_seen(
        provider_id, event.external_recording_id, audio_file_id=audio_file_id,
    )


def _content_type_for(ext: str) -> str:
    ext = (ext or "").lower().lstrip(".")
    return {
        "m4a": "audio/m4a", "mp3": "audio/mpeg", "wav": "audio/wav",
        "mp4": "audio/mp4", "ogg": "audio/ogg", "flac": "audio/flac",
        "webm": "audio/webm",
    }.get(ext, "application/octet-stream")
