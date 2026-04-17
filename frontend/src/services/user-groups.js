// User-group membership store.
//
// A "user group" is a data-access bundle (see USER_GROUP_CATALOGUE in
// mock_data-users.js). Membership controls which recording repositories a
// user can see — not what they can do. This store lets the admin page mutate
// those assignments and persists them to localStorage so edits survive a
// reload.

import {
    INITIAL_USER_GROUP_ASSIGNMENTS,
    USER_GROUP_CATALOGUE,
} from './mock_data-users';

// v2 — bumped when USER_GROUP_CATALOGUE group ids changed (file-organisation
// + access-perms taxonomy). Stale v1 values are discarded and the catalogue's
// INITIAL_USER_GROUP_ASSIGNMENTS are re-seeded.
const STORAGE_KEY = 'austin.user-groups.v2';

const _listeners = new Set();
let _assignments = loadFromStorage();

function loadFromStorage() {
    try {
        const raw = typeof localStorage !== 'undefined'
            ? localStorage.getItem(STORAGE_KEY)
            : null;
        if (!raw) return { ...INITIAL_USER_GROUP_ASSIGNMENTS };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { ...INITIAL_USER_GROUP_ASSIGNMENTS };
        return parsed;
    } catch {
        return { ...INITIAL_USER_GROUP_ASSIGNMENTS };
    }
}

function persist() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_assignments));
        }
    } catch {}
    _listeners.forEach((fn) => fn({ ..._assignments }));
}

export function getAllAssignments() {
    return { ..._assignments };
}

export function getGroupsForUser(userId) {
    return [...(_assignments[userId] || [])];
}

export function setGroupsForUser(userId, groupIds) {
    const cleaned = [...new Set(groupIds)].filter((id) =>
        USER_GROUP_CATALOGUE.some((g) => g.id === id),
    );
    _assignments = { ..._assignments, [userId]: cleaned };
    persist();
}

export function subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

export function getCatalogue() {
    return [...USER_GROUP_CATALOGUE];
}

export function getGroupById(groupId) {
    return USER_GROUP_CATALOGUE.find((g) => g.id === groupId) || null;
}

// Reset helper — exposed mainly for test / demo resets. Not wired into the UI.
export function resetAssignments() {
    _assignments = { ...INITIAL_USER_GROUP_ASSIGNMENTS };
    persist();
}
