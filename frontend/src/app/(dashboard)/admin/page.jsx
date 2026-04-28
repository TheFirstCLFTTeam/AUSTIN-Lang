'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getCurrentUser } from '@/services/api';
import { users, MOCK_USER_PROFILES } from '@/services/mock_data-users';
import {
    getCatalogue,
    getGroupsForUser,
    setGroupsForUser,
    subscribe as subscribeUserGroups,
} from '@/services/user-groups';
import {
    getPendingRequests,
    approveRequest,
    denyRequest,
    subscribe as subscribeCredentialRequests,
} from '@/services/credential-requests';
import OwnerBadge from '../components/OwnerBadge';

// Role → badge colour so the list column reads at a glance.
function RoleBadge({ role }) {
    const map = {
        admin: { bg: '#1c1b1b', color: '#ffffff', label: 'ADMIN' },
        engineer: { bg: 'rgba(178, 1, 0, 0.08)', color: '#b20100', label: 'ENGINEER' },
        reviewer: { bg: 'rgba(0, 78, 198, 0.08)', color: '#004ec6', label: 'REVIEWER' },
        generic: { bg: '#f6f3f2', color: '#1c1b1b', label: 'OPERATOR' },
    };
    const s = map[role] || map.generic;
    return (
        <span
            className="inline-block px-2 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest"
            style={{ backgroundColor: s.bg, color: s.color }}
        >
            {s.label}
        </span>
    );
}

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

function KpiCard({ label, value, sublabel, accent }) {
    return (
        <div className="p-5" style={{ backgroundColor: '#ffffff' }}>
            <p
                className="text-[0.625rem] font-semibold uppercase tracking-widest mb-3"
                style={{ color: '#7a7574' }}
            >
                {label}
            </p>
            <p
                className="text-[1.75rem] font-bold leading-none tracking-tight"
                style={{
                    color: accent ? '#b20100' : '#1c1b1b',
                    letterSpacing: '-0.02em',
                }}
            >
                {value}
            </p>
            {sublabel && (
                <p className="text-[0.6875rem] mt-2" style={{ color: '#7a7574' }}>
                    {sublabel}
                </p>
            )}
        </div>
    );
}

