// Mock user accounts and profiles
// Separated from mock-data.js for maintainability
// Contains: login-capable users (operators) and non-login clients (banking customers)

// ─── Login-capable user accounts ─────────────────────────────────────────────
// These users can authenticate into the system (agent, engineer, admin, reviewer)

export const users = [
    {
        id: 'u1',
        email: 'user@example.com',
        password: 'password123',
        name: 'Generic User',
        role: 'generic',
        company: 'SELF',
        fileOrgGroup: 'user-file-org',
        isControlMember: true,
    },
    {
        id: 'u2',
        email: 'engineer@example.com',
        password: 'password123',
        name: 'Engineer User',
        role: 'engineer',
        company: 'SELF',
        fileOrgGroup: 'engineer-file-org',
        isControlMember: true,
    },
    {
        id: 'u3',
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin User',
        role: 'admin',
        company: 'SELF',
        fileOrgGroup: 'admin-file-org',
        isControlMember: true,
    },
    {
        id: 'u4',
        email: 'reviewer@example.com',
        password: 'password123',
        name: 'Reviewer User',
        role: 'reviewer',
        company: 'SELF',
        fileOrgGroup: 'reviewer-file-org',
        isControlMember: true,
    },
];

// ─── Client accounts (non-login) ────────────────────────────────────────────
// Banking customers who appear on call recordings. These clients do NOT have
// login credentials — they exist so that operators can tag/associate them with
// specific recordings for compliance review and audit trails.
//
// Context (from UBS sponsor meetings):
//   - Clients call in for investment, payment, and trading operations
//   - Compliance must verify that T&Cs were explained during the call
//   - Recordings are retained for up to 7 calendar days
//   - Calls may involve multiple trades/orders in a single session

export const MOCK_CLIENTS = [
    {
        id: 'c1',
        name: 'Helen Tan Wei Lin',
        company: 'United Overseas Bank (UOB)',
        relationship: 'Institutional Banking',
        relationshipId: 'RN-880412',
        region: 'APAC — Singapore',
        languages: ['English', 'Mandarin'],
        riskLevel: 'standard',
        callFrequency: 'frequent',       // multiple calls per week
        primaryActivity: 'Treasury operations, interbank settlements',
    },
    {
        id: 'c2',
        name: 'Andreas Keller',
        company: 'BlackRock',
        relationship: 'Institutional Asset Management',
        relationshipId: 'RN-550738',
        region: 'EMEA — Zurich',
        languages: ['English', 'German'],
        riskLevel: 'elevated',
        callFrequency: 'regular',         // ~once per week
        primaryActivity: 'ETF rebalancing, large block trades, cross-border fund transfers',
    },
    {
        id: 'c3',
        name: 'Priya Ramanathan',
        company: 'ByteDance',
        relationship: 'Corporate Banking',
        relationshipId: 'RN-220195',
        region: 'APAC — Singapore',
        languages: ['English', 'Mandarin'],
        riskLevel: 'standard',
        callFrequency: 'occasional',      // a few calls per month
        primaryActivity: 'FX hedging, corporate treasury, cross-border payroll disbursements',
    },
    {
        id: 'c4',
        name: 'James Whitmore',
        company: 'CapitaLand',
        relationship: 'Corporate Investment Banking',
        relationshipId: 'RN-991060',
        region: 'APAC — Singapore',
        languages: ['English'],
        riskLevel: 'elevated',
        callFrequency: 'frequent',
        primaryActivity: 'REIT structuring, property fund acquisitions, capital market instruments',
    },
];

// ─── Operator profiles (extended info for logged-in users) ───────────────────

