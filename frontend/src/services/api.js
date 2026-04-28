// src/services/api.js
//
// Client-side API surface with two modes, controlled by NEXT_PUBLIC_MOCK_API:
//
//   mock mode (true):
//     - reads/writes use in-memory fixtures from mock-data.js
//     - login accepts the seeded mock users with their plaintext passwords
//       and sets a readable 'token' cookie so the middleware lets pages through
//     - no server round-trips, no DB required
//
//   real mode (false, default):
//     - reads/writes hit in-process Next.js route handlers under
//       src/app/{auth,api}/** which are backed by SQLite (users.db + platform.db)
//     - auth is an HttpOnly JWT cookie signed server-side
//
// Switch with the `dev:mock` / `dev:real` scripts in package.json. Because
// NEXT_PUBLIC_* is inlined at build time, changing modes requires a rebuild.

import { users, MOCK_FILE_STORE, MOCK_PROCESSING_JOBS, MOCK_USER_PROFILES } from './mock-data';
import { addReviewNotification, addReviewActionNotification } from './notifications';
import { assertTransition } from '../lib/statusFlow';
import { http, readCsrfToken } from './http';
import { pseudonymiseSegments, triggerPseudonymisationRun } from './pseudonymisation';
import { refreshMetricsCache } from './metrics';
import { applyEdits, recomputeSegmentEdits } from '../lib/transcriptEdits';

// Fire-and-forget; the metrics service caches for 60s so invalidating after
// an edit/approve keeps the dashboard honest. Failures are non-fatal.
function invalidateMetricsCache() {
    refreshMetricsCache().catch((err) => {
        console.warn('metrics cache refresh failed', err);
    });
}

const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_API === 'true';

// ── Auth helpers ────────────────────────────────────────────────────────────
// In both modes we keep a synchronous sessionStorage cache of the currently
// authenticated user so pages that expect getCurrentUser() to return
// immediately (there are many) still work. In real mode the HttpOnly JWT
// cookie is the actual source of truth; in mock mode we also drop a
// non-HttpOnly 'token' cookie so the proxy middleware lets pages through.

const USER_CACHE_KEY = 'austin.currentUser';
const MOCK_COOKIE_NAME = 'token';

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

function setMockCookie(userId) {
    if (typeof document === 'undefined') return;
    document.cookie = `${MOCK_COOKIE_NAME}=MOCK-${userId}; path=/; SameSite=Lax`;
}

function clearMockCookie() {
    if (typeof document === 'undefined') return;
    document.cookie = `${MOCK_COOKIE_NAME}=; path=/; max-age=0`;
}

export async function login(email, password) {
    if (MOCK_MODE) {
        const user = users.find((u) => u.email === email && u.password === password);
        if (!user) throw new Error('Invalid email or password');
        const shape = { id: user.id, email: user.email, name: user.name, role: user.role };
        setMockCookie(user.id);
        setCachedUser(shape);
        return { user: shape };
    }
    const user = await http.post('/auth/login', { email, password });
    setCachedUser(user);
    return { user };
}

export async function logout() {
    if (MOCK_MODE) {
        clearMockCookie();
        setCachedUser(null);
        return;
    }
    try {
        await http.post('/auth/logout');
    } catch (err) {
        console.warn('logout: server clear failed, proceeding with local clear', err);
    }
    setCachedUser(null);
}

// Called on app load to populate the sync cache.
export async function bootstrapAuth() {
    if (MOCK_MODE) {
        return getCurrentUser();
    }
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

// Legacy shim for call sites that still ask for a raw token.
export function getToken() {
    return isAuthenticated() ? 'cookie' : null;
}

function requireAuth() {
    if (!isAuthenticated()) throw new Error('Not authenticated');
}

// Helpers used only by the mock branches below.
let _nextMockId = 3;

function listShapeFromMockFile(f) {
    const fullText = (f.rawTranscript?.transcript_segments || []).map((s) => s.text).join(' ');
    const words = fullText.split(/\s+/).filter(Boolean);
    const header = words.length > 1 ? words.slice(0, 50).join(' ') : fullText.slice(0, 120);
    return {
        id: f.id,
        name: f.name,
        audioUrl: f.audioUrl,
        uploaded_at: f.uploaded_at,
        transcriptHeader: header,
        duration: f.duration || null,
        wer: f.wer ?? null,
        absoluteWordErrorRate: f.absoluteWordErrorRate ?? null,
        totalNumberOfWords: f.totalNumberOfWords ?? null,
        speakerDetection: f.speakerDetection ?? null,
        detectedLanguage: f.detectedLanguage || null,
        compliance: f.compliance || null,
        dataset: f.dataset || null,
        status: f.status || 'needs action',
        reviewerId: f.reviewerId || null,
        submittedForReviewAt: f.submittedForReviewAt || null,
    };
}

// ── User profile ───────────────────────────────────────────────────────────
export async function fetchUserProfile() {
    requireAuth();
    if (MOCK_MODE) {
        const currentUser = getCurrentUser();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return MOCK_USER_PROFILES[currentUser?.id] || MOCK_USER_PROFILES.u1;
    }
    return http.get('/api/user-profile');
}

// ── Processing queue ───────────────────────────────────────────────────────
export async function fetchProcessingJobs() {
    requireAuth();
    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return MOCK_PROCESSING_JOBS;
    }
    try {
        return await http.get('/api/processing-jobs');
    } catch (error) {
        console.error('Error fetching processing jobs:', error);
        return [];
    }
}

