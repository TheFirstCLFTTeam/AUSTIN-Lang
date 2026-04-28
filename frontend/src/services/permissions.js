// Canonical permission check: does this user hold a given permission key?
//
// Today every page rolls its own ownership/role check. This helper centralises
// the lookup so future surfaces (and future backend RBAC) only have to trust
// one path: user → groups (user-groups service) → policies (group-policies
// service) → permission keys.

import { getGroupsForUser } from './user-groups';
import { getPolicy } from './group-policies';

export function hasPermission(user, permissionKey) {
    if (!user || !permissionKey) return false;
    const groupIds = getGroupsForUser(user.id);
    for (const gid of groupIds) {
        const policy = getPolicy(gid);
        if (policy.permissions.includes(permissionKey)) return true;
    }
    return false;
}

export function getUserPermissions(user) {
    if (!user) return [];
    const set = new Set();
    for (const gid of getGroupsForUser(user.id)) {
        for (const p of getPolicy(gid).permissions) set.add(p);
    }
    return [...set];
}
