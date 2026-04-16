// In-memory notification store.
// Tracks which jobs a user is watching and stores notifications
// when watched jobs complete or fail.

let _watchedJobs = new Map(); // jobId -> { jobId, jobName, userId, watchedAt }
let _notifications = [];      // { id, type, jobId, jobName, userId, message, createdAt, read }
let _nextId = 1;
const _listeners = new Set();

function notify() {
    const state = { watchedJobs: new Map(_watchedJobs), notifications: [..._notifications] };
    _listeners.forEach((fn) => fn(state));
}

export function watchJob({ jobId, jobName, userId }) {
    _watchedJobs.set(jobId, {
        jobId,
        jobName,
        userId,
        watchedAt: new Date().toISOString(),
    });
    notify();
}

export function unwatchJob(jobId) {
    _watchedJobs.delete(jobId);
    notify();
}

export function isWatching(jobId) {
    return _watchedJobs.has(jobId);
}

export function getWatchedJobs() {
    return [..._watchedJobs.values()];
}

// Called when a job status changes to completed or failed.
// In a real app this would be triggered by a websocket or polling mechanism.
export function generateNotification({ jobId, jobName, status }) {
    const watch = _watchedJobs.get(jobId);
    if (!watch) return;

    // Don't duplicate notifications for the same job
    if (_notifications.some((n) => n.jobId === jobId && n.type === status)) return;

    _notifications.push({
        id: _nextId++,
        type: status,
        jobId,
        jobName,
        userId: watch.userId,
        message: status === 'completed'
            ? `Job "${jobName}" has finished processing.`
            : `Job "${jobName}" has failed.`,
        createdAt: new Date().toISOString(),
        read: false,
    });
    notify();
}

export function getNotifications() {
    return [..._notifications];
}

export function getUnreadCount() {
    return _notifications.filter((n) => !n.read).length;
}

export function markAsRead(id) {
    const n = _notifications.find((x) => x.id === id);
    if (n) {
        n.read = true;
        notify();
    }
}

export function markAllAsRead() {
    _notifications.forEach((n) => { n.read = true; });
    notify();
}

export function subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

// ─── Review notifications ───────────────────────────────────────────────────
// Sent to a reviewer/admin when a user submits a transcript for review.

export function addReviewNotification({ fileId, fileName, recipientId, submittedBy, submitterName }) {
    // Don't duplicate for the same file + recipient
    if (_notifications.some((n) => n.type === 'review_submitted' && n.fileId === fileId && n.recipientId === recipientId)) return;

    _notifications.push({
        id: _nextId++,
        type: 'review_submitted',
        fileId,
        fileName,
        recipientId,
        submittedBy,
        message: `${submitterName} submitted "${fileName}" for your review.`,
        createdAt: new Date().toISOString(),
        read: false,
    });
    notify();
}

// ─── Review action notifications ─────────────────────────────────────────────
// Sent to the original submitter when a reviewer approves or requests changes.

export function addReviewActionNotification({ fileId, fileName, recipientId, reviewerName, action, reason }) {
    _notifications.push({
        id: _nextId++,
        type: 'review_action',
        fileId,
        fileName,
        recipientId,
        action,
        message: action === 'approved'
            ? `${reviewerName} approved "${fileName}".`
            : `${reviewerName} requested changes on "${fileName}".${reason ? ` Reason: ${reason}` : ''}`,
        createdAt: new Date().toISOString(),
        read: false,
    });
    notify();
}

// ─── Folder request notifications ──────────────────────────────────────────────

export function addFolderRequestNotification({ groupId, recipientId, requestedBy, requesterName, suggestedName }) {
    _notifications.push({
        id: _nextId++,
        type: 'folder_request',
        groupId,
        recipientId,
        requestedBy,
        message: `${requesterName} requested a new folder "${suggestedName}".`,
        createdAt: new Date().toISOString(),
        read: false,
    });
    notify();
}

export function addFolderRequestResponseNotification({ recipientId, suggestedName, approved, denyReason }) {
    _notifications.push({
        id: _nextId++,
        type: 'folder_request_response',
        recipientId,
        message: approved
            ? `Your folder request "${suggestedName}" was approved.`
            : `Your folder request "${suggestedName}" was denied.${denyReason ? ` Reason: ${denyReason}` : ''}`,
        createdAt: new Date().toISOString(),
        read: false,
    });
    notify();
}

// Get notifications targeted at a specific user (by userId).
// Job notifications use the userId from the watch; review notifications use recipientId.
export function getNotificationsForUser(userId) {
    return _notifications.filter((n) => {
        if (n.type === 'review_submitted') return n.recipientId === userId;
        if (n.type === 'review_action') return n.recipientId === userId;
        if (n.type === 'folder_request') return n.recipientId === userId;
        if (n.type === 'folder_request_response') return n.recipientId === userId;
        return n.userId === userId;
    });
}

export function getUnreadCountForUser(userId) {
    return getNotificationsForUser(userId).filter((n) => !n.read).length;
}
