// src/services/api.js

// Set REACT_APP_MOCK_API=true in .env.development to run without the backend.
const MOCK_MODE = process.env.REACT_APP_MOCK_API === 'true';

/*********************************
 * MOCK AUTH SECTION
 *********************************/

// Mock users (plain-text for demo only)
const users = [
    {
        id: 'u1',
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
    },
];

// Token helpers
const TOKEN_KEY = 'token';

export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

export function logout() {
    localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated() {
    return !!getToken();
}

// Mock login
export async function login(email, password) {
    const user = users.find(
        (u) => u.email === email && u.password === password,
    );

    if (!user) {
        throw new Error('Invalid email or password');
    }

    // fake JWT
    const fakeToken = btoa(
        JSON.stringify({ id: user.id, email: user.email }),
    );

    localStorage.setItem(TOKEN_KEY, fakeToken);

    return {
        token: fakeToken,
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
        },
    };
}

/*********************************
 * MOCK FILE DATABASE
 *********************************/

let _nextMockId = 3;

const MOCK_FILE_STORE = [
    {
        id: '1',
        name: 'interview_sample.wav',
        audioUrl: null,
        uploaded_at: '2026-03-01T10:00:00Z',
        rawTranscript: {
            id: 101,
            audio_file_id: 1,
            transcript_segments: [
                {
                    id: 1,
                    start: 0.0,
                    end: 3.5,
                    text: 'Hello, welcome to AUSTIN-Lang.',
                    originalText: 'Hello, welcome to AUSTIN-Lang.',
                },
                {
                    id: 2,
                    start: 3.5,
                    end: 7.0,
                    text: 'This is a sample transcription segment.',
                    originalText:
                        'This is a sample transcription segment.',
                },
                {
                    id: 3,
                    start: 7.0,
                    end: 11.0,
                    text: 'You can edit this text to correct any errors.',
                    originalText:
                        'You can edit this text to correct any errors.',
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
                    text: 'Hello, welcome to AUSTIN-Lang.',
                    originalText: 'Hello, welcome to AUSTIN-Lang.',
                },
                {
                    id: 2,
                    start: 3.5,
                    end: 7.0,
                    text: 'This is a sample transcription segment.',
                    originalText:
                        'This is a sample transcription segment.',
                },
                {
                    id: 3,
                    start: 7.0,
                    end: 11.0,
                    text: 'You can edit this text to correct any errors.',
                    originalText:
                        'You can edit this text to correct any errors.',
                },
            ],
        },
        transcriptSegments: [
            {
                id: 1,
                start: 0.0,
                end: 3.5,
                text: 'Hello, welcome to AUSTIN-Lang.',
                originalText: 'Hello, welcome to AUSTIN-Lang.',
            },
            {
                id: 2,
                start: 3.5,
                end: 7.0,
                text: 'This is a sample transcription segment.',
                originalText:
                    'This is a sample transcription segment.',
            },
            {
                id: 3,
                start: 7.0,
                end: 11.0,
                text: 'You can edit this text to correct any errors.',
                originalText:
                    'You can edit this text to correct any errors.',
            },
        ],
    },
    {
        id: '2',
        name: 'lecture_recording.mp3',
        audioUrl: null,
        uploaded_at: '2026-03-02T14:30:00Z',
        rawTranscript: {
            id: 102,
            audio_file_id: 2,
            transcript_segments: [
                {
                    id: 4,
                    start: 0.0,
                    end: 4.0,
                    text: 'Today we will discuss machine learning.',
                    originalText:
                        'Today we will discuss machine learning.',
                },
                {
                    id: 5,
                    start: 4.0,
                    end: 9.0,
                    text: 'Neural networks form the foundation of modern AI.',
                    originalText:
                        'Neural networks form the foundation of modern AI.',
                },
                {
                    id: 6,
                    start: 9.0,
                    end: 14.5,
                    text: 'Training data quality directly impacts model performance.',
                    originalText:
                        'Training data quality directly impacts model performance.',
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
                    text: 'Today we will discuss machine learning.',
                    originalText:
                        'Today we will discuss machine learning.',
                },
                {
                    id: 5,
                    start: 4.0,
                    end: 9.0,
                    text: 'Neural networks form the foundation of modern AI.',
                    originalText:
                        'Neural networks form the foundation of modern AI.',
                },
                {
                    id: 6,
                    start: 9.0,
                    end: 14.5,
                    text: 'Training data quality directly impacts model performance.',
                    originalText:
                        'Training data quality directly impacts model performance.',
                },
            ],
        },
        transcriptSegments: [
            {
                id: 4,
                start: 0.0,
                end: 4.0,
                text: 'Today we will discuss machine learning.',
                originalText:
                    'Today we will discuss machine learning.',
            },
            {
                id: 5,
                start: 4.0,
                end: 9.0,
                text: 'Neural networks form the foundation of modern AI.',
                originalText:
                    'Neural networks form the foundation of modern AI.',
            },
            {
                id: 6,
                start: 9.0,
                end: 14.5,
                text: 'Training data quality directly impacts model performance.',
                originalText:
                    'Training data quality directly impacts model performance.',
            },
        ],
    },
];

