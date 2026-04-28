// In-memory store for pending credential change requests.
// Shared across components via import so state persists within a session.

let _requests = [];
let _nextId = 1;
const _listeners = new Set();

function notify() {
    _listeners.forEach((fn) => fn([..._requests]));
}

export function submitCredentialRequest({ userId, userName, profilePic, changes }) {
    _requests.push({
        id: _nextId++,
        userId,
        userName,
        profilePic,
        changes,
        status: 'pending',
        submittedAt: new Date().toISOString(),
    });
    notify();
}

export function getPendingRequests() {
    return _requests.filter((r) => r.status === 'pending');
}

export function approveRequest(id) {
    const req = _requests.find((r) => r.id === id);
    if (req) {
        req.status = 'approved';
        notify();
    }
}

export function denyRequest(id) {
    const req = _requests.find((r) => r.id === id);
    if (req) {
        req.status = 'denied';
        notify();
    }
}

export function subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}
