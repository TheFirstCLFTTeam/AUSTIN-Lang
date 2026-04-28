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

    const { transcription, filename, owner_id, provider } = body || {};
    if (!transcription || !filename) {
        return NextResponse.json({ detail: 'transcription + filename required' }, { status: 400 });
    }

    // Resolve the internal user. The backend service gives us its own
    // user_id; that's already an internal id when the ingest came from a
    // user we know. For provider-side identifiers we'd map here.
    const owner = owner_id ? loadUser(owner_id) : null;

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
    });

    return NextResponse.json({
        mirrored,
        provider,
    });
}

function loadUser(id) {
    return usersDb()
        .prepare(`SELECT id, email, name, role FROM "user" WHERE id = ?`)
        .get(id) || null;
}
