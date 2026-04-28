// Group policies — what each user group is allowed to DO (permissions) and
// WHICH SURFACES they can reach (resources). Persisted via localStorage so
// admin edits survive a reload. Seeded from sensible category-based defaults
// (Region / Business Line / Compliance / Engineering) when nothing is stored.

import { USER_GROUP_CATALOGUE } from './mock_data-users';

// Canonical permission keys. Labels/descriptions are surface copy for the
// admin toggle editor.
export const ALL_PERMISSIONS = [
    { key: 'view_files',          label: 'View files',              description: 'Browse recordings in the group\u2019s repository.' },
    { key: 'transcribe',          label: 'Transcribe',              description: 'Trigger transcription jobs on ingested audio.' },
    { key: 'edit_transcripts',    label: 'Edit transcripts',        description: 'Modify transcript text, timestamps, and speaker labels.' },
    { key: 'submit_for_review',   label: 'Submit for review',       description: 'Send transcripts to the review queue.' },
    { key: 'review',              label: 'Review',                  description: 'Approve, reject, or request changes on submitted transcripts.' },
    { key: 'flag_privacy',        label: 'Flag privacy',            description: 'Mark recordings for PII review.' },
    { key: 'pseudonymise',        label: 'Pseudonymise',            description: 'Apply masking to PII spans on approved transcripts.' },
    { key: 'export',              label: 'Export',                  description: 'Download transcripts and recordings in supported formats.' },
    { key: 'create_datasets',     label: 'Create datasets',         description: 'Curate file subsets into named engineer datasets.' },
    { key: 'train_models',        label: 'Train models',            description: 'Launch training / fine-tuning jobs against the group\u2019s datasets.' },
    { key: 'submit_to_leaderboard', label: 'Submit to leaderboard', description: 'Enter models into the group\u2019s leaderboard.' },
    { key: 'manage_group_members',  label: 'Manage group members',  description: 'Add or remove users from this group. Admin-level; off by default.' },
];

// Canonical resource (surface) keys.
export const ALL_RESOURCES = [
    { key: 'files',       label: 'My Transcripts' },
    { key: 'processing',  label: 'Processing queue' },
    { key: 'metrics',     label: 'Metrics dashboard' },
    { key: 'datasets',    label: 'Dataset catalogue' },
    { key: 'training',    label: 'Training jobs' },
    { key: 'leaderboard', label: 'Leaderboard' },
    { key: 'privacy',     label: 'Privacy flags' },
    { key: 'admin',       label: 'Admin consoles' },
];

// Per-group seed policies derived from the Project Requirements Document.
//
// File Organisation groups carry the VIEW scope only — they gate which files
// a member can see in the browser. Real action rights come from pairing a
// member with an Access Permissions group.
//
// Access Permissions groups carry the action + surface bundles keyed to the
// FR-U*/FR-A*/FR-M* role mandates (upload/edit/review/train/etc.) and to the
// role-adaptive navigation spelled out in NFR-UX03.
const SEED_POLICIES = {
    // ── File organisation (data scope) ──────────────────────────────────────
    'hk-user-file-organisation': {
        permissions: ['view_files'],
        resources:   ['files'],
    },
    'hk-reviewer-file-organisation': {
        permissions: ['view_files'],
        resources:   ['files', 'processing'],
    },
    'hk-engineer-file-organisation': {
        permissions: ['view_files'],
        resources:   ['files'],
    },
    'hk-admin-file-organisation': {
        permissions: ['view_files'],
        resources:   ['files', 'processing'],
    },

    // ── Access permissions (actions + surfaces) ─────────────────────────────
    // FR-U01..U04: upload, transcribe, edit, submit for review, export.
    'user-generic-access-perms': {
        permissions: ['view_files', 'edit_transcripts', 'submit_for_review', 'export'],
        resources:   ['files', 'processing', 'metrics'],
    },
    // FR-M01..M05 (green zone only): metrics, training jobs, experiments,
    // synthetic data, model registry. No CID access per NFR-P02.
    'MLE-generic-access-perms': {
        permissions: ['view_files', 'create_datasets', 'train_models', 'submit_to_leaderboard', 'export'],
        resources:   ['files', 'datasets', 'training', 'leaderboard', 'metrics', 'processing'],
    },
    // FR-A01..A02 (review-scoped subset): approve/reject, flag privacy,
    // pseudonymise. No membership management.
    'reviewer-generic-access-perms': {
        permissions: ['view_files', 'review', 'flag_privacy', 'pseudonymise', 'submit_for_review', 'export'],
        resources:   ['files', 'privacy', 'processing', 'metrics'],
    },
    // FR-A01..A05 (full admin): every operator/reviewer/engineer action plus
    // membership management. NFR-UX03 admin navigation bundle.
    'hk-admin-access-perms': {
        permissions: [
            'view_files', 'transcribe', 'edit_transcripts', 'submit_for_review',
            'review', 'flag_privacy', 'pseudonymise', 'export',
            'create_datasets', 'train_models', 'submit_to_leaderboard',
            'manage_group_members',
        ],
        resources:   ['files', 'processing', 'metrics', 'datasets', 'training', 'leaderboard', 'privacy', 'admin'],
    },
};