// Simple auth guard for mock API calls
function requireAuth() {
    if (!isAuthenticated()) {
        throw new Error('Not authenticated');
    }
}

/*********************************
 * FILE API FUNCTIONS
 *********************************/

// Upload audio file
export async function uploadAudio(file) {
    requireAuth();

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const newId = String(_nextMockId++);
        const segments = [
            {
                id: Date.now(),
                start: 0.0,
                end: 3.0,
                text: 'Mock transcription for ' + file.name,
                originalText: 'Mock transcription for ' + file.name,
            },
            {
                id: Date.now() + 1,
                start: 3.0,
                end: 6.0,
                text: 'This is a placeholder transcript.',
                originalText: 'This is a placeholder transcript.',
            },
        ];
        const newFile = {
            id: newId,
            name: file.name,
            audioUrl: URL.createObjectURL(file),
            uploaded_at: new Date().toISOString(),
            rawTranscript: {
                id: 100 + Number(newId),
                audio_file_id: Number(newId),
                transcript_segments: segments,
            },
            editedTranscript: {
                id: 200 + Number(newId),
                raw_transcript_id: 100 + Number(newId),
                transcript_segments: segments,
            },
            transcriptSegments: segments,
        };
        MOCK_FILE_STORE.push(newFile);
        return newFile;
    }

    try {
        // 1. Call the Orchestrator which handles upload, transcription, and DB registration
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(
            'http://localhost:8001/transcribe/',
            {
                method: 'POST',
                body: formData,
            },
        );

        if (!response.ok) {
            throw new Error(
                `Orchestrator failed: ${response.status}`,
            );
        }

        const data = await response.json();

        // 2. Construct the file object for frontend display
        // Using the real segments returned from Whisper
        const newFile = {
            id: String(data.audio_file_id),
            name: file.name,
            audioUrl: `http://localhost:8000/audio_files/${file.name}`,
            transcriptSegments: data.transcription.segments || [],
        };

        return newFile;
    } catch (error) {
        console.error('Error in uploadAudio workflow:', error);
        throw error;
    }
}

// Fetch all submitted files
export async function fetchSubmittedFiles() {
    requireAuth();

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return MOCK_FILE_STORE.map(
            ({ id, name, audioUrl, uploaded_at }) => ({
                id,
                name,
                audioUrl,
                uploaded_at,
                transcriptSegments: [],
            }),
        );
    }

    try {
        const response = await fetch(
            'http://localhost:8002/audio-files/',
        ); // Call the new backend endpoint
        if (!response.ok) {
            throw new Error(
                `Failed to fetch audio files: ${response.status}`,
            );
        }
        const audioFiles = await response.json();

        // Map the backend AudioFile array to the structure the UI expects
        return audioFiles.map((audioFile) => ({
            id: String(audioFile.id), // Ensure ID is a string for frontend consistency
            name: audioFile.file_name,
            // audioUrl will need to be configured based on where your audio files are served
            // For now, assuming a similar structure as before but targeting port 8000
            audioUrl: `http://localhost:8000/audio_files/${audioFile.file_name}`,
            transcriptSegments: [], // Summary view, full segments fetched in detail
            uploaded_at: audioFile.uploaded_at,
        }));
    } catch (error) {
        console.error('Error fetching submitted files:', error);
        return [];
    }
}

