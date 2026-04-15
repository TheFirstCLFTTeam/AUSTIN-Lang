// Shared mock data — imported by both api.js (client) and api-server.js (server)

import { SAMPLED_DATASET_FILES } from './sampled-datasets';

export const users = [
    {
        id: 'u1',
        email: 'user@example.com',
        password: 'password123',
        name: 'Generic User',
        role: 'generic',
    },
    {
        id: 'u2',
        email: 'engineer@example.com',
        password: 'password123',
        name: 'Engineer User',
        role: 'engineer',
    },
    {
        id: 'u3',
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin User',
        role: 'admin',
    },
    {
        id: 'u4',
        email: 'reviewer@example.com',
        password: 'password123',
        name: 'Reviewer User',
        role: 'reviewer',
    },
];

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
        ],
    },
};

export const MOCK_PROCESSING_JOBS = [
    {
        id: 'pj1',
        name: 'Q1 2026 Earnings Calls',
        submittedBy: 'Sarah Chen',
        source: 'Zoom Cloud Recordings',
        sourcePath: 'zoom://investor-relations/2026-q1',
        language: 'English (US)',
        status: 'processing',
        progress: 68,
        stage: 'Transcribing',
        submittedAt: '2026-04-15T09:15:00Z',
        estimatedCompletion: '2026-04-15T12:40:00Z',
        recordings: [
            { id: 'r101', fileName: 'earnings_call_jan.wav',  duration: '42:18', sizeMb: 58.2, progress: 100, status: 'completed',   stage: 'Transcript finalized' },
            { id: 'r102', fileName: 'earnings_call_feb.wav',  duration: '38:07', sizeMb: 51.6, progress: 82,  status: 'processing',  stage: 'Speaker diarization' },
            { id: 'r103', fileName: 'earnings_call_mar.wav',  duration: '45:22', sizeMb: 62.9, progress: 54,  status: 'processing',  stage: 'Transcribing' },
            { id: 'r104', fileName: 'qa_session_mar.mp3',     duration: '12:45', sizeMb: 17.4, progress: 35,  status: 'processing',  stage: 'Transcribing' },
        ],
    },
    {
        id: 'pj2',
        name: 'Legal Depositions — Case #4821',
        submittedBy: 'Marcus Reed',
        source: 'Manual Upload',
        sourcePath: 'Local: /depositions/case-4821',
        language: 'English (US)',
        status: 'processing',
        progress: 91,
        stage: 'Finalizing transcripts',
        submittedAt: '2026-04-15T08:55:00Z',
        estimatedCompletion: '2026-04-15T10:05:00Z',
        recordings: [
            { id: 'r201', fileName: 'deposition_witness_01.wav', duration: '1:12:33', sizeMb: 102.3, progress: 100, status: 'completed',  stage: 'Transcript finalized' },
            { id: 'r202', fileName: 'deposition_witness_02.wav', duration: '58:41',   sizeMb: 81.7,  progress: 100, status: 'completed',  stage: 'Transcript finalized' },
            { id: 'r203', fileName: 'counsel_closing_remarks.wav', duration: '08:12', sizeMb: 11.5,  progress: 73,  status: 'processing', stage: 'Quality review' },
        ],
    },
    {
        id: 'pj3',
        name: 'Field Research Interviews — Batch 042',
        submittedBy: 'Priya Desai',
        source: 'SharePoint Sync',
        sourcePath: 'sharepoint://research/field-042',
        language: 'Mixed (EN / ES)',
        status: 'queued',
        progress: 0,
        stage: 'Waiting in queue',
        submittedAt: '2026-04-15T09:20:00Z',
        estimatedCompletion: null,
        recordings: [
            { id: 'r301', fileName: 'interview_participant_14.wav', duration: '22:04', sizeMb: 30.1, progress: 0, status: 'queued', stage: 'Queued' },
            { id: 'r302', fileName: 'interview_participant_15.wav', duration: '19:52', sizeMb: 27.3, progress: 0, status: 'queued', stage: 'Queued' },
            { id: 'r303', fileName: 'interview_participant_16.wav', duration: '24:17', sizeMb: 33.4, progress: 0, status: 'queued', stage: 'Queued' },
            { id: 'r304', fileName: 'interview_participant_17.wav', duration: '17:30', sizeMb: 24.0, progress: 0, status: 'queued', stage: 'Queued' },
            { id: 'r305', fileName: 'interview_participant_18.wav', duration: '21:09', sizeMb: 29.2, progress: 0, status: 'queued', stage: 'Queued' },
        ],
    },
    {
        id: 'pj4',
        name: 'Internal Training Session — April',
        submittedBy: 'Daniel Park',
        source: 'Microsoft Teams Recordings',
        sourcePath: 'teams://learning-dev/april-onboarding',
        language: 'English (US)',
        status: 'processing',
        progress: 35,
        stage: 'Uploading audio',
        submittedAt: '2026-04-15T09:22:00Z',
        estimatedCompletion: '2026-04-15T10:40:00Z',
        recordings: [
            { id: 'r401', fileName: 'onboarding_session_pt1.mp3', duration: '35:22', sizeMb: 48.1, progress: 70, status: 'processing', stage: 'Transcribing' },
            { id: 'r402', fileName: 'onboarding_session_pt2.mp3', duration: '41:08', sizeMb: 56.3, progress: 0,  status: 'queued',     stage: 'Queued' },
        ],
    },
    {
        id: 'pj5',
        name: 'Board Meeting Archive — March',
        submittedBy: 'Sarah Chen',
        source: 'Google Drive',
        sourcePath: 'gdrive://board-archive/2026-03',
        language: 'English (US)',
        status: 'failed',
        progress: 62,
        stage: '1 recording failed',
        submittedAt: '2026-04-15T08:50:00Z',
        estimatedCompletion: null,
        recordings: [
            { id: 'r501', fileName: 'board_meeting_mar_pt1.wav', duration: '48:55', sizeMb: 67.8, progress: 100, status: 'completed', stage: 'Transcript finalized' },
            { id: 'r502', fileName: 'board_meeting_mar_pt2.wav', duration: '52:11', sizeMb: 72.4, progress: 100, status: 'failed',    stage: 'Error: Unsupported codec' },
            { id: 'r503', fileName: 'exec_session_mar.wav',      duration: '14:38', sizeMb: 20.2, progress: 100, status: 'completed', stage: 'Transcript finalized' },
        ],
    },
    {
        id: 'pj6',
        name: 'Investor Call — Q1 Wrap',
        submittedBy: 'Marcus Reed',
        source: 'Manual Upload',
        sourcePath: 'Local: /investor-calls/q1-wrap',
        language: 'English (US)',
        status: 'processing',
        progress: 12,
        stage: 'Uploading audio',
        submittedAt: '2026-04-15T09:30:00Z',
        estimatedCompletion: '2026-04-15T11:15:00Z',
        recordings: [
            { id: 'r601', fileName: 'investor_call_q1.mp3', duration: '1:04:12', sizeMb: 88.9, progress: 12, status: 'processing', stage: 'Uploading audio' },
        ],
    },
];

