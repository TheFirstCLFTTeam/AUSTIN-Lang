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
