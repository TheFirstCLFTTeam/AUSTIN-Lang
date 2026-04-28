'use client';

import { useState } from 'react';
import Dialog from '../../components/Dialog';
import { submitCredentialRequest } from '../../../../services/credential-requests';

export default function EditCredentialsDialog({ open, onClose, profile }) {
    const [form, setForm] = useState({
        name: profile.name,
        designation: profile.designation,
        department: profile.department,
    });
    const [submitted, setSubmitted] = useState(false);

    const handleChange = (field) => (e) => {
        setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

    const hasChanges =
        form.name !== profile.name ||
        form.designation !== profile.designation ||
        form.department !== profile.department;

    const handleSubmit = () => {
        const changes = {};
        if (form.name !== profile.name) changes.name = { from: profile.name, to: form.name };
        if (form.designation !== profile.designation) changes.designation = { from: profile.designation, to: form.designation };
        if (form.department !== profile.department) changes.department = { from: profile.department, to: form.department };

        submitCredentialRequest({
            userId: profile.employeeId,
            userName: profile.name,
            profilePic: profile.profilePic,
            changes,
        });

        setSubmitted(true);
    };

    const handleClose = () => {
        setSubmitted(false);
        setForm({ name: profile.name, designation: profile.designation, department: profile.department });
        onClose();
    };

    const fields = [
        { key: 'name', label: 'Full Name' },
        { key: 'designation', label: 'Designation' },
        { key: 'department', label: 'Department' },
    ];

    return (
        <Dialog open={open} onClose={handleClose} title="Edit Credentials">
            {submitted ? (
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <span
                            className="inline-block px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase"
                            style={{ backgroundColor: 'rgba(178, 1, 0, 0.08)', color: '#b20100' }}
                        >
                            Pending Approval
                        </span>
                    </div>
                    <p className="text-[0.8125rem] mb-1" style={{ color: '#1c1b1b' }}>
                        Your credential changes have been submitted.
                    </p>
                    <p className="text-[0.6875rem] mb-5" style={{ color: '#7a7574' }}>
                        An administrator will review your request. You will be notified once it has been processed.
                    </p>
                    <button
                        onClick={handleClose}
                        className="w-full py-2 text-[0.8125rem] font-semibold cursor-pointer"
                        style={{ backgroundColor: '#1c1b1b', color: '#ffffff', border: 'none', borderRadius: '0px' }}
                    >
                        CLOSE
                    </button>
                </div>
            ) : (
                <div>
                    <p className="text-[0.6875rem] mb-4" style={{ color: '#7a7574' }}>
                        Changes require administrator approval before taking effect.
                    </p>
                    <div className="space-y-4">
                        {fields.map((f) => (
                            <div key={f.key}>
                                <label
                                    className="block text-[0.625rem] uppercase tracking-wider mb-1"
                                    style={{ color: '#7a7574' }}
                                >
                                    {f.label}
                                </label>
                                <input
                                    type="text"
                                    value={form[f.key]}
                                    onChange={handleChange(f.key)}
                                    className="w-full px-3 py-2 text-[0.8125rem] outline-none"
                                    style={{
                                        backgroundColor: '#f6f3f2',
                                        border: form[f.key] !== profile[f.key] ? '1.5px solid #b20100' : '1.5px solid transparent',
                                        borderRadius: '0px',
                                        color: '#1c1b1b',
                                    }}
                                />
                                {form[f.key] !== profile[f.key] && (
                                    <p className="text-[0.5625rem] mt-0.5" style={{ color: '#b20100' }}>
                                        Current: {profile[f.key]}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-3 mt-6">
                        <button
                            onClick={handleSubmit}
                            disabled={!hasChanges}
                            className="flex-1 py-2 text-[0.8125rem] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ backgroundColor: '#1c1b1b', color: '#ffffff', border: 'none', borderRadius: '0px' }}
                        >
                            SUBMIT FOR APPROVAL
                        </button>
                        <button
                            onClick={handleClose}
                            className="px-4 py-2 text-[0.8125rem] font-medium cursor-pointer"
                            style={{ backgroundColor: 'transparent', border: '1.5px solid #1c1b1b', borderRadius: '0px', color: '#1c1b1b' }}
                        >
                            CANCEL
                        </button>
                    </div>
                </div>
            )}
        </Dialog>
    );
}