// Fetch one file by ID
export async function fetchFileDetail(id) {
    requireAuth();

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return (
            MOCK_FILE_STORE.find((f) => f.id === String(id)) || null
        );
    }

    try {
        // 1. Fetch AudioFile
        const audioFileResponse = await fetch(
            `http://localhost:8002/audio-files/${id}`,
        );
        if (!audioFileResponse.ok) {
            throw new Error(
                `Failed to fetch audio file detail for ID ${id}: ${audioFileResponse.status}`,
            );
        }
        const audioFile = await audioFileResponse.json();

        // 2. Fetch Raw Transcript(s) for this audio_file_id
        // Assuming one raw transcript per audio file for simplicity
        const rawTranscriptsResponse = await fetch(
            `http://localhost:8002/raw-transcripts/?audio_file_id=${id}`,
        );
        if (!rawTranscriptsResponse.ok) {
            throw new Error(
                `Failed to fetch raw transcripts for audio file ID ${id}: ${rawTranscriptsResponse.status}`,
            );
        }
        const rawTranscripts = await rawTranscriptsResponse.json();
        const rawTranscript =
            rawTranscripts.length > 0 ? rawTranscripts[0] : null; // Get the first one

        let editedTranscript = null;
        if (rawTranscript) {
            // 3. Fetch Edited Transcript(s) for this raw_transcript_id
            // Assuming one edited transcript per raw transcript for simplicity
            const editedTranscriptsResponse = await fetch(
                `http://localhost:8002/edited-transcripts/?raw_transcript_id=${rawTranscript.id}`,
            );
            if (!editedTranscriptsResponse.ok) {
                throw new Error(
                    `Failed to fetch edited transcripts for raw transcript ID ${rawTranscript.id}: ${editedTranscriptsResponse.status}`,
                );
            }
            const editedTranscripts =
                await editedTranscriptsResponse.json();
            editedTranscript =
                editedTranscripts.length > 0 ?
                    editedTranscripts[0]
                :   null; // Get the first one
        }

        // Combine all data into the frontend's expected file structure
        const fileDetail = {
            id: String(audioFile.id),
            name: audioFile.file_name,
            audioUrl: `http://localhost:8000/audio_files/${audioFile.file_name}`, // Adjust as per your audio serving setup
            uploaded_at: audioFile.uploaded_at,
            rawTranscript: rawTranscript, // Include raw transcript data
            editedTranscript: editedTranscript, // Include edited transcript data
            transcriptSegments:
                editedTranscript ?
                    editedTranscript.transcript_segments
                : rawTranscript ? rawTranscript.transcript_segments
                : [],
        };

        return fileDetail;
    } catch (error) {
        console.error('Error fetching file detail:', error);
        return null;
    }
}

// Update transcript
export async function updateTranscript(
    editedTranscriptId,
    rawTranscriptId,
    newSegments = [],
) {
    requireAuth();

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const file = MOCK_FILE_STORE.find(
            (f) =>
                f.editedTranscript &&
                f.editedTranscript.id === editedTranscriptId,
        );
        if (file) {
            file.editedTranscript.transcript_segments = newSegments;
            file.transcriptSegments = newSegments;
        }
        return {
            id: editedTranscriptId,
            raw_transcript_id: rawTranscriptId,
            transcript_segments: newSegments,
        };
    }

    try {
        const processedSegments = newSegments.map((segment) => ({
            ...segment,
            id:
                Number.isInteger(Number(segment.id)) ?
                    Number(segment.id)
                :   null, // Convert to int or null
        }));

        const response = await fetch(
            `http://localhost:8002/edited-transcripts/${editedTranscriptId}`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    raw_transcript_id: rawTranscriptId,
                    transcript_segments: processedSegments,
                }),
            },
        );

        if (!response.ok) {
            throw new Error(
                `Failed to update transcript: ${response.status}`,
            );
        }

        return await response.json();
    } catch (error) {
        console.error('Error updating transcript:', error);
        throw error;
    }
}