export const MOCK_USER_PROFILES = {
    u1: {
        name: 'J. Montgomery',
        profilePic: '/04UserPFP.png',
        designation: 'ML Engineer',
        employeeId: 'PR-8829-X',
        department: 'Core Architect',
        recordingsHandled: {
            total: 342,
            daily: [
                { day: 'Mon', count: 84 },
                { day: 'Tue', count: 82 },
                { day: 'Wed', count: 55 },
                { day: 'Thu', count: 71 },
                { day: 'Fri', count: 70 },
            ],
        },
        preferences: {
            localization: { primary: 'English', secondary: 'Mandarin' },
            notifications: ['Transcription Ready', 'Transco Job Complete', 'Compliance Flags'],
        },
        security: {
            status: 'Alive',
            mfaEnabled: true,
            activeSessions: [
                { id: 'sess-001', label: '192.168.0.1' },
                { id: 'sess-002', label: '10.0.0.42' },
            ],
        },
        permissionGroups: [
            {
                name: 'ML Engineer - Level 3',
                isPrimary: true,
                permissions: ['Full Access to Training Pipeline', 'Red Zone Data Access', 'Inference Endpoint Deployment'],
            },
            {
                name: 'Data Architect - Tier 2',
                isPrimary: false,
                permissions: ['Schema Design Access', 'Read-Only Production Data', 'ETL Pipeline Management'],
            },
            {
                name: 'Security Auditor - Level 1',
                isPrimary: false,
                permissions: ['Audit Log Viewer', 'Compliance Report Access'],
            },
        ],
    },
    u2: {
        name: 'R. Nakamura',
        profilePic: '/03EngiPFP.png',
        designation: 'Senior Engineer',
        employeeId: 'EN-4412-K',
        department: 'Platform Engineering',
        recordingsHandled: {
            total: 189,
            daily: [
                { day: 'Mon', count: 45 },
                { day: 'Tue', count: 38 },
                { day: 'Wed', count: 42 },
                { day: 'Thu', count: 30 },
                { day: 'Fri', count: 34 },
            ],
        },
        preferences: {
            localization: { primary: 'English', secondary: null },
            notifications: ['Transcription Ready', 'Transco Job Complete'],
        },
        security: {
            status: 'Alive',
            mfaEnabled: true,
            activeSessions: [
                { id: 'sess-003', label: '172.16.0.5' },
            ],
        },
        permissionGroups: [
            {
                name: 'Platform Engineer - Level 2',
                isPrimary: true,
                permissions: ['Full Access to Training Pipeline', 'Infrastructure Management'],
            },
        ],
    },
    u3: {
        name: 'A. Whitfield',
        profilePic: '/01AdminPFP.png',
        designation: 'System Administrator',
        employeeId: 'AD-0001-A',
        department: 'Operations',
        recordingsHandled: {
            total: 512,
            daily: [
                { day: 'Mon', count: 120 },
                { day: 'Tue', count: 105 },
                { day: 'Wed', count: 98 },
                { day: 'Thu', count: 102 },
                { day: 'Fri', count: 87 },
            ],
        },
        preferences: {
            localization: { primary: 'English', secondary: 'Mandarin' },
            notifications: ['Transcription Ready', 'Transco Job Complete', 'Compliance Flags'],
        },
        security: {
            status: 'Alive',
            mfaEnabled: true,
            activeSessions: [
                { id: 'sess-004', label: '10.0.1.1' },
                { id: 'sess-005', label: '192.168.1.50' },
                { id: 'sess-006', label: '10.0.1.3' },
            ],
        },
        permissionGroups: [
            {
                name: 'System Admin - Level 5',
                isPrimary: true,
                permissions: ['Full System Access', 'User Management', 'Group Management', 'Audit Controls'],
            },
            {
                name: 'Security Auditor - Level 3',
                isPrimary: false,
                permissions: ['Audit Log Viewer', 'Compliance Report Access', 'Incident Response'],
            },
            {
                name: 'Transcript Review',
                isPrimary: false,
                permissions: ['Transcript Review Access', 'Compliance Verification', 'Edit Approval'],
            },
        ],
    },
    u4: {
        name: 'L. Vasquez',
        profilePic: '/02ReviewerPFP.png',
        designation: 'Transcript Reviewer',
        employeeId: 'RV-2201-F',
        department: 'Quality Assurance',
        recordingsHandled: {
            total: 276,
            daily: [
                { day: 'Mon', count: 62 },
                { day: 'Tue', count: 58 },
                { day: 'Wed', count: 50 },
                { day: 'Thu', count: 54 },
                { day: 'Fri', count: 52 },
            ],
        },
        preferences: {
            localization: { primary: 'English', secondary: null },
            notifications: ['Transcription Ready', 'Compliance Flags'],
        },
        security: {
            status: 'Alive',
            mfaEnabled: false,
            activeSessions: [
                { id: 'sess-007', label: '10.0.2.15' },
            ],
        },
        permissionGroups: [
            {
                name: 'Reviewer - Level 2',
                isPrimary: true,
                permissions: ['Transcript Review Access', 'Edit Approval', 'Quality Report Viewer'],
            },
            {
                name: 'Transcript Review',
                isPrimary: false,
                permissions: ['Transcript Review Access', 'Compliance Verification', 'Edit Approval'],
            },
        ],
    },
};

