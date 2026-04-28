// Mock audit trail for file interactions.
//
// Generates a deterministic sequence of audit events per file id so the
// "AUDIT TRAIL" screens render a stable timeline without a backend. Each
// event has an actor (a user id, or 'system' for pipeline steps), an action
// key, a timestamp, and an action-specific details payload that the UI
// turns into a human sentence.

import { users } from './mock_data-users';

// ── Action registry ──────────────────────────────────────────────────────
// `category` drives the filter chips on the audit screen and groups related
// events in copy ("Review" bundles submit / approve / request-changes).

export const AUDIT_ACTIONS = {
    uploaded: {
        label: 'Uploaded',
        verb: 'uploaded the recording',
        category: 'Intake',
        color: '#1c1b1b',
    },
    transcribed: {
        label: 'Transcribed',
        verb: 'produced the initial transcript',
        category: 'Pipeline',
        color: '#9e6a00',
    },
    viewed: {
        label: 'Viewed',
        verb: 'opened the transcript',
        category: 'Access',
        color: '#7a7574',
    },
    edited: {
        label: 'Edited',
        verb: 'edited the transcript',
        category: 'Authoring',
        color: '#004ec6',
    },
    submitted_for_review: {
        label: 'Submitted for review',
        verb: 'submitted the transcript for review',
        category: 'Review',
        color: '#004ec6',
    },
    approved: {
        label: 'Approved',
        verb: 'approved the transcript',
        category: 'Review',
        color: '#1a7f37',
    },
    requested_changes: {
        label: 'Requested changes',
        verb: 'requested changes on the transcript',
        category: 'Review',
        color: '#b20100',
    },
    privacy_flagged: {
        label: 'Privacy flagged',
        verb: 'flagged the recording for PII review',
        category: 'Compliance',
        color: '#b20100',
    },
    pseudonymised: {
        label: 'Pseudonymised',
        verb: 'masked PII spans on the transcript',
        category: 'Compliance',
        color: '#9e6a00',
    },
    access_granted: {
        label: 'Access granted',
        verb: 'granted access to the recording',
        category: 'Access',
        color: '#7a7574',
    },
    added_to_dataset: {
        label: 'Added to dataset',
        verb: 'added the recording to a dataset',
        category: 'Curation',
        color: '#b20100',
    },
    exported: {
        label: 'Exported',
        verb: 'exported the transcript',
        category: 'Access',
        color: '#7a7574',
    },
};

export const AUDIT_CATEGORIES = [
    { key: 'all', label: 'All activity' },
    { key: 'Intake', label: 'Intake' },
    { key: 'Pipeline', label: 'Pipeline' },
    { key: 'Access', label: 'Access' },
    { key: 'Authoring', label: 'Authoring' },
    { key: 'Review', label: 'Review' },
    { key: 'Compliance', label: 'Compliance' },
    { key: 'Curation', label: 'Curation' },
];

// ── Seeded RNG so the trail is stable per file id ───────────────────────
// Same FNV-1a hash + linear-congruential step used elsewhere in the mock
// data. Keeps tests + screenshots reproducible.

function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function seededRng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

function pick(rng, list) {
    return list[Math.floor(rng() * list.length)];
}

// ── Actor pool: human operators plus a synthetic "AUSTIN System" ────────

const SYSTEM_ACTOR = {
    id: 'system',
    name: 'AUSTIN System',
    role: 'automated-pipeline',
    profilePic: null,
};

function randomActor(rng, excludeId) {
    const candidates = users.filter((u) => u.id !== excludeId);
    return pick(rng, candidates);
}

