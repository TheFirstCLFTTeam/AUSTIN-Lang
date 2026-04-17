'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { USER_GROUP_CATALOGUE } from '@/services/mock_data-users';
import { getAllAssignments, subscribe as subscribeUserGroups } from '@/services/user-groups';
import { getPolicy, subscribe as subscribePolicies, ALL_PERMISSIONS, ALL_RESOURCES } from '@/services/group-policies';

function CategoryBadge({ category }) {
    const map = {
        'File Organisation': '#004ec6',
        'Access Permissions': '#b20100',
    };
    const color = map[category] || '#7a7574';
    return (
        <span
            className="inline-block px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest"
            style={{ backgroundColor: 'rgba(233, 188, 181, 0.2)', color }}
        >
            {category}
        </span>
    );
}

function countMembers(assignments, groupId) {
    return Object.values(assignments).filter((groups) => (groups || []).includes(groupId)).length;
}

export default function GroupManagementPage() {
    const [assignments, setAssignments] = useState({});
    const [, forcePolicyRefresh] = useState(0);

    useEffect(() => {
        setAssignments(getAllAssignments());
        const unsubA = subscribeUserGroups(setAssignments);
        const unsubP = subscribePolicies(() => forcePolicyRefresh((n) => n + 1));
        return () => {
            unsubA();
            unsubP();
        };
    }, []);

    const groups = useMemo(() => {
        return USER_GROUP_CATALOGUE.map((g) => {
            const policy = getPolicy(g.id);
            return {
                ...g,
                memberCount: countMembers(assignments, g.id),
                permissionCount: policy.permissions.length,
                resourceCount: policy.resources.length,
                policy,
            };
        });
    }, [assignments]);

    const totals = useMemo(() => {
        const uniqueMembers = new Set();
        Object.keys(assignments).forEach((uid) => {
            if ((assignments[uid] || []).length > 0) uniqueMembers.add(uid);
        });
        return {
            groupCount: groups.length,
            totalMembers: uniqueMembers.size,
            totalPermissions: ALL_PERMISSIONS.length,
            totalResources: ALL_RESOURCES.length,
        };
    }, [assignments, groups.length]);

    return (
        <div>
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-[0.6875rem] mb-2" style={{ color: '#7a7574' }}>
                <span className="uppercase tracking-widest" style={{ color: '#b20100' }}>Institutional Management</span>
                <span>/</span>
                <span className="uppercase tracking-widest">User Groups</span>
            </div>

            {/* Editorial header */}
            <div className="flex items-end justify-between mb-8 pb-6" style={{ borderBottom: '2px solid #1c1b1b' }}>
                <div>
                    <h1 className="text-[2.5rem] font-bold leading-none tracking-tight uppercase" style={{ color: '#1c1b1b', letterSpacing: '-0.03em' }}>
                        User Groups
                    </h1>
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-widest mt-4" style={{ color: '#7a7574' }}>
                        {totals.groupCount} Groups &middot; {totals.totalMembers} Assigned Users &middot; {totals.totalPermissions} Permission Keys &middot; {totals.totalResources} Resource Surfaces
                    </p>
                </div>
                <button
                    type="button"
                    className="px-5 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                    style={{ backgroundColor: '#1c1b1b', color: '#f3f0ef', border: 'none', borderRadius: '0px' }}
                >
                    + Create New User Group
                </button>
            </div>

            {/* Group grid */}
            <div className="grid grid-cols-2 gap-4">
                {groups.map((group) => (
                    <Link
                        key={group.id}
                        href={`/admin/groups/${encodeURIComponent(group.id)}`}
                        className="no-underline"
                    >
                        <div
                            className="p-5 flex flex-col gap-4 h-full transition-all"
                            style={{
                                backgroundColor: '#ffffff',
                                border: '2px solid transparent',
                                cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#b20100'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
                        >
                            {/* Header */}
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <CategoryBadge category={group.category} />
                                        <span className="text-[0.5625rem] font-mono uppercase tracking-widest" style={{ color: '#7a7574' }}>
                                            {group.id}
                                        </span>
                                    </div>
                                    <h3 className="text-[1.125rem] font-bold tracking-tight" style={{ color: '#1c1b1b', letterSpacing: '-0.01em' }}>
                                        {group.name}
                                    </h3>
                                </div>
                                <span
                                    className="shrink-0 text-[0.5625rem] font-semibold uppercase tracking-widest"
                                    style={{ color: '#b20100' }}
                                    aria-hidden
                                >
                                    Open &rarr;
                                </span>
                            </div>

                            {/* Description */}
                            <p className="text-[0.75rem] leading-relaxed" style={{ color: '#1c1b1b' }}>
                                {group.description}
                            </p>

                            {/* Repository capacity */}
                            <p className="text-[0.625rem] uppercase tracking-widest" style={{ color: '#7a7574' }}>
                                Repository: {group.repositorySize}
                            </p>

                            {/* Stats */}
                            <div className="grid grid-cols-3 gap-3 pt-3" style={{ borderTop: '1px solid rgba(233, 188, 181, 0.2)' }}>
                                <Stat label="Members" value={group.memberCount} />
                                <Stat label="Permissions" value={group.permissionCount} total={ALL_PERMISSIONS.length} />
                                <Stat label="Resources" value={group.resourceCount} total={ALL_RESOURCES.length} />
                            </div>
                        </div>
                    </Link>
                ))}
            </div>

            <div className="flex items-center justify-between mt-10 pt-4 text-[0.5625rem] uppercase tracking-widest" style={{ color: '#7a7574', borderTop: '1px solid rgba(233, 188, 181, 0.2)' }}>
                <span>Permissions persist via localStorage</span>
                <span>Click any group to edit permissions, resources, and membership</span>
                <span>Audit trails sourced per group</span>
            </div>
        </div>
    );
}

function Stat({ label, value, total }) {
    return (
        <div>
            <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: '#7a7574' }}>{label}</p>
            <p className="text-[1rem] font-bold" style={{ color: '#1c1b1b' }}>
                {value}
                {total != null && <span className="ml-1 text-[0.625rem] font-normal" style={{ color: '#7a7574' }}>/ {total}</span>}
            </p>
        </div>
    );
}