// Fallback for any group not explicitly seeded above (e.g. admin creates a
// brand-new group through the UI). Category-driven so the new group starts
// with a sensible minimum before the admin tunes it.
const FALLBACKS_BY_CATEGORY = {
    'File Organisation': {
        permissions: ['view_files'],
        resources:   ['files'],
    },
    'Access Permissions': {
        permissions: ['view_files'],
        resources:   ['files'],
    },
};

function seedDefaults() {
    const seed = {};
    for (const g of USER_GROUP_CATALOGUE) {
        const explicit = SEED_POLICIES[g.id];
        if (explicit) {
            seed[g.id] = { permissions: [...explicit.permissions], resources: [...explicit.resources] };
            continue;
        }
        const fallback = FALLBACKS_BY_CATEGORY[g.category] || { permissions: [], resources: [] };
        seed[g.id] = { permissions: [...fallback.permissions], resources: [...fallback.resources] };
    }
    return seed;
}

// v2 — bumped when USER_GROUP_CATALOGUE group ids changed (file-organisation
// + access-perms taxonomy). Stale v1 values are ignored on load.
const STORAGE_KEY = 'austin.group-policies.v2';
const _listeners = new Set();
let _policies = loadFromStorage();

function loadFromStorage() {
    try {
        if (typeof localStorage === 'undefined') return seedDefaults();
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return seedDefaults();
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return seedDefaults();
        // Layer persisted values over defaults so newly added groups pick up
        // category-based defaults without the admin having to re-seed.
        const seed = seedDefaults();
        for (const id of Object.keys(seed)) {
            if (parsed[id]) seed[id] = parsed[id];
        }
        return seed;
    } catch {
        return seedDefaults();
    }
}

function persist() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_policies));
        }
    } catch {}
    _listeners.forEach((fn) => fn({ ..._policies }));
}

export function getPolicy(groupId) {
    const p = _policies[groupId];
    if (!p) return { permissions: [], resources: [] };
    return { permissions: [...p.permissions], resources: [...p.resources] };
}

export function setPolicy(groupId, next) {
    const cleaned = {
        permissions: [...new Set(next.permissions || [])].filter((k) => ALL_PERMISSIONS.some((p) => p.key === k)),
        resources:   [...new Set(next.resources || [])].filter((k) => ALL_RESOURCES.some((r) => r.key === k)),
    };
    _policies = { ..._policies, [groupId]: cleaned };
    persist();
    return getPolicy(groupId);
}

export function subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

export function resetPolicies() {
    _policies = seedDefaults();
    persist();
}
