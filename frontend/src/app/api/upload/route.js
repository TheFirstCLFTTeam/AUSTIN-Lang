import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';
import { registerUploadedFile } from '@/server/audio-files';

const ORCHESTRATOR_URL =
    process.env.TRANSCRIPTION_ORCHESTRATOR_URL ||
    'http://transcription-orchestrator:8001';

// 100 MB default — overridable via env. Hard ceiling because the orchestrator
// streams the whole file into memory before handing it to Whisper.
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024);

// MIME types we accept on the upload endpoint. Audio formats only — a stricter
// list than what some browsers send (e.g. some report 'audio/wave' for WAV).
// docs/07 Integration CAA 27APR2026/security overview.md §3.
const ALLOWED_MIME = new Set([
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/ogg',
    'audio/flac',
    'audio/x-flac',
    'audio/webm',
]);

const ALLOWED_EXTENSIONS = new Set(['wav', 'mp3', 'mp4', 'm4a', 'ogg', 'oga', 'flac', 'webm']);

// Minimal magic-byte sniffer for the formats we accept. Caller passes the
// first ≥ 12 bytes of the file. Returns true only for headers consistent with
// the declared MIME family. This is a smoke test, not a complete parser.
function looksLikeAudio(bytes) {
    if (bytes.length < 12) return false;
    // RIFF....WAVE → WAV
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) return true;
    // ID3 tag → MP3
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
    // MPEG audio frame sync (0xFFEx / 0xFFFx)
    if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return true;
    // OggS → Ogg / Opus / Vorbis
    if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return true;
    // fLaC
    if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) return true;
    // ftyp box (MP4 / M4A) at offset 4
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return true;
    // EBML header → WebM
    if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return true;
    return false;
}

// POST /api/upload
//
// Proxies the audio file to the transcription orchestrator and mirrors the
// resulting row into platform.db so subsequent list/detail reads find it.
// The orchestrator's raw_transcript_id / edited_transcript_id are stashed on
// the mirrored row so saveEdits can later co-write user corrections back to
// the canonical poc.db that the retraining pipeline reads from.
export const POST = requireUser(async (request, { user }) => {
    const incoming = await request.formData();
    const file = incoming.get('file');
    if (!file || typeof file === 'string') {
        return NextResponse.json({ detail: 'file is required' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
            { detail: `File too large (max ${MAX_UPLOAD_BYTES} bytes)` },
            { status: 413 },
        );
    }

    const declaredType = (file.type || '').toLowerCase();
    if (declaredType && !ALLOWED_MIME.has(declaredType)) {
        return NextResponse.json(
            { detail: `Unsupported file type: ${declaredType}` },
            { status: 415 },
        );
    }

    const ext = file.name.includes('.')
        ? file.name.split('.').pop().toLowerCase()
        : '';
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
        return NextResponse.json(
            { detail: `Unsupported file extension: .${ext}` },
            { status: 415 },
        );
    }

    // Magic-byte sniff: read the first 16 bytes without consuming the stream.
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!looksLikeAudio(head)) {
        return NextResponse.json(
            { detail: 'File does not look like a supported audio format.' },
            { status: 415 },
        );
    }

    const outgoing = new FormData();
    outgoing.append('file', file, file.name);
    const domain = incoming.get('domain');
    const language = incoming.get('language');
    if (domain) outgoing.append('domain', String(domain));
    if (language) outgoing.append('language', String(language));

    let orchRes;
    try {
        orchRes = await fetch(`${ORCHESTRATOR_URL}/transcribe/`, {
            method: 'POST',
            body: outgoing,
        });
    } catch (err) {
        return NextResponse.json(
            { detail: `Orchestrator unreachable: ${err.message}` },
            { status: 502 },
        );
    }
    if (!orchRes.ok) {
        const text = await orchRes.text().catch(() => '');
        return NextResponse.json(
            { detail: `Orchestrator failed: ${orchRes.status} ${text}` },
            { status: 502 },
        );
    }
    const data = await orchRes.json();

    const mirrored = registerUploadedFile({
        fileName: file.name,
        owner: user,
        backend: {
            audioFileId: data.audio_file_id,
            rawTranscriptId: data.raw_transcript_id,
            editedTranscriptId: data.edited_transcript_id,
        },
        segments: data.transcription?.segments || [],
        detectedLanguage: data.transcription?.language || null,
    });

    return NextResponse.json(mirrored);
});
