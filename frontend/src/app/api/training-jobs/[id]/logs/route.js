import { requireUser } from '@/server/route-helpers';

const ORCH_URL =
    process.env.TRAINING_ORCHESTRATOR_URL || 'http://training-orchestrator:8008';

// GET /api/training-jobs/{id}/logs
//
// Streams the orchestrator's SSE event stream straight through to the
// browser. The orchestrator's endpoint is internal-only (compose
// network); the FE proxy is what the browser's EventSource connects to.
// Cookie-session auth happens here via requireUser; no headers are
// forwarded because EventSource can't send custom headers anyway, but
// the orchestrator sees the requireUser-resolved id via X-User-Id.
//
// We don't go through the http() helper because Next.js needs the raw
// ReadableStream to stay open for the lifetime of the SSE connection,
// not buffered into a single response.
export const GET = requireUser(async (_request, { params, user }) => {
    const { id } = await params;

    let upstream;
    try {
        upstream = await fetch(
            `${ORCH_URL}/jobs/${encodeURIComponent(id)}/logs`,
            {
                method: 'GET',
                headers: {
                    Accept: 'text/event-stream',
                    'X-User-Id': user.id,
                    'X-User-Role': user.role || 'generic',
                },
            },
        );
    } catch (err) {
        return new Response(
            `event: error\ndata: ${JSON.stringify({ detail: `orchestrator unreachable: ${err.message}` })}\n\n`,
            { status: 502, headers: { 'Content-Type': 'text/event-stream' } },
        );
    }

    if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        return new Response(
            text || `event: error\ndata: {"detail":"upstream ${upstream.status}"}\n\n`,
            {
                status: upstream.status,
                headers: { 'Content-Type': 'text/event-stream' },
            },
        );
    }

    // Pass-through stream. Don't buffer; the orchestrator emits at
    // human-readable cadence and the browser EventSource is happy with
    // whatever chunks come through.
    return new Response(upstream.body, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            Connection: 'keep-alive',
        },
    });
});