export const MOCK_FILE_STORE = [
    {
        id: '1',
        ownerId: 'u1',
        ownerName: 'Generic User',
        name: 'interview_sample.wav',
        audioUrl: null,
        uploaded_at: '2026-03-01T10:00:00Z',
        duration: '10:34',
        wer: 4.2,
        absoluteWordErrorRate: 31,
        totalNumberOfWords: 738,
        speakerDetection: 3,
        detectedLanguage: 'English (US)',
        compliance: 'FR-A01 Approved',
        rawTranscript: {
            id: 101,
            audio_file_id: 1,
            transcript_segments: [
                {
                    id: 1,
                    start: 0.0,
                    end: 3.5,
                    text: 'Good morning everyone, thank you for joining this quarterly earnings call. We have a lot of ground to cover today regarding our fiscal performance.',
                    originalText: 'Good morning everyone, thank you for joining this quarterly earnings call. We have a lot of ground to cover today regarding our fiscal performance.',
                },
                {
                    id: 2,
                    start: 3.5,
                    end: 7.0,
                    text: 'Revenue increased by twelve percent year over year, driven primarily by strong demand in our institutional services division and new client acquisitions.',
                    originalText:
                        'Revenue increased by twelve percent year over year, driven primarily by strong demand in our institutional services division and new client acquisitions.',
                },
                {
                    id: 3,
                    start: 7.0,
                    end: 11.0,
                    text: 'Our operating margin improved to nineteen point four percent, reflecting ongoing cost optimization initiatives across all major business units.',
                    originalText:
                        'Our operating margin improved to nineteen point four percent, reflecting ongoing cost optimization initiatives across all major business units.',
                },
            ],
        },
        editedTranscript: {
            id: 201,
            raw_transcript_id: 101,
            transcript_segments: [
                {
                    id: 1,
                    start: 0.0,
                    end: 3.5,
                    text: 'Good morning everyone, thank you for joining this quarterly earnings call. We have a lot of ground to cover today regarding our fiscal performance.',
                    originalText: 'Good morning everyone, thank you for joining this quarterly earnings call. We have a lot of ground to cover today regarding our fiscal performance.',
                },
                {
                    id: 2,
                    start: 3.5,
                    end: 7.0,
                    text: 'Revenue increased by twelve percent year over year, driven primarily by strong demand in our institutional services division and new client acquisitions.',
                    originalText:
                        'Revenue increased by twelve percent year over year, driven primarily by strong demand in our institutional services division and new client acquisitions.',
                },
                {
                    id: 3,
                    start: 7.0,
                    end: 11.0,
                    text: 'Our operating margin improved to nineteen point four percent, reflecting ongoing cost optimization initiatives across all major business units.',
                    originalText:
                        'Our operating margin improved to nineteen point four percent, reflecting ongoing cost optimization initiatives across all major business units.',
                },
            ],
        },
        transcriptSegments: [
            {
                id: 1,
                start: 0.0,
                end: 3.5,
                text: 'Good morning everyone, thank you for joining this quarterly earnings call. We have a lot of ground to cover today regarding our fiscal performance.',
                originalText: 'Good morning everyone, thank you for joining this quarterly earnings call. We have a lot of ground to cover today regarding our fiscal performance.',
            },
            {
                id: 2,
                start: 3.5,
                end: 7.0,
                text: 'Revenue increased by twelve percent year over year, driven primarily by strong demand in our institutional services division and new client acquisitions.',
                originalText:
                    'Revenue increased by twelve percent year over year, driven primarily by strong demand in our institutional services division and new client acquisitions.',
            },
            {
                id: 3,
                start: 7.0,
                end: 11.0,
                text: 'Our operating margin improved to nineteen point four percent, reflecting ongoing cost optimization initiatives across all major business units.',
                originalText:
                    'Our operating margin improved to nineteen point four percent, reflecting ongoing cost optimization initiatives across all major business units.',
            },
        ],
    },
    {
        id: '2',
        ownerId: 'u2',
        ownerName: 'Engineer User',
        name: 'lecture_recording.mp3',
        audioUrl: null,
        uploaded_at: '2026-03-02T14:30:00Z',
        duration: '24:38',
        wer: 6.8,
        absoluteWordErrorRate: 142,
        totalNumberOfWords: 2088,
        speakerDetection: 1,
        detectedLanguage: 'English (UK)',
        compliance: 'Pending Review',
        rawTranscript: {
            id: 102,
            audio_file_id: 2,
            transcript_segments: [
                {
                    id: 4,
                    start: 0.0,
                    end: 4.0,
                    text: 'Welcome to the advanced natural language processing seminar. Today we will examine transformer architectures and their applications in speech-to-text systems.',
                    originalText:
                        'Welcome to the advanced natural language processing seminar. Today we will examine transformer architectures and their applications in speech-to-text systems.',
                },
                {
                    id: 5,
                    start: 4.0,
                    end: 9.0,
                    text: 'Attention mechanisms allow the model to weigh the relevance of different input tokens, which is critical for handling long audio sequences with variable speaker patterns.',
                    originalText:
                        'Attention mechanisms allow the model to weigh the relevance of different input tokens, which is critical for handling long audio sequences with variable speaker patterns.',
                },
                {
                    id: 6,
                    start: 9.0,
                    end: 14.5,
                    text: 'Fine-tuning on domain-specific corpora, particularly financial terminology, has shown a forty percent reduction in word error rate compared to the base model.',
                    originalText:
                        'Fine-tuning on domain-specific corpora, particularly financial terminology, has shown a forty percent reduction in word error rate compared to the base model.',
                },
            ],
        },
        editedTranscript: {
            id: 202,
            raw_transcript_id: 102,
            transcript_segments: [
                {
                    id: 4,
                    start: 0.0,
                    end: 4.0,
                    text: 'Welcome to the advanced natural language processing seminar. Today we will examine transformer architectures and their applications in speech-to-text systems.',
                    originalText:
                        'Welcome to the advanced natural language processing seminar. Today we will examine transformer architectures and their applications in speech-to-text systems.',
                },
                {
                    id: 5,
                    start: 4.0,
                    end: 9.0,
                    text: 'Attention mechanisms allow the model to weigh the relevance of different input tokens, which is critical for handling long audio sequences with variable speaker patterns.',
                    originalText:
                        'Attention mechanisms allow the model to weigh the relevance of different input tokens, which is critical for handling long audio sequences with variable speaker patterns.',
                },
                {
                    id: 6,
                    start: 9.0,
                    end: 14.5,
                    text: 'Fine-tuning on domain-specific corpora, particularly financial terminology, has shown a forty percent reduction in word error rate compared to the base model.',
                    originalText:
                        'Fine-tuning on domain-specific corpora, particularly financial terminology, has shown a forty percent reduction in word error rate compared to the base model.',
                },
            ],
        },
        transcriptSegments: [
            {
                id: 4,
                start: 0.0,
                end: 4.0,
                text: 'Welcome to the advanced natural language processing seminar. Today we will examine transformer architectures and their applications in speech-to-text systems.',
                originalText:
                    'Welcome to the advanced natural language processing seminar. Today we will examine transformer architectures and their applications in speech-to-text systems.',
            },
            {
                id: 5,
                start: 4.0,
                end: 9.0,
                text: 'Attention mechanisms allow the model to weigh the relevance of different input tokens, which is critical for handling long audio sequences with variable speaker patterns.',
                originalText:
                    'Attention mechanisms allow the model to weigh the relevance of different input tokens, which is critical for handling long audio sequences with variable speaker patterns.',
            },
            {
                id: 6,
                start: 9.0,
                end: 14.5,
                text: 'Fine-tuning on domain-specific corpora, particularly financial terminology, has shown a forty percent reduction in word error rate compared to the base model.',
                originalText:
                    'Fine-tuning on domain-specific corpora, particularly financial terminology, has shown a forty percent reduction in word error rate compared to the base model.',
            },
        ],
    },
    ...SAMPLED_DATASET_FILES,
];
