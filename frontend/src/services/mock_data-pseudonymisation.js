// Mock pseudonymisation runs.
//
// Shape of the data the backend will eventually produce:
//   run:    one per (transcript, submission) pair — status tracks the gliner
//           worker's progress and any failure / retry history.
//   spans:  per-entity records linked back to a transcript segment. A span
//           captures the original text, the placeholder that replaced it,
//           the entity type, and the reviewer's decision (accept/reject) so
//           the audit trail is fully reversible.
//
// Actor model:
//   All model-driven masking (gliner) and system-level Alt+G rewrites are
//   attributed to a shell persona `system` ("AUSTIN System"). This matches
//   the audit trail's existing SYSTEM_ACTOR — keeping attribution scoped to
//   one synthetic user while we hold off on per-author manual-mask
//   attribution.

export const SYSTEM_PERSONA = {
    id: 'system',
    name: 'AUSTIN System',
    designation: 'Automated Pseudonymisation Pipeline',
    profilePic: null,
    role: 'automated-pipeline',
};

// Canonical entity taxonomy passed to gliner at inference time. Matches the
// backend implementation plan's `label_set_version: banking-v3`.
export const PSEUDONYMISATION_LABEL_SET = {
    version: 'banking-v3',
    labels: [
        { id: 'person_name', label: 'person name', threshold: 0.6 },
        { id: 'phone_number', label: 'phone number', threshold: 0.5 },
        { id: 'email_address', label: 'email address', threshold: 0.5 },
        { id: 'bank_account_id', label: 'bank account id', threshold: 0.45 },
        { id: 'customer_reference_id', label: 'customer reference id', threshold: 0.45 },
        { id: 'trading_account_id', label: 'trading account id', threshold: 0.45 },
        { id: 'address', label: 'address', threshold: 0.55 },
        { id: 'date_of_birth', label: 'date of birth', threshold: 0.6 },
        { id: 'national_id', label: 'national id', threshold: 0.5 },
        { id: 'passport_number', label: 'passport number', threshold: 0.5 },
        { id: 'monetary_amount_individual', label: 'monetary amount tied to an individual', threshold: 0.55 },
        { id: 'internal_project_codename', label: 'internal project codename', threshold: 0.65 },
    ],
};

// Placeholder counter convention — monotonic per entity type per run, so a
// recurring entity keeps the same token. Mirrors the `[MASKED_NAME_01]`
// format already visible on the privacy page.
function placeholder(entityType, idx) {
    const map = {
        person_name: 'NAME',
        phone_number: 'PHONE',
        email_address: 'EMAIL',
        bank_account_id: 'BANK_ID',
        customer_reference_id: 'CRID',
        trading_account_id: 'TRADE_ID',
        address: 'ADDR',
        date_of_birth: 'DOB',
        national_id: 'NATIONAL_ID',
        passport_number: 'PASSPORT',
        monetary_amount_individual: 'AMOUNT',
        internal_project_codename: 'PROJECT',
    };
    const suffix = String(idx).padStart(2, '0');
    return `[MASKED_${map[entityType] || entityType.toUpperCase()}_${suffix}]`;
}

// ── Runs, keyed by file id ───────────────────────────────────────────────
// Not every mock file has a pseudonymisation run — only ones where the
// author has submitted for review at least once. New files start without
// any run attached.

