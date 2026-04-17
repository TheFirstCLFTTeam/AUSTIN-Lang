// src/services/api.js
//
// Client-side API surface. All persistent reads/writes go through the
// in-process Next.js route handlers under src/app/api/**/route.js, which are
// backed by SQLite (`users.db` + `platform.db`). Auth uses an HttpOnly JWT
// cookie — the sync `getCurrentUser()` cache exists only so that existing
// synchronous call sites keep working after login.

import { addReviewNotification, addReviewActionNotification } from './notifications';
import { assertTransition } from '../lib/statusFlow';
import { http } from './http';
import { pseudonymiseSegments } from './pseudonymisation';
import { applyEdits, recomputeSegmentEdits } from '../lib/transcriptEdits';

// ── Auth helpers ────────────────────────────────────────────────────────────
// The JWT itself lives in an HttpOnly cookie issued by POST /auth/login and is
// invisible to browser JS. For sync compatibility with existing call sites we
// cache the authenticated user profile in sessionStorage. The cache is
// populated by:
//   1. `login()` after a successful POST /auth/login
//   2. `bootstrapAuth()` on dashboard load (calls GET /auth/me via cookie)
//   3. `setCachedUser()` from the server-rendered AuthHydrator component.
// Cache shape: `{ id, email, name, role }`.

const USER_CACHE_KEY = 'austin.currentUser';

export function setCachedUser(user) {
    if (typeof window === 'undefined') return;
    if (user) {
        sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    } else {
        sessionStorage.removeItem(USER_CACHE_KEY);
    }
}

export function getCurrentUser() {
    if (typeof window === 'undefined') return null;
    const raw = sessionStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function isAuthenticated() {
    return !!getCurrentUser();
}

export async function login(email, password) {
    const user = await http.post('/auth/login', { email, password });
    setCachedUser(user);
    return { user };
}

export async function logout() {
    try {
        await http.post('/auth/logout');
    } catch (err) {
        console.warn('logout: server clear failed, proceeding with local clear', err);
    }
    setCachedUser(null);
}

export async function bootstrapAuth() {
    try {
        const user = await http.get('/auth/me');
        setCachedUser(user);
        return user;
    } catch (err) {
        if (err?.status === 401) {
            setCachedUser(null);
            return null;
        }
        throw err;
    }
}

// Legacy shim — some call sites still call `getToken()`. With HttpOnly cookies
// the browser can't read the JWT, so we return a sentinel based on presence of
// a cached user. Anything that inspected the old base64 payload should be
// switched to `getCurrentUser()` instead.
export function getToken() {
    return isAuthenticated() ? 'cookie' : null;
}

function requireAuth() {
    if (!isAuthenticated()) throw new Error('Not authenticated');
}

// ── User profile ───────────────────────────────────────────────────────────
export async function fetchUserProfile() {
    requireAuth();
    return http.get('/api/user-profile');
}

// ── Processing queue ──────────────────────────────────────────────────────
export async function fetchProcessingJobs() {
    requireAuth();
    try {
        return await http.get('/api/processing-jobs');
    } catch (error) {
        console.error('Error fetching processing jobs:', error);
        return [];
    }
}

// ── Upload ─────────────────────────────────────────────────────────────────
// Integrated path talks to the external transcription orchestrator at
// :8001. There is no DB-backed fallback — containerize `pseudonymization/` +
// `backend/*` and run them alongside the frontend (`docker compose up`) for
// the upload path to work.
export async function uploadAudio(file) {
    requireAuth();
    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('http://localhost:8001/transcribe/', {
            method: 'POST',
            body: formData,
        });
        if (!response.ok) {
            throw new Error(`Orchestrator failed: ${response.status}`);
        }
        const data = await response.json();
        return {
            id: String(data.audio_file_id),
            name: file.name,
            audioUrl: `http://localhost:8000/audio_files/${file.name}`,
            transcriptSegments: data.transcription.segments || [],
        };
    } catch (error) {
        console.error('Error in uploadAudio workflow:', error);
        throw error;
    }
}

// ── Audio files ────────────────────────────────────────────────────────────
export async function fetchSubmittedFiles() {
    requireAuth();
    return http.get('/api/audio-files?scope=submitted');
}

export async function fetchTrashedFiles() {
    requireAuth();
    return http.get('/api/audio-files?scope=trashed');
}

export async function fetchAllFilesMetadata() {
    requireAuth();
    const currentUser = getCurrentUser();
    const rows = await http.get('/api/audio-files?scope=all');
    return rows.map((r) => ({ ...r, isOwned: r.ownerId === currentUser?.id }));
}

