// src/services/api.js

import { users, MOCK_FILE_STORE, MOCK_PROCESSING_JOBS, MOCK_USER_PROFILES } from './mock-data';

// Set NEXT_PUBLIC_MOCK_API=true in .env.development to run without the backend.
const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_API === 'true';

// Token helpers
const TOKEN_KEY = 'token';

function setTokenCookie(value) {
    document.cookie = TOKEN_KEY + '=' + value + '; path=/; SameSite=Lax';
}

function clearTokenCookie() {
    document.cookie = TOKEN_KEY + '=; path=/; max-age=0';
}

export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

export function logout() {
    localStorage.removeItem(TOKEN_KEY);
    clearTokenCookie();
}

export function isAuthenticated() {
    return !!getToken();
}

export function getCurrentUser() {
    const token = getToken();
    if (!token) return null;
    try {
        return JSON.parse(atob(token));
    } catch {
        return null;
    }
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
        JSON.stringify({ id: user.id, email: user.email, role: user.role }),
    );

    localStorage.setItem(TOKEN_KEY, fakeToken);
    setTokenCookie(fakeToken);

    return {
        token: fakeToken,
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
        },
    };
}

/*********************************
 * MOCK FILE DATABASE (imported from mock-data.js)
 *********************************/

let _nextMockId = 3;

// Simple auth guard for mock API calls
function requireAuth() {
    if (!isAuthenticated()) {
        throw new Error('Not authenticated');
    }
}

/*********************************
 * USER PROFILE
 *********************************/

export async function fetchUserProfile() {
    requireAuth();
    const currentUser = getCurrentUser();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return MOCK_USER_PROFILES[currentUser?.id] || MOCK_USER_PROFILES.u1;
}

/*********************************
 * FILE API FUNCTIONS
 *********************************/

// Fetch processing jobs
export async function fetchProcessingJobs() {
    requireAuth();

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return MOCK_PROCESSING_JOBS;
    }

    try {
        const response = await fetch('http://localhost:8001/processing-jobs/');
        if (!response.ok) {
            throw new Error(`Failed to fetch processing jobs: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching processing jobs:', error);
        return [];
    }
}

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
            },
            {
                id: Date.now() + 1,
                start: 3.0,
                end: 6.0,
                text: 'This is a placeholder transcript.',
            },
        ];
        const currentUser = getCurrentUser();
        const newFile = {
            id: newId,
            ownerId: currentUser?.id || 'u1',
            ownerName: currentUser?.email || 'Unknown',
            name: file.name,
            audioUrl: URL.createObjectURL(file),
            uploaded_at: new Date().toISOString(),
            rawTranscript: {
                id: 100 + Number(newId),
                audio_file_id: Number(newId),
                transcript_segments: segments,
            },
            edits: [],
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
        return MOCK_FILE_STORE.filter((f) => !f.deleted_at).map(
            ({ id, name, audioUrl, uploaded_at, rawTranscript, duration, wer, absoluteWordErrorRate, totalNumberOfWords, speakerDetection, detectedLanguage, compliance, dataset }) => {
                const fullText = (rawTranscript?.transcript_segments || []).map((s) => s.text).join(' ');
                const words = fullText.split(/\s+/).filter(Boolean);
                const header = words.length > 1
                    ? words.slice(0, 50).join(' ')
                    : fullText.slice(0, 120);
                return {
                    id,
                    name,
                    audioUrl,
                    uploaded_at,
                    transcriptHeader: header,
                    duration: duration || null,
                    wer: wer ?? null,
                    absoluteWordErrorRate: absoluteWordErrorRate ?? null,
                    totalNumberOfWords: totalNumberOfWords ?? null,
                    speakerDetection: speakerDetection ?? null,
                    detectedLanguage: detectedLanguage || null,
                    compliance: compliance || null,
                    dataset: dataset || null,
                };
            },
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
            id: String(audioFile.id),
            name: audioFile.file_name,
            audioUrl: `http://localhost:8000/audio_files/${audioFile.file_name}`,
            transcriptSegments: [],
            uploaded_at: audioFile.uploaded_at,
            transcriptHeader: audioFile.transcript_header || '',
        }));
    } catch (error) {
        console.error('Error fetching submitted files:', error);
        return [];
    }
}