export const PSEUDONYMISATION_RUNS = {
    // Our canonical reviewer-persona demo file. Complete run, all spans
    // decided, ready for the reviewer to approve or kick back.
    'root-spgispeech-0007': {
        runId: 'pr-20260417-ab12',
        fileId: 'root-spgispeech-0007',
        status: 'done',
        modelVersion: 'gliner_medium-v2.1',
        labelSetVersion: 'banking-v3',
        startedAt: '2026-04-17T09:02:04Z',
        completedAt: '2026-04-17T09:02:07Z',
        actorId: 'system',
        attempts: 1,
        error: null,
        spans: [
            {
                spanId: 'sp-ab12-01',
                segmentId: 5001,
                startChar: 18,
                endChar: 38,
                originalText: 'Jonathan V. Sterling',
                entityType: 'person_name',
                placeholder: placeholder('person_name', 1),
                confidence: 0.89,
                source: 'model',
                decision: 'accepted',
                reviewerId: 'u4',
                reviewerDecidedAt: '2026-04-17T09:14:22Z',
                reviewerNote: null,
            },
            {
                spanId: 'sp-ab12-02',
                segmentId: 5001,
                startChar: 82,
                endChar: 97,
                originalText: '8838-4491-882',
                entityType: 'bank_account_id',
                placeholder: placeholder('bank_account_id', 1),
                confidence: 0.94,
                source: 'model',
                decision: 'accepted',
                reviewerId: 'u4',
                reviewerDecidedAt: '2026-04-17T09:14:28Z',
                reviewerNote: null,
            },
            {
                spanId: 'sp-ab12-03',
                segmentId: 5001,
                startChar: 142,
                endChar: 154,
                originalText: '555-0198-532',
                entityType: 'phone_number',
                placeholder: placeholder('phone_number', 1),
                confidence: 0.82,
                source: 'model',
                decision: 'accepted',
                reviewerId: 'u4',
                reviewerDecidedAt: '2026-04-17T09:14:32Z',
                reviewerNote: null,
            },
            {
                // Alt+G mask the author made before submit — attributed to
                // the system persona for now. The pseudonymiser upgraded
                // the raw `[MASK]` to the typed placeholder by inferring
                // the entity type from the surrounding segment context.
                spanId: 'sp-ab12-04',
                segmentId: 5002,
                startChar: 11,
                endChar: 17,
                originalText: 'Apollo',
                entityType: 'internal_project_codename',
                placeholder: placeholder('internal_project_codename', 1),
                confidence: 0.71,
                source: 'model',
                decision: 'accepted',
                reviewerId: 'u4',
                reviewerDecidedAt: '2026-04-17T09:14:40Z',
                reviewerNote: 'Internal code — masking is appropriate for external sharing.',
            },
        ],
    },

    // In-flight run. Worker is mid-inference. No spans persisted yet.
    'root-spgispeech-0012': {
        runId: 'pr-20260417-cd34',
        fileId: 'root-spgispeech-0012',
        status: 'pseudonymising',
        modelVersion: 'gliner_medium-v2.1',
        labelSetVersion: 'banking-v3',
        startedAt: '2026-04-17T10:18:55Z',
        completedAt: null,
        actorId: 'system',
        attempts: 1,
        error: null,
        spans: [],
    },

    // Done run where the reviewer rejected one span (false positive — the
    // word "Apollo" here was the mission, not the internal codename).
    'root-spgispeech-0019': {
        runId: 'pr-20260416-ef56',
        fileId: 'root-spgispeech-0019',
        status: 'done',
        modelVersion: 'gliner_medium-v2.1',
        labelSetVersion: 'banking-v3',
        startedAt: '2026-04-16T14:22:11Z',
        completedAt: '2026-04-16T14:22:14Z',
        actorId: 'system',
        attempts: 1,
        error: null,
        spans: [
            {
                spanId: 'sp-ef56-01',
                segmentId: 5191,
                startChar: 14,
                endChar: 29,
                originalText: 'Helen Tan Wei Lin',
                entityType: 'person_name',
                placeholder: placeholder('person_name', 1),
                confidence: 0.91,
                source: 'model',
                decision: 'accepted',
                reviewerId: 'u4',
                reviewerDecidedAt: '2026-04-16T15:01:08Z',
                reviewerNote: null,
            },
            {
                spanId: 'sp-ef56-02',
                segmentId: 5192,
                startChar: 0,
                endChar: 6,
                originalText: 'Apollo',
                entityType: 'internal_project_codename',
                placeholder: placeholder('internal_project_codename', 1),
                confidence: 0.62,
                source: 'model',
                decision: 'rejected',
                reviewerId: 'u4',
                reviewerDecidedAt: '2026-04-16T15:01:47Z',
                reviewerNote: 'Speaker is discussing the moon landing, not the internal project. Un-mask.',
            },
            {
                spanId: 'sp-ef56-03',
                segmentId: 5193,
                startChar: 28,
                endChar: 48,
                originalText: 'helen.tan@example.com',
                entityType: 'email_address',
                placeholder: placeholder('email_address', 1),
                confidence: 0.97,
                source: 'model',
                decision: 'accepted',
                reviewerId: 'u4',
                reviewerDecidedAt: '2026-04-16T15:01:52Z',
                reviewerNote: null,
            },
        ],
    },

    // Failed run — gliner service returned 5xx three times, now sitting in
    // the admin-only retry queue.
    'root-spgispeech-0024': {
        runId: 'pr-20260417-gh78',
        fileId: 'root-spgispeech-0024',
        status: 'failed',
        modelVersion: 'gliner_medium-v2.1',
        labelSetVersion: 'banking-v3',
        startedAt: '2026-04-17T06:41:00Z',
        completedAt: '2026-04-17T06:42:18Z',
        actorId: 'system',
        attempts: 3,
        error: {
            code: 'gliner.timeout',
            message: 'Upstream gliner service returned 504 after 30s on attempts 1-3. Escalated to admin queue.',
        },
        spans: [],
    },
};

export function getPseudonymisationRun(fileId) {
    return PSEUDONYMISATION_RUNS[fileId] || null;
}

// Summary counters for the admin / reviewer dashboards. Deliberately
// computed lazily so new entries in PSEUDONYMISATION_RUNS show up without
// touching this function.
export function getPseudonymisationSummary() {
    const runs = Object.values(PSEUDONYMISATION_RUNS);
    const bySpanDecision = { accepted: 0, rejected: 0, pending: 0 };
    let totalSpans = 0;
    for (const run of runs) {
        for (const s of run.spans) {
            totalSpans += 1;
            if (s.decision === 'accepted') bySpanDecision.accepted += 1;
            else if (s.decision === 'rejected') bySpanDecision.rejected += 1;
            else bySpanDecision.pending += 1;
        }
    }
    return {
        runs: runs.length,
        byStatus: runs.reduce((acc, r) => {
            acc[r.status] = (acc[r.status] || 0) + 1;
            return acc;
        }, {}),
        totalSpans,
        bySpanDecision,
    };
}
