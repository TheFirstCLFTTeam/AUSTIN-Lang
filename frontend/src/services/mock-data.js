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
        fileName: 'board_meeting_march.wav',
        status: 'processing',
        progress: 72,
        stage: 'Transcribing',
        submittedAt: '2026-04-01T09:15:00Z',
        estimatedCompletion: '2026-04-01T09:25:00Z',
    },
    {
        id: 'pj2',
        fileName: 'investor_call_q1.mp3',
        status: 'queued',
        progress: 0,
        stage: 'Waiting in queue',
        submittedAt: '2026-04-01T09:20:00Z',
        estimatedCompletion: null,
    },
    {
        id: 'pj3',
        fileName: 'field_interview_042.wav',
        status: 'processing',
        progress: 35,
        stage: 'Uploading audio',
        submittedAt: '2026-04-01T09:22:00Z',
        estimatedCompletion: '2026-04-01T09:40:00Z',
    },
    {
        id: 'pj4',
        fileName: 'training_session_notes.mp3',
        status: 'failed',
        progress: 100,
        stage: 'Error: Unsupported codec',
        submittedAt: '2026-04-01T08:50:00Z',
        estimatedCompletion: null,
    },
    {
        id: 'pj5',
        fileName: 'deposition_audio_001.wav',
        status: 'processing',
        progress: 91,
        stage: 'Finalizing transcript',
        submittedAt: '2026-04-01T08:55:00Z',
        estimatedCompletion: '2026-04-01T09:10:00Z',
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
