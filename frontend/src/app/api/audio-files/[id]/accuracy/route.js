import { NextResponse } from 'next/server';

import { requireOwnerOrRole } from '@/server/route-helpers';
import { platformDb } from '@/server/db';

const METRICS_URL =
    process.env.METRICS_SERVICE_URL || 'http://metrics-service:8006';

const REQUEST_TIMEOUT_MS = 15000;

// Resolve the backend's integer audio_file id for the given external/local
// id. The metrics service addresses files by the canonical backend id
// (`backend_audio_file_id` was stashed at upload time — see
// frontend/src/server/audio-files.js registerUploadedFile).
function loadBackendFileId(fileId) {
    const row = platformDb()
        .prepare(
            `SELECT backend_audio_file_id FROM audio_file
             WHERE external_id = ? OR id = ?`
        )
        .get(String(fileId), Number(fileId) || -1);
    return row?.backend_audio_file_id ?? null;
}

// GET /api/audio-files/:id/accuracy — proxies the metrics service's
// per-file WER calculation. F4-compliant: requireOwnerOrRole gates the
// call (only owner or elevated role can query a file's accuracy).
export const GET = requireOwnerOrRole(async (_request, { params }) => {
    const { id } = await params;
    const backendId = loadBackendFileId(id);
    if (backendId == null) {
        return NextResponse.json(
            { detail: 'File not registered with backend yet' },
            { status: 404 },
        );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(
            `${METRICS_URL}/metrics/accuracy/${encodeURIComponent(backendId)}`,
            {
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            },
        );
        if (!res.ok) {
            return NextResponse.json(
                { detail: 'Failed to fetch file accuracy' },
                { status: 502 },
            );
        }
        return NextResponse.json(await res.json());
    } catch (err) {
        const aborted = err?.name === 'AbortError';
        return NextResponse.json(
            { detail: aborted ? 'Metrics request timed out' : 'Metrics service unreachable' },
            { status: aborted ? 504 : 502 },
        );
    } finally {
        clearTimeout(timer);
    }
});
