'use client';

import { useEffect, useState } from 'react';
import { fetchUserProfile } from '../../../services/api';
import ProfileHeader from './components/ProfileHeader';
import CredentialDetails from './components/CredentialDetails';
import UserStatistics from './components/UserStatistics';
import InterfacePreferences from './components/InterfacePreferences';
import SecurityCore from './components/SecurityCore';
import PermissionGroup from './components/PermissionGroup';

export default function ProfilePage() {
    const [profile, setProfile] = useState(null);

    useEffect(() => {
        fetchUserProfile().then(setProfile);
    }, []);

    if (!profile) return null;

    return (
        <div>
            <ProfileHeader name={profile.name} />

            <div className="flex gap-4 mb-4">
                <div className="flex-1">
                    <CredentialDetails profile={profile} />
                </div>
                <div className="w-72 shrink-0">
                    <UserStatistics
                        stats={profile.recordingsHandled}
                    />
                </div>
            </div>

            <div className="flex gap-4 mb-4">
                <div className="flex-1">
                    <InterfacePreferences
                        preferences={profile.preferences}
                    />
                </div>
                <div className="w-72 shrink-0">
                    <SecurityCore security={profile.security} />
                </div>
            </div>

            <div className="mt-6">
                <div
                    className="p-5 pb-0"
                    style={{ backgroundColor: '#ffffff' }}
                >
                    <h3
                        className="text-[0.6875rem] font-semibold uppercase tracking-wider"
                        style={{ color: '#7a7574' }}
                    >
                        Permission Group
                    </h3>
                </div>
                {profile.permissionGroups.map((group, i) => (
                    <PermissionGroup
                        key={group.name}
                        group={group}
                        defaultOpen={i === 0}
                    />
                ))}
            </div>
        </div>
    );
}