// ── Upload ─────────────────────────────────────────────────────────────────
export async function fetchAdapters() {
    if (MOCK_MODE) {
        return { adapters: ['base', 'meralion_v1'] };
    }
    try {
        return await http.get('/api/adapters');
    } catch (err) {
        console.warn('fetchAdapters: falling back to base only', err);
        return { adapters: ['base'] };
    }
}

export async function uploadAudio(file, { domain, language } = {}) {
    requireAuth();

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const newId = String(_nextMockId++);
        const segments = [
            { id: Date.now(),     start: 0.0, end: 3.0, text: 'Mock transcription for ' + file.name },
            { id: Date.now() + 1, start: 3.0, end: 6.0, text: 'This is a placeholder transcript.' },
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

    // Real mode posts to the Next.js /api/upload route. That route proxies
    // the audio to the transcription orchestrator and mirrors the resulting
    // rows into platform.db, stashing the backend transcript IDs so later
    // edits can co-write to poc.db at :8002 (where the retraining pipeline
    // reads from).
    try {
        const formData = new FormData();
        formData.append('file', file);
        if (domain && domain !== 'base') formData.append('domain', domain);
        if (language) formData.append('language', language);
        const csrf = readCsrfToken();
        const response = await fetch('/api/upload', {
            method: 'POST',
            credentials: 'include',
            headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
            body: formData,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Upload failed: ${response.status} ${text}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error in uploadAudio workflow:', error);
        throw error;
    }
}

// ── Audio files ────────────────────────────────────────────────────────────
export async function fetchSubmittedFiles() {
    requireAuth();
    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return MOCK_FILE_STORE.filter((f) => !f.deleted_at).map(listShapeFromMockFile);
    }
    return http.get('/api/audio-files?scope=submitted');
}

export async function fetchTrashedFiles() {
    requireAuth();
    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return MOCK_FILE_STORE.filter((f) => f.deleted_at).map((f) => ({
            ...listShapeFromMockFile(f),
            deleted_at: f.deleted_at,
            deleted_by: f.deleted_by || 'system',
            expires_at: f.expires_at || null,
        }));
    }
    return http.get('/api/audio-files?scope=trashed');
}

export async function fetchAllFilesMetadata() {
    requireAuth();
    const currentUser = getCurrentUser();

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return MOCK_FILE_STORE.filter((f) => !f.deleted_at).map((f) => ({
            ...listShapeFromMockFile(f),
            ownerId: f.ownerId,
            ownerName: f.ownerName,
            isOwned: f.ownerId === currentUser?.id,
        }));
    }

    const rows = await http.get('/api/audio-files?scope=all');
    return rows.map((r) => ({ ...r, isOwned: r.ownerId === currentUser?.id }));
}