// ─── User-group catalogue (data-access bundles) ──────────────────────────────
// A "user group" is a bundle of data-access rights over a specific recording
// repository. Membership controls *which files* a user can see and act on —
// not what they can do (that's role-based). The admin page lets the admin
// assign/unassign users to these groups; permissions propagate through to
// the file browser scoping.

// Two kinds of groups:
//   - "File Organisation" groups define the DATA SCOPE a persona sees in the
//     file browser. They are region + role scoped (here, HK).
//   - "Access Permissions" groups carry the ACTION + SURFACE bundle. They
//     correspond to what a persona can DO once they can see the data.
// A persona is assigned one of each kind so that file visibility and action
// rights compose cleanly. See Project_Requirements_Document.md FR-U*, FR-A*,
// FR-M*, and NFR-S02 for the role → permission mapping this encodes.

export const USER_GROUP_CATALOGUE = [
    // ── File organisation (HK region) ───────────────────────────────────────
    {
        id: 'hk-user-file-organisation',
        name: 'HK User File Organisation',
        description: 'Commercial-user file scope for the HK region. Each operator only sees their own uploads and any files explicitly shared with them.',
        category: 'File Organisation',
        repositorySize: '2,104 recordings',
    },
    {
        id: 'hk-reviewer-file-organisation',
        name: 'HK Reviewer File Organisation',
        description: 'Reviewer file scope for the HK region — the compliance review pool plus any recording flagged for PII or regulatory verification.',
        category: 'File Organisation',
        repositorySize: '4,870 recordings',
    },
    {
        id: 'hk-engineer-file-organisation',
        name: 'HK Engineer File Organisation',
        description: 'Green-zone file scope for HK ML engineers. CID-stripped recordings, sampled datasets, and synthetic data pairs only — no raw CID access.',
        category: 'File Organisation',
        repositorySize: '12,600 recordings',
    },
    {
        id: 'hk-admin-file-organisation',
        name: 'HK Admin File Organisation',
        description: 'Admin / verifier file scope for the HK region — all recordings, all transcripts, all zones. Used by risk team for compliance review.',
        category: 'File Organisation',
        repositorySize: '19,574 recordings',
    },

    // ── Access permissions ──────────────────────────────────────────────────
    {
        id: 'user-generic-access-perms',
        name: 'User · Generic Access Permissions',
        description: 'Baseline operator rights: upload audio, read and edit transcripts, submit for review, export. Cannot approve or flag for privacy.',
        category: 'Access Permissions',
        repositorySize: 'Permission bundle',
    },
    {
        id: 'MLE-generic-access-perms',
        name: 'ML Engineer · Generic Access Permissions',
        description: 'ML engineer toolbox: curate datasets, launch training jobs, submit to the leaderboard, export green-zone artefacts. No CID access.',
        category: 'Access Permissions',
        repositorySize: 'Permission bundle',
    },
    {
        id: 'reviewer-generic-access-perms',
        name: 'Reviewer · Generic Access Permissions',
        description: 'Reviewer rights: approve/reject transcripts, flag privacy concerns, apply pseudonymisation, and export verified transcripts.',
        category: 'Access Permissions',
        repositorySize: 'Permission bundle',
    },
    {
        id: 'hk-admin-access-perms',
        name: 'HK Admin Access Permissions',
        description: 'Admin rights in the HK region: every operator/reviewer/engineer action plus membership management and admin consoles.',
        category: 'Access Permissions',
        repositorySize: 'Permission bundle',
    },
];

// Persona → groups. Each persona gets one File Organisation group (data scope)
// plus one Access Permissions group (action bundle). The user-groups service
// loads these on first run and then persists admin edits to localStorage.
export const INITIAL_USER_GROUP_ASSIGNMENTS = {
    u1: ['hk-user-file-organisation', 'user-generic-access-perms'],
    u2: ['hk-engineer-file-organisation', 'MLE-generic-access-perms'],
    u3: ['hk-admin-file-organisation', 'hk-admin-access-perms'],
    u4: ['hk-reviewer-file-organisation', 'reviewer-generic-access-perms'],
};