// ── Event template generator ─────────────────────────────────────────────
// Every file follows roughly the same lifecycle — upload → transcribe →
// human editing → review — so the template is a fixed sequence with
// seeded jitter for timestamps, actor choice, and optional side-events.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function buildTimeline(fileId, uploadIso) {
    const rng = seededRng(hashString(fileId));
    // If the caller didn't supply an upload timestamp, synthesise one:
    // somewhere between 7 and 30 days ago.
    const upload = uploadIso
        ? new Date(uploadIso).getTime()
        : Date.now() - (7 + rng() * 23) * DAY;

    const events = [];
    let cursor = upload;

    // Primary uploader — rotates through the human operator pool.
    const uploader = pick(rng, users);

    const push = (actor, action, offsetMs, details) => {
        cursor = cursor + offsetMs;
        events.push({
            id: `audit-${fileId}-${events.length + 1}`,
            fileId,
            actorId: actor.id,
            actorName: actor.name,
            action,
            timestamp: new Date(cursor).toISOString(),
            details: details || {},
        });
    };

    // Upload
    push(uploader, 'uploaded', 0, {
        source: pick(rng, ['drag-drop', 'API /v1/upload', 'Recorder webhook']),
        sizeMb: (2 + rng() * 18).toFixed(1),
    });

    // System: transcription (starts 1-8 minutes later, completes 20-90s after that)
    push(SYSTEM_ACTOR, 'transcribed', (1 + rng() * 7) * 60 * 1000, {
        model: pick(rng, ['whisper-lg-v3', 'meralion v2', 'sensevoice-small']),
        elapsedSec: Math.round(20 + rng() * 70),
    });

    // Occasionally the compliance scanner immediately flags the file.
    if (rng() < 0.45) {
        push(SYSTEM_ACTOR, 'privacy_flagged', Math.round(1 + rng() * 3) * 60 * 1000, {
            entity: pick(rng, ['phone_number', 'account_id', 'person_name', 'email']),
            confidence: (0.78 + rng() * 0.2).toFixed(2),
        });
        // Reviewer resolves the flag
        const reviewer = users.find((u) => u.role === 'reviewer') || randomActor(rng, uploader.id);
        push(reviewer, 'pseudonymised', Math.round(2 + rng() * 6) * HOUR, {
            spansMasked: 1 + Math.floor(rng() * 4),
        });
    }

    // Uploader (or another operator) opens the transcript to review output.
    const firstViewer = rng() < 0.5 ? uploader : randomActor(rng, uploader.id);
    push(firstViewer, 'viewed', Math.round(10 + rng() * 60) * 60 * 1000, {
        dwellSec: Math.round(45 + rng() * 600),
    });

    // 1-3 edit passes, possibly by different operators
    const editPasses = 1 + Math.floor(rng() * 3);
    let previousEditor = null;
    for (let i = 0; i < editPasses; i++) {
        const editor = i === 0 || rng() < 0.6 ? firstViewer : randomActor(rng, previousEditor?.id);
        previousEditor = editor;
        push(editor, 'edited', Math.round(30 + rng() * 180) * 60 * 1000, {
            segmentsChanged: 1 + Math.floor(rng() * 8),
            werDelta: -((0.004 + rng() * 0.02).toFixed(3) * 1),
        });
    }

    // Submit for review by the most recent editor
    const submitter = previousEditor || firstViewer;
    const reviewer = users.find((u) => u.role === 'reviewer') || randomActor(rng, submitter.id);
    push(submitter, 'submitted_for_review', Math.round(15 + rng() * 120) * 60 * 1000, {
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
    });

    // Reviewer path: ~25% ask for changes first, then approve
    if (rng() < 0.25) {
        push(reviewer, 'requested_changes', Math.round(2 + rng() * 18) * HOUR, {
            comment: pick(rng, [
                'Timestamps on speaker 2 drift after 03:00 — please re-align.',
                'Two proper nouns still untagged in the second half.',
                'Check compliance spans on the 00:28 utterance.',
            ]),
        });
        // Editor addresses it
        push(submitter, 'edited', Math.round(1 + rng() * 8) * HOUR, {
            segmentsChanged: 1 + Math.floor(rng() * 4),
            werDelta: -((0.002 + rng() * 0.012).toFixed(3) * 1),
        });
        push(submitter, 'submitted_for_review', Math.round(10 + rng() * 60) * 60 * 1000, {
            reviewerId: reviewer.id,
            reviewerName: reviewer.name,
        });
    }
    push(reviewer, 'approved', Math.round(1 + rng() * 24) * HOUR, {
        comment: pick(rng, [
            'Looks good. Cleared for downstream use.',
            'Approved. WER within tolerance.',
            null,
            'LGTM — no blocking issues.',
        ]),
    });

    // Side events — curation, exports, admin access grants
    if (rng() < 0.55) {
        const curator = users.find((u) => u.role === 'engineer') || uploader;
        push(curator, 'added_to_dataset', Math.round(3 + rng() * 72) * HOUR, {
            datasetName: pick(rng, [
                'Earnings Calls Q1 2026',
                'Cantonese Telephony Edge Cases',
                'Multispeaker Overlap (Hard)',
            ]),
        });
    }
    if (rng() < 0.35) {
        const admin = users.find((u) => u.role === 'admin') || randomActor(rng, uploader.id);
        const grantee = randomActor(rng, admin.id);
        push(admin, 'access_granted', Math.round(1 + rng() * 48) * HOUR, {
            granteeId: grantee.id,
            granteeName: grantee.name,
            scope: pick(rng, ['read-only', 'edit', 'review']),
        });
    }
    if (rng() < 0.4) {
        const exporter = randomActor(rng, uploader.id);
        push(exporter, 'exported', Math.round(1 + rng() * 72) * HOUR, {
            format: pick(rng, ['vtt', 'srt', 'txt', 'json']),
        });
    }

    // Newest first for display.
    return events.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

const _cache = new Map();

export function getAuditTrail(fileId, uploadIso) {
    if (!fileId) return [];
    const key = `${fileId}::${uploadIso || ''}`;
    if (!_cache.has(key)) _cache.set(key, buildTimeline(fileId, uploadIso));
    return _cache.get(key);
}

// ── Formatting helpers ──────────────────────────────────────────────────

export function formatAuditDetail(event) {
    const { action, details } = event;
    if (!details) return '';
    switch (action) {
        case 'uploaded':
            return `${details.sizeMb} MB \u00b7 ${details.source}`;
        case 'transcribed':
            return `${details.model} \u00b7 ${details.elapsedSec}s elapsed`;
        case 'viewed': {
            const m = Math.floor(details.dwellSec / 60);
            const s = details.dwellSec % 60;
            return `${m}m ${s}s on-page`;
        }
        case 'edited': {
            const segs = `${details.segmentsChanged} segment${details.segmentsChanged === 1 ? '' : 's'}`;
            const delta = details.werDelta != null ? ` \u00b7 WER ${(details.werDelta * 100).toFixed(1)}%` : '';
            return `${segs}${delta}`;
        }
        case 'submitted_for_review':
            return `Reviewer: ${details.reviewerName}`;
        case 'approved':
            return details.comment || 'No comment';
        case 'requested_changes':
            return details.comment || 'No comment';
        case 'privacy_flagged':
            return `${details.entity.replace('_', ' ')} \u00b7 confidence ${details.confidence}`;
        case 'pseudonymised':
            return `${details.spansMasked} span${details.spansMasked === 1 ? '' : 's'} masked`;
        case 'access_granted':
            return `${details.granteeName} (${details.scope})`;
        case 'added_to_dataset':
            return details.datasetName;
        case 'exported':
            return details.format.toUpperCase();
        default:
            return '';
    }
}
