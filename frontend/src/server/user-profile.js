import 'server-only';

import { usersDb } from './db';

// Returns the MOCK_USER_PROFILES-shaped object for a given user id, or null.
// All sub-data (daily recordings, notification prefs, sessions, permission
// groups) lives in users.db and is joined in-process.
export function getUserProfile(userId) {
    const db = usersDb();
    const profile = db
        .prepare(
            `SELECT user_id, display_name, profile_pic, designation, employee_id,
                    department, recordings_total, locale_primary, locale_secondary,
                    security_status, mfa_enabled
               FROM user_profile WHERE user_id = ?`
        )
        .get(userId);
    if (!profile) return null;

    const daily = db
        .prepare(
            `SELECT day_label, count FROM user_recording_daily WHERE user_id = ? ORDER BY rowid`
        )
        .all(userId)
        .map((r) => ({ day: r.day_label, count: r.count }));

    const notifications = db
        .prepare(`SELECT pref FROM user_notification_pref WHERE user_id = ? ORDER BY rowid`)
        .all(userId)
        .map((r) => r.pref);

    const sessions = db
        .prepare(`SELECT id, label FROM user_session WHERE user_id = ? ORDER BY created_at`)
        .all(userId);

    const groups = db
        .prepare(
            `SELECT id, name, is_primary FROM user_permission_group WHERE user_id = ? ORDER BY id`
        )
        .all(userId);

    const grantStmt = db.prepare(
        `SELECT permission_label FROM user_permission_grant WHERE permission_group_id = ?`
    );
    const permissionGroups = groups.map((g) => ({
        name: g.name,
        isPrimary: !!g.is_primary,
        permissions: grantStmt.all(g.id).map((r) => r.permission_label),
    }));

    return {
        name: profile.display_name,
        profilePic: profile.profile_pic,
        designation: profile.designation,
        employeeId: profile.employee_id,
        department: profile.department,
        recordingsHandled: {
            total: profile.recordings_total ?? 0,
            daily,
        },
        preferences: {
            localization: {
                primary: profile.locale_primary,
                secondary: profile.locale_secondary,
            },
            notifications,
        },
        security: {
            status: profile.security_status,
            mfaEnabled: !!profile.mfa_enabled,
            activeSessions: sessions,
        },
        permissionGroups,
    };
}
