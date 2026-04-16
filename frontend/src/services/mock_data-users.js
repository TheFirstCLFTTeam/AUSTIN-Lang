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