// Fetch soft-deleted files (trash)
export async function fetchTrashedFiles() {
    requireAuth();

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return MOCK_FILE_STORE.filter((f) => f.deleted_at).map(
            ({ id, name, audioUrl, uploaded_at, deleted_at, deleted_by, expires_at, rawTranscript, duration, wer, absoluteWordErrorRate, totalNumberOfWords, speakerDetection, detectedLanguage, compliance, dataset }) => {
                const fullText = (rawTranscript?.transcript_segments || []).map((s) => s.text).join(' ');
                const words = fullText.split(/\s+/).filter(Boolean);
                const header = words.length > 1
                    ? words.slice(0, 50).join(' ')
                    : fullText.slice(0, 120);
                return {
                    id,
                    name,
                    audioUrl,
                    uploaded_at,
                    deleted_at,
                    deleted_by: deleted_by || 'system',
                    expires_at: expires_at || null,
                    transcriptHeader: header,
                    duration: duration || null,
                    wer: wer ?? null,
                    absoluteWordErrorRate: absoluteWordErrorRate ?? null,
                    totalNumberOfWords: totalNumberOfWords ?? null,
                    speakerDetection: speakerDetection ?? null,
                    detectedLanguage: detectedLanguage || null,
                    compliance: compliance || null,
                    dataset: dataset || null,
                };
            },
        );
    }

    return [];
}

// Fetch all files with metadata only (for engineers viewing others' files)
export async function fetchAllFilesMetadata() {
    requireAuth();
    const currentUser = getCurrentUser();

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return MOCK_FILE_STORE.filter((f) => !f.deleted_at).map((f) => {
            const fullText = (f.rawTranscript?.transcript_segments || []).map((s) => s.text).join(' ');
            const words = fullText.split(/\s+/).filter(Boolean);
            const header = words.length > 1
                ? words.slice(0, 50).join(' ')
                : fullText.slice(0, 120);
            return {
                id: f.id,
                name: f.name,
                audioUrl: f.audioUrl || null,
                uploaded_at: f.uploaded_at,
                ownerId: f.ownerId,
                ownerName: f.ownerName,
                isOwned: f.ownerId === currentUser?.id,
                transcriptHeader: header,
                duration: f.duration || null,
                wer: f.wer ?? null,
                absoluteWordErrorRate: f.absoluteWordErrorRate ?? null,
                totalNumberOfWords: f.totalNumberOfWords ?? null,
                speakerDetection: f.speakerDetection ?? null,
                detectedLanguage: f.detectedLanguage || null,
                compliance: f.compliance || null,
                dataset: f.dataset || null,
            };
        });
    }

    // For real API, this would call a different endpoint
    return [];
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
            rawTranscripts.length > 0 ? rawTranscripts[0] : null;

        let edits = [];
        if (rawTranscript) {
            const editsResponse = await fetch(
                `http://localhost:8002/audio-files/${id}/edits`,
            );
            if (editsResponse.ok) {
                const body = await editsResponse.json();
                edits = body.edits || [];
            }
        }

        const fileDetail = {
            id: String(audioFile.id),
            name: audioFile.file_name,
            audioUrl: `http://localhost:8000/audio_files/${audioFile.file_name}`,
            uploaded_at: audioFile.uploaded_at,
            rawTranscript,
            edits,
        };

        return fileDetail;
    } catch (error) {
        console.error('Error fetching file detail:', error);
        return null;
    }
}

// Save the edits array for a file. Edits are word-level operations against
// the raw transcript; the server stores the array verbatim. WER and the
// displayed transcript are derived client-side from raw + edits.
export async function saveEdits(fileId, edits = []) {
    requireAuth();

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const file = MOCK_FILE_STORE.find((f) => f.id === String(fileId));
        if (file) file.edits = edits;
        return { fileId: String(fileId), edits };
    }

    try {
        const response = await fetch(
            `http://localhost:8002/audio-files/${fileId}/edits`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ edits }),
            },
        );
        if (!response.ok) {
            throw new Error(`Failed to save edits: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error saving edits:', error);
        throw error;
    }
}
