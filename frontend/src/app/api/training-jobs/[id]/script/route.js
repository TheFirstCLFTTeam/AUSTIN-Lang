import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';

const ORCH_URL =
    process.env.TRAINING_ORCHESTRATOR_URL ||
    'http://training-orchestrator:8008';

// 30 s — a Python source file is tiny but slow disks + container CPU can
// still push the round-trip past the standard 15 s. Belt-and-braces.
const REQUEST_TIMEOUT_MS = 30000;

// POST /api/training-jobs/:id/script — multipart upload of the training
// Python script to attach to a queued job. Validation lives upstream
// (size cap + MIME + magic-byte sniff inside the orchestrator's
// script_storage.py); this proxy does no inspection of its own beyond
// the requireUser session check + CSRF cookie that route-helpers stamps.
//
// The form is forwarded *as-is* — re-using the incoming `multipart/form-
// data; boundary=…` Content-Type and re-streaming the body — so the
// upstream's part parser sees exactly what the browser sent. This is
// also why we don't read into a buffer here: small file, but no point
// holding it in memory twice.
//
// Upstream errors (400 / 409 / 413 / 415) pass through unchanged so the
// dialog can surface the orchestrator's reason verbatim.

export const POST = requireUser(async (request, { params }) => {
    const { id } = await params;

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        return NextResponse.json(
            { detail: 'Content-Type must be multipart/form-data' },
            { status: 400 },
        );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const upstream = await fetch(
            `${ORCH_URL}/jobs/${encodeURIComponent(id)}/script`,
            {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': contentType,
                },
                // Buffer once via arrayBuffer() — Next 15's edge fetch doesn't
                // support `duplex: 'half'` body streaming reliably across
                // runtimes, and a 256 KB cap means buffering is cheap.
                body: await request.arrayBuffer(),
                signal: controller.signal,
            },
        );
        const text = await upstream.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = { detail: text || 'Upstream returned non-JSON response' };
        }
        return NextResponse.json(data, { status: upstream.status });
    } catch (err) {
        const aborted = err?.name === 'AbortError';
        return NextResponse.json(
            { detail: aborted ? 'Training-orchestrator timed out' : 'Training-orchestrator unreachable' },
            { status: aborted ? 504 : 502 },
        );
    } finally {
        clearTimeout(timer);
    }
});
