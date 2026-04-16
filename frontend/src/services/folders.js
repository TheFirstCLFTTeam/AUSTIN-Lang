// In-memory folder store for file organisation.
// Each role maps to a file-org group. The persona for that role is the control member.
// Control members create/rename/delete folders and manage requests.
// Normal members move files into folders and submit folder requests.

import { MOCK_FILE_STORE } from './mock-data';

// ─── Group mapping ─────────────────────────────────────────────────────────────

const ROLE_TO_GROUP = {
    generic: 'user-file-org',
    engineer: 'engineer-file-org',
    reviewer: 'reviewer-file-org',
    admin: 'admin-file-org',
};

// Each group's control member userId
const GROUP_CONTROL_MEMBERS = {
    'user-file-org': 'u1',
    'engineer-file-org': 'u2',
    'admin-file-org': 'u3',
    'reviewer-file-org': 'u4',
};

export function getGroupIdForRole(role) {
    return ROLE_TO_GROUP[role] || 'user-file-org';
}

export function isControlMember(userId, groupId) {
    return GROUP_CONTROL_MEMBERS[groupId] === userId;
}

export function getControlMemberForGroup(groupId) {
    return GROUP_CONTROL_MEMBERS[groupId] || null;
}

// ─── In-memory stores ──────────────────────────────────────────────────────────

let _folders = [];
let _folderFiles = [];   // { folderId, fileId, addedBy, addedAt }
let _folderRequests = [];
let _nextFolderId = 1;
let _nextRequestId = 1;
const _listeners = new Set();

function notify() {
    const state = {
        folders: [..._folders],
        folderFiles: [..._folderFiles],
        folderRequests: [..._folderRequests],
    };
    _listeners.forEach((fn) => fn(state));
}

// ─── Seed data ─────────────────────────────────────────────────────────────────
// Pre-create the 4 existing dataset folders as system folders so files
// with the `dataset` field continue to work.

const SYSTEM_DATASET_FOLDERS = [
    { datasetId: 'mixed', name: 'AlienKevin-mixed_cantonese_and_english_speech' },
    { datasetId: 'wordshk', name: 'AlienKevin-wordshk_cantonese_speech' },
    { datasetId: 'alvanlii', name: 'alvanlii-cantonese-youtube' },
    { datasetId: 'edmund', name: 'edmundchan70-Cantonese_fine_tune' },
];

SYSTEM_DATASET_FOLDERS.forEach((ds) => {
    _folders.push({
        id: `sys-${ds.datasetId}`,
        name: ds.name,
        groupId: null,           // system folders visible to all groups
        datasetId: ds.datasetId, // links to the legacy `file.dataset` field
        description: `Dataset: ${ds.datasetId}`,
        createdBy: 'system',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        isSystem: true,
    });
});

// ─── Folder CRUD ───────────────────────────────────────────────────────────────

export function getFoldersForGroup(groupId) {
    // Return group-specific folders + system folders
    return _folders.filter((f) => f.groupId === groupId || f.isSystem);
}

export function getFolderById(folderId) {
    return _folders.find((f) => f.id === folderId) || null;
}

export function createFolder({ name, groupId, description, createdBy }) {
    if (!isControlMember(createdBy, groupId)) return null;
    const now = new Date().toISOString();
    const folder = {
        id: `folder-${_nextFolderId++}`,
        name,
        groupId,
        datasetId: null,
        description: description || null,
        createdBy,
        createdAt: now,
        updatedAt: now,
        isSystem: false,
    };
    _folders.push(folder);
    notify();
    return folder;
}

export function renameFolder(folderId, newName, userId) {
    const folder = _folders.find((f) => f.id === folderId);
    if (!folder || folder.isSystem) return false;
    if (!isControlMember(userId, folder.groupId)) return false;
    folder.name = newName;
    folder.updatedAt = new Date().toISOString();
    notify();
    return true;
}

export function deleteFolder(folderId, userId) {
    const folder = _folders.find((f) => f.id === folderId);
    if (!folder || folder.isSystem) return false;
    if (!isControlMember(userId, folder.groupId)) return false;
    _folders = _folders.filter((f) => f.id !== folderId);
    _folderFiles = _folderFiles.filter((ff) => ff.folderId !== folderId);
    notify();
    return true;
}

// ─── Folder ↔ File membership ──────────────────────────────────────────────────

