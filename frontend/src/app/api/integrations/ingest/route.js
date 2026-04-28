import { NextResponse } from 'next/server';

import { registerUploadedFile } from '@/server/audio-files';
import { usersDb } from '@/server/db';

// Shared secret echoed by the meeting-webhooks service. Service-to-service
// only — no cookie auth here because the caller is another container, not
// a browser. In prod swap this for an mTLS-style verification, or move the
// service inside a private network and drop the secret check.
const INGEST_SECRET =
    process.env.MEETING_WEBHOOKS_INGEST_SECRET || 'dev-meeting-webhooks-ingest';

// POST /api/integrations/ingest
//
// Called by backend/meeting_webhooks after a webhook-triggered transcription
// finishes. Mirrors the file into platform.db so the dashboard sees it. The
// orchestrator response is the same shape /api/upload receives — we go
// through the existing registerUploadedFile helper so the schema lives in
// one place.
export async function POST(request) {
    if (request.headers.get('x-meeting-webhooks-secret') !== INGEST_SECRET) {
        return NextResponse.json({ detail: 'forbidden' }, { status: 403 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ detail: 'invalid JSON' }, { status: 400 });
    }

    const {
        transcription, filename, owner_id, provider,
        external_recording_id, external_meeting_id, organiser_email,
    } = body || {};
    if (!transcription || !filename) {
        return NextResponse.json({ detail: 'transcription + filename required' }, { status: 400 });
    }

    // Resolve the internal user. The backend service gives us its own
    // user_id; that's already an internal id when the ingest came from a
    // user we know. Provider-side identity (Zoom host_email, AAD object
    // id) → internal user is best-effort: try email lookup first, fall
    // back to the explicit owner_id from the worker.
    let owner = owner_id ? loadUser(owner_id) : null;
    if (!owner && organiser_email) {
        owner = loadUserByEmail(organiser_email);
    }

    const mirrored = registerUploadedFile({
        fileName: filename,
        owner,
        backend: {
            audioFileId: transcription.audio_file_id,
            rawTranscriptId: transcription.raw_transcript_id,
            editedTranscriptId: transcription.edited_transcript_id,
        },
        segments: transcription.transcription?.segments || [],
        detectedLanguage: transcription.transcription?.language || null,
        source: provider ? {
            provider,
            recordingId: external_recording_id || null,
            meetingId: external_meeting_id || null,
            organiser: organiser_email || null,
        } : null,
    });

    return NextResponse.json({
        mirrored,
        provider,
    });
}

function loadUserByEmail(email) {
    return usersDb()
        .prepare(`SELECT id, email, name, role FROM "user" WHERE email = ?`)
        .get(email) || null;
}

function loadUser(id) {
    return usersDb()
        .prepare(`SELECT id, email, name, role FROM "user" WHERE id = ?`)
        .get(id) || null;
}