export default function AdminPage() {
    const [currentUser, setCurrentUser] = useState(null);
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [, forceTick] = useState(0);
    const [pendingRequests, setPendingRequests] = useState(() => getPendingRequests());

    // Draft membership state while editing. Keyed by userId so multiple edits
    // don't clobber each other, though in practice only one row is selected
    // at a time.
    const [draftGroups, setDraftGroups] = useState({});
    const [savedBanner, setSavedBanner] = useState(null);

    useEffect(() => {
        setCurrentUser(getCurrentUser());
    }, []);

    useEffect(() => {
        return subscribeCredentialRequests(() => setPendingRequests(getPendingRequests()));
    }, []);

    useEffect(() => {
        // Any external change to the assignments map forces a re-render so
        // the KPI counts + detail panel stay in sync.
        return subscribeUserGroups(() => forceTick((n) => n + 1));
    }, []);

    useEffect(() => {
        if (!savedBanner) return;
        const t = setTimeout(() => setSavedBanner(null), 3200);
        return () => clearTimeout(t);
    }, [savedBanner]);

    const catalogue = useMemo(() => getCatalogue(), []);
    const catalogueById = useMemo(() => new Map(catalogue.map((g) => [g.id, g])), [catalogue]);

    // Drop OperatorProfiles into a single list the table can render.
    const personas = useMemo(
        () => users.map((u) => {
            const profile = MOCK_USER_PROFILES[u.id] || {};
            return {
                id: u.id,
                email: u.email,
                role: u.role,
                fullName: u.name,
                displayName: profile.name || u.name,
                designation: profile.designation || u.role,
                profilePic: profile.profilePic || null,
                employeeId: profile.employeeId || '—',
                department: profile.department || '—',
                groups: getGroupsForUser(u.id),
            };
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [pendingRequests, currentUser, savedBanner, draftGroups],
    );

    const selected = personas.find((p) => p.id === selectedUserId) || null;
    const isSelf = Boolean(selected && currentUser && selected.id === currentUser.id);
    const draftForSelected = selected ? (draftGroups[selected.id] ?? selected.groups) : [];
    const isDirty = selected
        ? JSON.stringify([...draftForSelected].sort()) !==
          JSON.stringify([...selected.groups].sort())
        : false;

    const toggleGroup = (groupId) => {
        if (!selected || isSelf) return;
        const current = draftGroups[selected.id] ?? selected.groups;
        const next = current.includes(groupId)
            ? current.filter((g) => g !== groupId)
            : [...current, groupId];
        setDraftGroups({ ...draftGroups, [selected.id]: next });
    };

    const saveChanges = () => {
        if (!selected || isSelf) return;
        const next = draftGroups[selected.id] ?? selected.groups;
        setGroupsForUser(selected.id, next);
        setDraftGroups((prev) => {
            const { [selected.id]: _removed, ...rest } = prev;
            return rest;
        });
        setSavedBanner(
            `Updated group membership for ${selected.displayName} (${next.length} group${next.length === 1 ? '' : 's'}).`,
        );
    };

    const discardChanges = () => {
        if (!selected) return;
        setDraftGroups((prev) => {
            const { [selected.id]: _removed, ...rest } = prev;
            return rest;
        });
    };

    const totalMemberships = personas.reduce((acc, p) => acc + p.groups.length, 0);
    const complianceGroupCount = catalogue.filter((g) => g.category === 'Compliance').length;

    return (
        <div>
            {/* Breadcrumb */}
            <div
                className="flex items-center gap-2 text-[0.6875rem] mb-2"
                style={{ color: '#7a7574' }}
            >
                <span className="uppercase tracking-widest" style={{ color: '#b20100' }}>Institutional Management</span>
                <span>/</span>
                <span className="uppercase tracking-widest" style={{ color: '#1c1b1b' }}>User Management</span>
            </div>

            {/* Editorial header */}
            <div
                className="flex items-end justify-between gap-6 mb-8 pb-6"
                style={{ borderBottom: '2px solid #1c1b1b' }}
            >
                <div>
                    <h1
                        className="text-[2.5rem] font-bold leading-none tracking-tight uppercase"
                        style={{ color: '#1c1b1b', letterSpacing: '-0.03em' }}
                    >
                        User Management
                    </h1>
                    <p
                        className="text-[0.6875rem] font-semibold uppercase tracking-widest mt-4"
                        style={{ color: '#7a7574' }}
                    >
                        Assign data-access groups to the four operator personas &middot; membership controls repository scope
                    </p>
                </div>
                <Link
                    href="/admin/groups"
                    className="px-6 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer no-underline"
                    style={{
                        backgroundColor: 'transparent',
                        border: '1.5px solid #1c1b1b',
                        borderRadius: '0px',
                        color: '#1c1b1b',
                    }}
                >
                    Manage Groups &rarr;
                </Link>
            </div>

            {savedBanner && (
                <div
                    className="mb-6 px-4 py-3 text-[0.8125rem]"
                    style={{ backgroundColor: '#1c1b1b', color: '#ffffff', borderLeft: '3px solid #b20100' }}
                >
                    {savedBanner}
                </div>
            )}

            {/* KPIs */}
            <div
                className="grid grid-cols-4 mb-8"
                style={{ backgroundColor: 'rgba(233, 188, 181, 0.15)', gap: '1px' }}
            >
                <KpiCard label="Operator Personas" value={personas.length} sublabel="Registered accounts" />
                <KpiCard
                    label="Data-Access Groups"
                    value={catalogue.length}
                    sublabel={`${complianceGroupCount} compliance · rest business / engineering`}
                />
                <KpiCard
                    label="Total Memberships"
                    value={totalMemberships}
                    sublabel={`Avg ${(totalMemberships / personas.length).toFixed(1)} groups / user`}
                />
                <KpiCard
                    label="Pending Credential Changes"
                    value={pendingRequests.length}
                    sublabel={pendingRequests.length > 0 ? 'Action required' : 'All clear'}
                    accent={pendingRequests.length > 0}
                />
            </div>

            {/* Pending credential changes — preserved from the previous page */}
            {pendingRequests.length > 0 && (
                <div className="mb-8 p-5" style={{ backgroundColor: '#ffffff' }}>
                    <div className="flex items-center gap-3 mb-4">
                        <h2
                            className="text-[0.875rem] font-bold uppercase tracking-widest"
                            style={{ color: '#1c1b1b' }}
                        >
                            Pending Credential Changes
                        </h2>
                        <span
                            className="inline-block px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest"
                            style={{ backgroundColor: 'rgba(178, 1, 0, 0.08)', color: '#b20100' }}
                        >
                            {pendingRequests.length} pending
                        </span>
                    </div>
                    <div className="space-y-3">
                        {pendingRequests.map((req) => (
                            <div
                                key={req.id}
                                className="flex items-center gap-4 p-4"
                                style={{ backgroundColor: '#f6f3f2' }}
                            >
                                <div
                                    className="w-9 h-9 shrink-0 overflow-hidden"
                                    style={{ backgroundColor: '#313030', borderRadius: '50%' }}
                                >
                                    <img
                                        src={req.profilePic || '/default_pfp.png'}
                                        alt={req.userName}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[0.8125rem] font-semibold" style={{ color: '#1c1b1b' }}>
                                        {req.userName}
                                    </p>
                                    <p className="text-[0.625rem] mb-1" style={{ color: '#7a7574' }}>
                                        ID: {req.userId}
                                    </p>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                                        {Object.entries(req.changes).map(([field, { from, to }]) => (
                                            <span key={field} className="text-[0.6875rem]" style={{ color: '#1c1b1b' }}>
                                                <span
                                                    className="uppercase tracking-wider text-[0.5625rem]"
                                                    style={{ color: '#7a7574' }}
                                                >
                                                    {field}:{' '}
                                                </span>
                                                <span style={{ textDecoration: 'line-through', color: '#7a7574' }}>
                                                    {from}
                                                </span>
                                                {' → '}
                                                <span className="font-semibold">{to}</span>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <button
                                        onClick={() => approveRequest(req.id)}
                                        className="px-3 py-1.5 text-[0.75rem] font-semibold cursor-pointer"
                                        style={{
                                            backgroundColor: '#1c1b1b',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '0px',
                                        }}
                                    >
                                        Approve
                                    </button>
                                    <button
                                        onClick={() => denyRequest(req.id)}
                                        className="px-3 py-1.5 text-[0.75rem] font-semibold cursor-pointer"
                                        style={{
                                            backgroundColor: 'transparent',
                                            border: '1.5px solid #1c1b1b',
                                            borderRadius: '0px',
                                            color: '#1c1b1b',
                                        }}
                                    >
                                        Deny
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Directory + detail */}
            <div className="flex gap-6">
                {/* User directory */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-end justify-between mb-3">
                        <div>
                            <h2
                                className="text-[0.875rem] font-bold uppercase tracking-widest"
                                style={{ color: '#1c1b1b' }}
                            >
                                Operator Directory
                                <span
                                    className="ml-3 text-[0.6875rem] font-semibold"
                                    style={{ color: '#7a7574' }}
                                >
                                    ({personas.length})
                                </span>
                            </h2>
                            <p
                                className="text-[0.6875rem] uppercase tracking-widest mt-1"
                                style={{ color: '#7a7574' }}
                            >
                                Click a row to view group memberships. Your own account is read-only.
                            </p>
                        </div>
                    </div>
                    <div style={{ backgroundColor: '#ffffff' }}>
                        <div
                            className="flex items-center px-5 py-3 text-[0.625rem] font-semibold uppercase tracking-widest"
                            style={{ color: '#7a7574', borderBottom: '1px solid rgba(233, 188, 181, 0.25)' }}
                        >
                            <div className="flex-1">Operator</div>
                            <div className="w-28">Role</div>
                            <div className="w-40">Department</div>
                            <div className="w-28 text-right">Groups</div>
                        </div>
                        {personas.map((p) => {
                            const isActive = selectedUserId === p.id;
                            const isYou = currentUser?.id === p.id;
                            return (
                                <div
                                    key={p.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setSelectedUserId(p.id)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            setSelectedUserId(p.id);
                                        }
                                    }}
                                    className="flex items-center px-5 py-4 cursor-pointer transition-colors"
                                    style={{
                                        backgroundColor: isActive ? 'rgba(178, 1, 0, 0.04)' : 'transparent',
                                        borderBottom: '1px solid rgba(233, 188, 181, 0.08)',
                                        borderLeft: isActive ? '3px solid #b20100' : '3px solid transparent',
                                    }}
                                >
                                    <div className="flex-1 min-w-0 pr-3">
                                        <div className="flex items-center gap-3">
                                            <OwnerBadge owner={p.id} size="md" />
                                            {isYou && (
                                                <span
                                                    className="px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest"
                                                    style={{ backgroundColor: '#b20100', color: '#ffffff' }}
                                                >
                                                    You
                                                </span>
                                            )}
                                        </div>
                                        <p
                                            className="text-[0.6875rem] mt-1 font-mono"
                                            style={{ color: '#7a7574' }}
                                        >
                                            {p.employeeId} &middot; {p.email}
                                        </p>
                                    </div>
                                    <div className="w-28">
                                        <RoleBadge role={p.role} />
                                    </div>
                                    <div
                                        className="w-40 text-[0.75rem] truncate"
                                        style={{ color: '#7a7574' }}
                                    >
                                        {p.department}
                                    </div>
                                    <div
                                        className="w-28 text-right text-[0.875rem] font-bold"
                                        style={{ color: '#1c1b1b' }}
                                    >
                                        {p.groups.length}
                                        <span
                                            className="ml-1 text-[0.625rem] font-normal"
                                            style={{ color: '#7a7574' }}
                                        >
                                            / {catalogue.length}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Membership editor */}
                <div className="w-96 shrink-0">
                    {selected ? (
                        <div style={{ backgroundColor: '#ffffff' }}>
                            <div className="p-5" style={{ borderBottom: '1px solid rgba(233, 188, 181, 0.25)' }}>
                                <p
                                    className="text-[0.625rem] font-semibold uppercase tracking-widest mb-2"
                                    style={{ color: '#b20100' }}
                                >
                                    Group Membership
                                </p>
                                <OwnerBadge owner={selected.id} size="md" />
                                <p className="text-[0.75rem] mt-2" style={{ color: '#7a7574' }}>
                                    {selected.designation} &middot; {selected.department}
                                </p>
                                <p className="text-[0.6875rem] font-mono mt-1" style={{ color: '#7a7574' }}>
                                    {selected.email}
                                </p>
                            </div>

                            {isSelf && (
                                <div
                                    className="px-5 py-3 text-[0.75rem]"
                                    style={{
                                        backgroundColor: '#1c1b1b',
                                        color: '#ffffff',
                                        borderLeft: '3px solid #b20100',
                                    }}
                                >
                                    Your own account cannot be modified here. Ask another admin to amend your memberships.
                                </div>
                            )}

                            <div className="p-5 space-y-3 max-h-[560px] overflow-y-auto">
                                {catalogue.map((group) => {
                                    const active = draftForSelected.includes(group.id);
                                    return (
                                        <label
                                            key={group.id}
                                            className={`flex items-start gap-3 p-3 ${isSelf ? '' : 'cursor-pointer'}`}
                                            style={{
                                                backgroundColor: active ? 'rgba(178, 1, 0, 0.05)' : '#f6f3f2',
                                                borderLeft: active ? '3px solid #b20100' : '3px solid transparent',
                                                opacity: isSelf ? 0.7 : 1,
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={active}
                                                disabled={isSelf}
                                                onChange={() => toggleGroup(group.id)}
                                                className="mt-0.5"
                                                style={{
                                                    accentColor: '#b20100',
                                                    width: '1rem',
                                                    height: '1rem',
                                                    cursor: isSelf ? 'not-allowed' : 'pointer',
                                                }}
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <p
                                                        className="text-[0.8125rem] font-bold"
                                                        style={{ color: '#1c1b1b' }}
                                                    >
                                                        {group.name}
                                                    </p>
                                                    <CategoryBadge category={group.category} />
                                                </div>
                                                <p
                                                    className="text-[0.6875rem] mt-1 leading-relaxed"
                                                    style={{ color: '#7a7574' }}
                                                >
                                                    {group.description}
                                                </p>
                                                <p
                                                    className="text-[0.5625rem] uppercase tracking-widest mt-1 font-mono"
                                                    style={{ color: '#bcb7b6' }}
                                                >
                                                    {group.repositorySize}
                                                </p>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>

                            {!isSelf && (
                                <div
                                    className="p-5 flex items-center justify-end gap-2"
                                    style={{ borderTop: '1px solid rgba(233, 188, 181, 0.25)' }}
                                >
                                    <button
                                        type="button"
                                        onClick={discardChanges}
                                        disabled={!isDirty}
                                        className="px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                        style={{
                                            backgroundColor: 'transparent',
                                            border: '1.5px solid rgba(233, 188, 181, 0.5)',
                                            borderRadius: '0px',
                                            color: '#7a7574',
                                        }}
                                    >
                                        Discard
                                    </button>
                                    <button
                                        type="button"
                                        onClick={saveChanges}
                                        disabled={!isDirty}
                                        className="px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                        style={{
                                            background: 'linear-gradient(135deg, #b20100, #e10000)',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '0px',
                                        }}
                                    >
                                        Save Changes
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div
                            className="p-10 text-center"
                            style={{ backgroundColor: '#ffffff' }}
                        >
                            <p className="text-[0.875rem] mb-1" style={{ color: '#1c1b1b' }}>
                                Select an operator
                            </p>
                            <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                                Click a row in the directory to view or amend their data-access group memberships.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer audit strip */}
            <div
                className="flex items-center justify-between mt-10 pt-4 text-[0.625rem] uppercase tracking-widest"
                style={{ color: '#7a7574', borderTop: '1px solid rgba(233, 188, 181, 0.2)' }}
            >
                <span>Membership persisted locally &middot; austin.user-groups</span>
                <span>Personas seeded from mock_data-users.js</span>
                <span>Immutable audit trail &middot; append-only</span>
            </div>
        </div>
    );
}