export function getFilesInFolder(folderId) {
    return new Set(_folderFiles.filter((ff) => ff.folderId === folderId).map((ff) => ff.fileId));
}

export function getFolderIdsForFile(fileId) {
    return _folderFiles.filter((ff) => ff.fileId === fileId).map((ff) => ff.folderId);
}

export function addFileToFolder(folderId, fileId, userId) {
    if (_folderFiles.some((ff) => ff.folderId === folderId && ff.fileId === fileId)) return false;
    _folderFiles.push({
        folderId,
        fileId,
        addedBy: userId,
        addedAt: new Date().toISOString(),
    });
    notify();
    return true;
}

export function removeFileFromFolder(folderId, fileId) {
    const before = _folderFiles.length;
    _folderFiles = _folderFiles.filter((ff) => !(ff.folderId === folderId && ff.fileId === fileId));
    if (_folderFiles.length !== before) {
        notify();
        return true;
    }
    return false;
}

// ─── Move files (mock backend) ─────────────────────────────────────────────────
// Simulates a backend API call that moves files into a folder.
// Mutates the canonical MOCK_FILE_STORE objects so the change persists for the
// session. When the real backend exists, this will be replaced by a fetch() call
// that updates a SQLite database.

export function moveFilesToFolder(folderId, fileIds, userId) {
    const folder = _folders.find((f) => f.id === folderId);
    if (!folder) return { moved: 0 };

    let moved = 0;
    for (const fileId of fileIds) {
        const storeFile = MOCK_FILE_STORE.find((f) => f.id === fileId);
        if (!storeFile) continue;

        if (folder.isSystem && folder.datasetId) {
            // Moving into a system (dataset) folder — set the dataset field
            if (storeFile.dataset === folder.datasetId) continue; // already there
            storeFile.dataset = folder.datasetId;
            // Remove from any custom folder memberships
            _folderFiles = _folderFiles.filter((ff) => ff.fileId !== fileId);
        } else {
            // Moving into a custom folder
            // Clear dataset so file no longer appears in a system folder
            storeFile.dataset = null;
            // Remove from all other custom folders (a file lives in one folder)
            _folderFiles = _folderFiles.filter((ff) => ff.fileId !== fileId);
            // Add to target folder
            _folderFiles.push({
                folderId,
                fileId,
                addedBy: userId,
                addedAt: new Date().toISOString(),
            });
        }
        moved++;
    }

    if (moved > 0) notify();
    return { moved };
}

// ─── Folder requests ───────────────────────────────────────────────────────────

export function submitFolderRequest({ groupId, requestedBy, requesterName, suggestedName, reason }) {
    const request = {
        id: `req-${_nextRequestId++}`,
        groupId,
        requestedBy,
        requesterName,
        suggestedName,
        reason,
        status: 'pending',
        respondedBy: null,
        respondedAt: null,
        denyReason: null,
        createdAt: new Date().toISOString(),
    };
    _folderRequests.push(request);
    notify();
    return request;
}

export function getPendingRequests(groupId) {
    return _folderRequests.filter((r) => r.groupId === groupId && r.status === 'pending');
}

export function getAllRequests(groupId) {
    return _folderRequests.filter((r) => r.groupId === groupId);
}

export function approveRequest(requestId, userId) {
    const req = _folderRequests.find((r) => r.id === requestId);
    if (!req || req.status !== 'pending') return null;
    if (!isControlMember(userId, req.groupId)) return null;
    req.status = 'approved';
    req.respondedBy = userId;
    req.respondedAt = new Date().toISOString();
    // Create the folder
    const folder = {
        id: `folder-${_nextFolderId++}`,
        name: req.suggestedName,
        groupId: req.groupId,
        datasetId: null,
        description: `Requested by ${req.requesterName}: ${req.reason}`,
        createdBy: userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isSystem: false,
    };
    _folders.push(folder);
    notify();
    return folder;
}

export function denyRequest(requestId, userId, reason) {
    const req = _folderRequests.find((r) => r.id === requestId);
    if (!req || req.status !== 'pending') return false;
    if (!isControlMember(userId, req.groupId)) return false;
    req.status = 'denied';
    req.respondedBy = userId;
    req.respondedAt = new Date().toISOString();
    req.denyReason = reason || null;
    notify();
    return true;
}

// ─── Subscribe ─────────────────────────────────────────────────────────────────

export function subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}
