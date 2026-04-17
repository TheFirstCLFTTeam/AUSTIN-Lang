// Client for the pseudonymisation orchestrator's stateless masking endpoint.
//
// Used at submit-for-review time to grab a masked copy of the transcript
// in one round trip. Failure is non-blocking — callers fall through with
// the unmasked text and surface a warning to the reviewer.

const ORCHESTRATOR_URL =
    process.env.NEXT_PUBLIC_PSEUDONYM_ORCHESTRATOR_URL || 'http://localhost:5002';

const REQUEST_TIMEOUT_MS = 15000;

// segments: [{ id, text, lang? }]
// returns:  { maskedSegments: [{ id, text }], spansCount, modelVersion, labelSetVersion }
//   or throws — caller decides whether to block or pass through.
export async function pseudonymiseSegments(segments) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(`${ORCHESTRATOR_URL}/pseudonymise-now`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ segments }),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`pseudonymisation failed: HTTP ${res.status} ${text}`);
        err.status = res.status;
        throw err;
    }

    const data = await res.json();
    return {
        maskedSegments: data.masked_segments || [],
        spansCount: data.spans_count ?? 0,
        modelVersion: data.model_version,
        labelSetVersion: data.label_set_version,
    };
}
