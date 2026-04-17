'use client';

import { useEffect, useState } from 'react';
import { fetchUserProfile } from '../../../services/api';
import ProfileHeader from './components/ProfileHeader';
import CredentialDetails from './components/CredentialDetails';
import UserStatistics from './components/UserStatistics';
import InterfacePreferences from './components/InterfacePreferences';
import SecurityCore from './components/SecurityCore';
import ConnectedAccounts from './components/ConnectedAccounts';
import PermissionGroup from './components/PermissionGroup';
import Tabs from './components/Tabs';

const TABS = [
    { id: 'profile', label: 'Profile Details' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'security', label: 'Security' },
];

export default function ProfilePage() {
    const [profile, setProfile] = useState(null);
    const [activeTab, setActiveTab] = useState('profile');

    useEffect(() => {
        fetchUserProfile().then(setProfile);
    }, []);

    if (!profile) return null;

    return (
        <div>
            <ProfileHeader name={profile.name} />

            <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

            {activeTab === 'profile' && (
                <div className="mt-4">
                    <div className="flex gap-4 mb-4">
                        <div className="flex-1">
                            <CredentialDetails profile={profile} />
                        </div>
                        <div className="w-72 shrink-0">
                            <UserStatistics stats={profile.recordingsHandled} />
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
            )}

            {activeTab === 'preferences' && (
                <div className="mt-4 mb-4">
                    <InterfacePreferences preferences={profile.preferences} />
                </div>
            )}

            {activeTab === 'security' && (
                <div className="mt-4 mb-4">
                    <SecurityCore security={profile.security} />
                    <div className="mt-4">
                        <ConnectedAccounts />
                    </div>
                </div>
            )}
        </div>
    );
}
