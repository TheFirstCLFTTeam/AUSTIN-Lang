'use client';

import { useState } from 'react';
import EditCredentialsDialog from './EditCredentialsDialog';

export default function CredentialDetails({ profile }) {
    const [editOpen, setEditOpen] = useState(false);

    return (
        <>
            <div
                className="flex gap-6 p-5"
                style={{ backgroundColor: '#ffffff' }}
            >
                <div className="flex-1">
                    <h3
                        className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-4"
                        style={{ color: '#7a7574' }}
                    >
                        Credential Details
                    </h3>
                    <div className="space-y-3">
                        <div>
                            <p
                                className="text-[0.625rem] uppercase tracking-wider"
                                style={{ color: '#7a7574' }}
                            >
                                Designation
                            </p>
                            <p
                                className="text-[0.875rem] font-bold"
                                style={{ color: '#1c1b1b' }}
                            >
                                {profile.designation.toUpperCase()}
                            </p>
                        </div>
                        <div>
                            <p
                                className="text-[0.625rem] uppercase tracking-wider"
                                style={{ color: '#7a7574' }}
                            >
                                Employee ID
                            </p>
                            <p
                                className="text-[0.875rem] font-bold"
                                style={{ color: '#1c1b1b' }}
                            >
                                {profile.employeeId}
                            </p>
                        </div>
                        <div>
                            <p
                                className="text-[0.625rem] uppercase tracking-wider"
                                style={{ color: '#7a7574' }}
                            >
                                Department
                            </p>
                            <p
                                className="text-[0.875rem] font-bold"
                                style={{ color: '#1c1b1b' }}
                            >
                                {profile.department.toUpperCase()}
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-3 mt-5">
                        <button
                            onClick={() => setEditOpen(true)}
                            className="px-4 py-2 text-[0.75rem] font-semibold cursor-pointer"
                            style={{
                                backgroundColor: '#1c1b1b',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '0px',
                            }}
                        >
                            EDIT IDENTITY
                        </button>
                        <button
                            className="px-4 py-2 text-[0.75rem] font-semibold cursor-pointer"
                            style={{
                                backgroundColor: 'transparent',
                                border: '1.5px solid #1c1b1b',
                                borderRadius: '0px',
                                color: '#1c1b1b',
                            }}
                        >
                            REQUEST AUDIT
                        </button>
                    </div>
                </div>
                <div
                    className="w-36 h-44 shrink-0 overflow-hidden"
                    style={{ backgroundColor: '#313030' }}
                >
                    <img
                        src={profile.profilePic || '/default_pfp.png'}
                        alt={profile.name}
                        className="w-full h-full object-cover"
                    />
                </div>
            </div>
            <EditCredentialsDialog
                open={editOpen}
                onClose={() => setEditOpen(false)}
                profile={profile}
            />
        </>
    );
}