export async function fetchFileDetail(id) {
    requireAuth();
    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return MOCK_FILE_STORE.find((f) => f.id === String(id)) || null;
    }
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
    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const file = MOCK_FILE_STORE.find((f) => f.id === String(fileId));
        if (file) file.edits = edits;
        return { fileId: String(fileId), edits };
    }
    const result = await http.put(`/api/audio-files/${encodeURIComponent(fileId)}/edits`, { edits });
    invalidateMetricsCache();
    return result;
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

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const file = MOCK_FILE_STORE.find((f) => f.id === String(fileId));
        if (!file) throw new Error('File not found');
        assertTransition(file.status || 'needs action', 'in review');

        const pseudoResult = await runPseudonymisationForFile(file, currentUser);
        if (pseudoResult.warning) {
            file.pseudonymisationWarning = pseudoResult.warning;
        } else {
            file.pseudonymisationWarning = null;
            file.edits = pseudoResult.edits;
            file.pseudonymisationApplied = pseudoResult.summary;
        }

        file.status = 'in review';
        file.reviewerId = reviewerId;
        file.submittedForReviewAt = new Date().toISOString();
        file.submittedBy = currentUser?.id;

        const submitterProfile = MOCK_USER_PROFILES[currentUser?.id];
        const submitterName = submitterProfile?.name || currentUser?.email || 'A user';
        addReviewNotification({
            fileId: String(fileId),
            fileName: file.name,
            recipientId: reviewerId,
            submittedBy: currentUser?.id,
            submitterName,
        });

        return { fileId: String(fileId), status: 'in review', reviewerId };
    }

    const file = await fetchFileDetail(fileId);
    if (!file) throw new Error('File not found');
    assertTransition(file.status || 'needs action', 'in review');

    const pseudoResult = await runPseudonymisationForFile(file, currentUser);
    if (!pseudoResult.warning) await saveEdits(fileId, pseudoResult.edits);

    const result = await http.post(
        `/api/audio-files/${encodeURIComponent(fileId)}/submit-for-review`,
        { reviewerId },
    );

    // Fire off a stateful pseudonymisation run so the reviewer has spans to
    // decide on when they open the file. Fire-and-forget: the reviewer panel
    // polls anyway, and a failed run shouldn't block the submit.
    triggerPseudonymisationRun(fileId, reviewerId).catch((err) =>
        console.warn('[pseudonymisation] auto-run failed:', err?.message),
    );

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

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const file = MOCK_FILE_STORE.find((f) => f.id === String(fileId));
        if (!file) throw new Error('File not found');
        assertTransition(file.status, 'completed');
        file.status = 'completed';
        file.reviewedBy = currentUser?.id;
        file.reviewedAt = new Date().toISOString();

        if (file.submittedBy) {
            const reviewerProfile = MOCK_USER_PROFILES[currentUser?.id];
            const reviewerName = reviewerProfile?.name || currentUser?.email || 'A reviewer';
            addReviewActionNotification({
                fileId: String(fileId),
                fileName: file.name,
                recipientId: file.submittedBy,
                reviewerName,
                action: 'approved',
            });
        }

        return { fileId: String(fileId), status: 'completed' };
    }

    const file = await fetchFileDetail(fileId);
    if (!file) throw new Error('File not found');
    assertTransition(file.status || 'in review', 'completed');

    const result = await http.post(`/api/audio-files/${encodeURIComponent(fileId)}/approve`);
    invalidateMetricsCache();

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

    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const file = MOCK_FILE_STORE.find((f) => f.id === String(fileId));
        if (!file) throw new Error('File not found');
        assertTransition(file.status, 'needs action');
        file.status = 'needs action';
        file.reviewerId = null;
        file.submittedForReviewAt = null;
        file.changeRequestReason = reason || null;
        file.changeRequestedBy = currentUser?.id;
        file.changeRequestedAt = new Date().toISOString();

        if (file.submittedBy) {
            const reviewerProfile = MOCK_USER_PROFILES[currentUser?.id];
            const reviewerName = reviewerProfile?.name || currentUser?.email || 'A reviewer';
            addReviewActionNotification({
                fileId: String(fileId),
                fileName: file.name,
                recipientId: file.submittedBy,
                reviewerName,
                action: 'needs action',
                reason: reason || null,
            });
        }

        return { fileId: String(fileId), status: 'needs action' };
    }

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

// ── Transcript versions (slice 2 of transcript-versioning-plan.md) ─────────

export async function fetchVersions(fileId) {
    requireAuth();
    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const file = MOCK_FILE_STORE.find((f) => f.id === String(fileId));
        return { fileId: String(fileId), versions: file?.versions || [] };
    }
    return http.get(`/api/audio-files/${encodeURIComponent(fileId)}/versions`);
}

export async function fetchVersion(fileId, versionNo) {
    requireAuth();
    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const file = MOCK_FILE_STORE.find((f) => f.id === String(fileId));
        const version = (file?.versions || []).find((v) => v.versionNo === Number(versionNo));
        if (!version) throw Object.assign(new Error('Version not found'), { status: 404 });
        return { fileId: String(fileId), version };
    }
    return http.get(
        `/api/audio-files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionNo)}`,
    );
}

