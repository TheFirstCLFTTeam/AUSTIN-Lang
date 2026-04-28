// Per-group aggregations used on /admin/groups/[id]. Pure read helpers — no
// persistence. Deterministic outputs so the admin views are stable across
// reloads.

import { users, MOCK_CLIENTS, USER_GROUP_CATALOGUE } from './mock_data-users';
import { AUDIT_ACTIONS } from './mock_data-audit';
import { getAllAssignments } from './user-groups';

// ── Stable PRNG helpers (same FNV-1a + LCG used elsewhere) ──────────────────

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

// ── Member resolution ───────────────────────────────────────────────────────

export function getMembersOfGroup(groupId) {
    const assignments = getAllAssignments();
    const memberIds = Object.keys(assignments).filter((userId) =>
        (assignments[userId] || []).includes(groupId),
    );
    return memberIds
        .map((id) => users.find((u) => u.id === id))
        .filter(Boolean);
}

export function getGroupMeta(groupId) {
    return USER_GROUP_CATALOGUE.find((g) => g.id === groupId) || null;
}

// ── Group audit aggregation ─────────────────────────────────────────────────
// Synthesises a group-level activity timeline: actions taken by members of
// this group, plus a handful of system events that members were involved in.
// Deterministic per groupId.

const MOCK_FILE_NAMES = [
    'earnings_call_jan.wav',
    'earnings_call_feb.wav',
    'deposition_witness_01.wav',
    'counsel_closing_remarks.wav',
    'onboarding_session_pt1.mp3',
    'board_meeting_mar_pt1.wav',
    'investor_call_q1.mp3',
    'interview_participant_14.wav',
    'qa_session_mar.mp3',
];

const MOCK_DATASETS = [
    'Earnings Calls Q1 2026',
    'Cantonese Telephony Edge Cases',
    'Multispeaker Overlap (Hard)',
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const SYSTEM_ACTOR = {
    id: 'system',
    name: 'AUSTIN System',
    role: 'automated-pipeline',
};

export function getGroupAudit(groupId, limit = 40) {
    const members = getMembersOfGroup(groupId);
    if (members.length === 0) return [];

    const rng = seededRng(hashString(`group-audit::${groupId}`));
    const actionKeys = Object.keys(AUDIT_ACTIONS);
    const now = Date.now();
    const events = [];
    // Walk backwards in time, placing events at varied intervals (2h–36h apart).
    let cursor = now - Math.floor(rng() * 2 * HOUR);

    for (let i = 0; i < limit; i++) {
        const useSystem = rng() < 0.22;
        const actor = useSystem ? SYSTEM_ACTOR : pick(rng, members);
        let action;
        if (useSystem) {
            action = pick(rng, ['transcribed', 'privacy_flagged']);
        } else {
            action = pick(rng, actionKeys.filter((k) => k !== 'transcribed'));
        }
        const fileName = pick(rng, MOCK_FILE_NAMES);
        const datasetName = pick(rng, MOCK_DATASETS);

        events.push({
            id: `gaudit-${groupId}-${i}`,
            actorId: actor.id,
            actorName: actor.name,
            action,
            timestamp: new Date(cursor).toISOString(),
            target: { type: action === 'added_to_dataset' ? 'dataset' : 'recording', name: action === 'added_to_dataset' ? datasetName : fileName },
        });

        cursor -= Math.floor(2 * HOUR + rng() * 34 * HOUR);
    }
    return events;
}

// ── External client linkage ─────────────────────────────────────────────────
// Maps a group to the subset of MOCK_CLIENTS its members have interacted
// with. Filters roughly by region / category, falling back to a deterministic
// hash-based selection for non-region groups.

export function getGroupClients(groupId) {
    const meta = getGroupMeta(groupId);
    if (!meta) return [];

    // Access Permissions groups are bundles of action rights, not a data
    // scope. Clients don't apply — return empty.
    if (meta.category === 'Access Permissions') return [];

    // File Organisation groups are HK-region scoped. Route per role:
    if (groupId === 'hk-admin-file-organisation') return MOCK_CLIENTS;
    if (groupId === 'hk-reviewer-file-organisation') return MOCK_CLIENTS;
    if (groupId === 'hk-engineer-file-organisation') return []; // green zone — no CID
    if (groupId === 'hk-user-file-organisation') {
        // A commercial user in HK sees only clients they've personally called.
        // Deterministic 2-client subset for the mock.
        const rng = seededRng(hashString(`group-clients::${groupId}`));
        const shuffled = [...MOCK_CLIENTS].sort(() => rng() - 0.5);
        return shuffled.slice(0, Math.min(2, shuffled.length));
    }

    // Fallback: hash-based subset for any future file-org group.
    const rng = seededRng(hashString(`group-clients::${groupId}`));
    const shuffled = [...MOCK_CLIENTS].sort(() => rng() - 0.5);
    return shuffled.slice(0, Math.min(3, shuffled.length));
}

// ── Interaction summary per client within a group ───────────────────────────
// Used in the "External Clients" panel — totals of calls, last-contact date.

export function getGroupClientInteractions(groupId) {
    const clients = getGroupClients(groupId);
    const rng = seededRng(hashString(`client-interactions::${groupId}`));
    const now = Date.now();
    return clients.map((c) => {
        const calls = 2 + Math.floor(rng() * 28);
        const daysAgo = Math.floor(rng() * 21);
        return {
            ...c,
            callCount: calls,
            lastContactIso: new Date(now - daysAgo * DAY - Math.floor(rng() * HOUR * 8)).toISOString(),
        };
    });
}