export async function fetchFileDetail(id) {
    requireAuth();
    try {
        return await http.get(`/api/audio-files/${encodeURIComponent(id)}`);
    } catch (err) {
        if (err?.status === 404) return null;
        console.error('Error fetching file detail:', err);
        return null;
    }
}

export async function saveEdits(fileId, edits = []) {
    requireAuth();
    return http.put(`/api/audio-files/${encodeURIComponent(fileId)}/edits`, { edits });
}

// ── Workflow: submit / approve / request-changes ───────────────────────────

async function runPseudonymisationForFile(file, currentUser) {
    const rawSegments = file?.rawTranscript?.transcript_segments || [];
    if (rawSegments.length === 0) {
        return { edits: file.edits || [], summary: { spansCount: 0, segments: 0 } };
    }

    const applied = applyEdits(rawSegments, file.edits || []);
    const payload = applied.map((s) => ({ id: String(s.id), text: s.text || '' }));

    let result;
    try {
        result = await pseudonymiseSegments(payload);
    } catch (err) {
        console.warn('[pseudonymisation] skipped — orchestrator failed:', err);
        return {
            warning: {
                reason: err?.message || 'Unknown error',
                attemptedAt: new Date().toISOString(),
                attemptedBy: currentUser?.id || null,
            },
        };
    }

    const maskedById = new Map(
        (result.maskedSegments || []).map((m) => [String(m.id), m.text]),
    );

    let nextEdits = file.edits || [];
    const editedAt = new Date().toISOString();
    for (const seg of applied) {
        const masked = maskedById.get(String(seg.id));
        if (masked == null || masked === seg.text) continue;
        nextEdits = recomputeSegmentEdits(
            nextEdits, seg.id, seg.originalText, masked,
            { editedAt, editedBy: 'system' },
        );
    }

    return {
        edits: nextEdits,
        summary: {
            spansCount: result.spansCount,
            segments: maskedById.size,
            modelVersion: result.modelVersion,
            labelSetVersion: result.labelSetVersion,
            appliedAt: editedAt,
        },
    };
}

export async function submitForReview(fileId, reviewerId) {
    requireAuth();
    const currentUser = getCurrentUser();

    // Fetch detail first so we can run pseudonymisation client-side before
    // persisting the status flip.
    const file = await fetchFileDetail(fileId);
    if (!file) throw new Error('File not found');
    assertTransition(file.status || 'needs action', 'in review');

    const pseudoResult = await runPseudonymisationForFile(file, currentUser);
    if (!pseudoResult.warning) {
        await saveEdits(fileId, pseudoResult.edits);
    }

    const result = await http.post(
        `/api/audio-files/${encodeURIComponent(fileId)}/submit-for-review`,
        { reviewerId },
    );

    // Notifications live in the in-memory notifications service — no DB
    // backing yet, so we fire here after the server confirms the transition.
    addReviewNotification({
        fileId: String(fileId),
        fileName: file.name,
        recipientId: reviewerId,
        submittedBy: currentUser?.id,
        submitterName: currentUser?.name || currentUser?.email || 'A user',
    });

    return { fileId: String(fileId), status: 'in review', reviewerId, ...result };
}

export async function approveTranscript(fileId) {
    requireAuth();
    const currentUser = getCurrentUser();

    const file = await fetchFileDetail(fileId);
    if (!file) throw new Error('File not found');
    assertTransition(file.status || 'in review', 'completed');

    const result = await http.post(
        `/api/audio-files/${encodeURIComponent(fileId)}/approve`,
    );

    // Best-effort: notify the original submitter via in-memory notifications.
    addReviewActionNotification({
        fileId: String(fileId),
        fileName: file.name,
        recipientId: file.ownerId,
        reviewerName: currentUser?.name || currentUser?.email || 'A reviewer',
        action: 'approved',
    });

    return { fileId: String(fileId), status: 'completed', ...result };
}

export async function requestChanges(fileId, reason) {
    requireAuth();
    const currentUser = getCurrentUser();

    const file = await fetchFileDetail(fileId);
    if (!file) throw new Error('File not found');
    assertTransition(file.status || 'in review', 'needs action');

    const result = await http.post(
        `/api/audio-files/${encodeURIComponent(fileId)}/request-changes`,
        { reason: reason || null },
    );

    addReviewActionNotification({
        fileId: String(fileId),
        fileName: file.name,
        recipientId: file.ownerId,
        reviewerName: currentUser?.name || currentUser?.email || 'A reviewer',
        action: 'needs action',
        reason: reason || null,
    });

    return { fileId: String(fileId), status: 'needs action', ...result };
}