export async function diffVersions(fileId, versionNoA, versionNoB) {
    requireAuth();
    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const file = MOCK_FILE_STORE.find((f) => f.id === String(fileId));
        const versions = file?.versions || [];
        const a = versions.find((v) => v.versionNo === Number(versionNoA));
        const b = versions.find((v) => v.versionNo === Number(versionNoB));
        if (!a || !b) throw Object.assign(new Error('Version not found'), { status: 404 });
        const keyOf = (e) =>
            `${e?.segmentId ?? ''}:${e?.wordIndex ?? ''}:${e?.op ?? ''}:${e?.before ?? ''}->${e?.after ?? ''}`;
        const aMap = new Map((a.edits || []).map((e) => [keyOf(e), e]));
        const bMap = new Map((b.edits || []).map((e) => [keyOf(e), e]));
        const onlyInA = [], onlyInB = [], shared = [];
        for (const [k, e] of aMap) (bMap.has(k) ? shared : onlyInA).push(e);
        for (const [k, e] of bMap) if (!aMap.has(k)) onlyInB.push(e);
        return {
            fileId: String(fileId),
            from: { versionNo: Number(versionNoA), editCount: (a.edits || []).length },
            to:   { versionNo: Number(versionNoB), editCount: (b.edits || []).length },
            onlyInA, onlyInB, shared,
        };
    }
    return http.get(
        `/api/audio-files/${encodeURIComponent(fileId)}` +
        `/versions/${encodeURIComponent(versionNoA)}/diff/${encodeURIComponent(versionNoB)}`,
    );
}

// Restore version `versionNo`. When the file has a non-empty draft, the
// server returns 409 with `code: 'DIRTY_DRAFT'` unless `existingDraft`
// is `'save'` (freeze the draft) or `'discard'` (delete it). Caller is
// expected to surface the 409 to the user and re-call with the choice.
export async function restoreVersion(fileId, versionNo, { existingDraft = null } = {}) {
    requireAuth();
    if (MOCK_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const file = MOCK_FILE_STORE.find((f) => f.id === String(fileId));
        if (!file) throw Object.assign(new Error('File not found'), { status: 404 });
        const versions = file.versions || (file.versions = []);
        const source = versions.find((v) => v.versionNo === Number(versionNo));
        if (!source) throw Object.assign(new Error('Version not found'), { status: 404 });

        const draftIdx = versions.findIndex((v) => v.isCurrent);
        const dirty = draftIdx >= 0 && (versions[draftIdx].edits || []).length > 0;
        if (dirty && !existingDraft) {
            const err = new Error('A draft with unsaved edits exists.');
            err.status = 409;
            err.body = {
                detail: err.message, code: 'DIRTY_DRAFT',
                draftVersionNo: versions[draftIdx].versionNo,
                draftEditCount: (versions[draftIdx].edits || []).length,
            };
            throw err;
        }
        let disposition = null;
        if (draftIdx >= 0) {
            if (existingDraft === 'save') {
                versions[draftIdx] = { ...versions[draftIdx], isCurrent: false, frozenAt: new Date().toISOString() };
                disposition = 'saved';
            } else {
                versions.splice(draftIdx, 1);
                disposition = dirty ? 'discarded' : 'discarded-empty';
            }
        }

        const nextNo = (versions.reduce((m, v) => Math.max(m, v.versionNo), 0)) + 1;
        const restored = {
            id: nextNo,
            versionNo: nextNo,
            label: 'restored',
            isDraft: true,
            isCurrent: true,
            createdAt: new Date().toISOString(),
            createdBy: getCurrentUser()?.id || 'system',
            createdByName: getCurrentUser()?.name || 'System',
            frozenAt: null,
            parentVersionNo: source.versionNo,
            note: null,
            edits: [...(source.edits || [])],
        };
        versions.push(restored);
        // Also surface as the file's working edits.
        file.edits = [...restored.edits];
        return {
            fileId: String(fileId),
            newVersionNo: nextNo,
            restoredFromVersionNo: source.versionNo,
            existingDraftDisposition: disposition,
        };
    }
    return http.post(
        `/api/audio-files/${encodeURIComponent(fileId)}` +
        `/versions/${encodeURIComponent(versionNo)}/restore`,
        { existingDraft },
    );
}
