'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { users, USER_GROUP_CATALOGUE, MOCK_USER_PROFILES } from '@/services/mock_data-users';
import { AUDIT_ACTIONS } from '@/services/mock_data-audit';
import Dialog from '../../../components/Dialog';
import SpeakerPickerSection from '../../../components/SpeakerPickerSection';
import {
    getAllAssignments,
    getGroupsForUser,
    setGroupsForUser,
    subscribe as subscribeUserGroups,
} from '@/services/user-groups';
import {
    getPolicy,
    setPolicy,
    subscribe as subscribePolicies,
    ALL_PERMISSIONS,
    ALL_RESOURCES,
} from '@/services/group-policies';
import {
    getGroupMeta,
    getMembersOfGroup,
    getGroupAudit,
    getGroupClientInteractions,
} from '@/services/group-details';
import OwnerBadge from '../../../components/OwnerBadge';

// ── Small presentation helpers ──────────────────────────────────────────────

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

function RoleBadge({ role }) {
    const map = {
        admin:    { bg: '#1c1b1b', color: '#ffffff', label: 'ADMIN' },
        engineer: { bg: 'rgba(178, 1, 0, 0.08)', color: '#b20100', label: 'ENGINEER' },
        reviewer: { bg: 'rgba(0, 78, 198, 0.08)', color: '#004ec6', label: 'REVIEWER' },
        generic:  { bg: '#f6f3f2', color: '#1c1b1b', label: 'OPERATOR' },
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

function formatRelative(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const diff = Date.now() - d.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < hour) return `${Math.max(1, Math.round(diff / minute))}m ago`;
    if (diff < day) return `${Math.round(diff / hour)}h ago`;
    if (diff < 7 * day) return `${Math.round(diff / day)}d ago`;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAbsolute(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Detail page ─────────────────────────────────────────────────────────────

export default function GroupDetailPage() {
    const params = useParams();
    const router = useRouter();
    const groupId = params?.id;
    const meta = getGroupMeta(groupId);

    const [assignments, setAssignments] = useState({});
    const [policy, setPolicyState] = useState({ permissions: [], resources: [] });
    const [policyDraft, setPolicyDraft] = useState({ permissions: [], resources: [] });
    const [policyDirty, setPolicyDirty] = useState(false);

    const [membershipEditing, setMembershipEditing] = useState(false);
    const [membershipDraft, setMembershipDraft] = useState([]);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [addPickerOpen, setAddPickerOpen] = useState(false);
    const [addPickerSearch, setAddPickerSearch] = useState('');

    useEffect(() => {
        setAssignments(getAllAssignments());
        const p = getPolicy(groupId);
        setPolicyState(p);
        setPolicyDraft(p);
        const unsubA = subscribeUserGroups((next) => setAssignments(next));
        const unsubP = subscribePolicies(() => {
            const fresh = getPolicy(groupId);
            setPolicyState(fresh);
            if (!policyDirty) setPolicyDraft(fresh);
        });
        return () => { unsubA(); unsubP(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupId]);

    const members = useMemo(() => getMembersOfGroup(groupId), [groupId, assignments]);
    const audit = useMemo(() => getGroupAudit(groupId, 40), [groupId, assignments]);
    const clientInteractions = useMemo(() => getGroupClientInteractions(groupId), [groupId]);

    if (!meta) {
        return (
            <div>
                <Link href="/admin/groups" className="text-[0.6875rem] uppercase tracking-wider" style={{ color: '#7a7574' }}>&larr; User Groups</Link>
                <div className="mt-8 p-10 text-center" style={{ backgroundColor: '#ffffff' }}>
                    <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>Group not found.</p>
                </div>
            </div>
        );
    }

    // ── Policy editor ──────────────────────────────────────────────────────

    const togglePolicyKey = (kind, key) => {
        setPolicyDraft((prev) => {
            const cur = new Set(prev[kind]);
            if (cur.has(key)) cur.delete(key); else cur.add(key);
            const next = { ...prev, [kind]: [...cur] };
            setPolicyDirty(true);
            return next;
        });
    };

    const savePolicy = () => {
        const saved = setPolicy(groupId, policyDraft);
        setPolicyState(saved);
        setPolicyDraft(saved);
        setPolicyDirty(false);
    };

    const revertPolicy = () => {
        setPolicyDraft(policy);
        setPolicyDirty(false);
    };

    // ── Membership editor ──────────────────────────────────────────────────

    const beginMembershipEdit = () => {
        setMembershipDraft(members.map((m) => m.id));
        setAddPickerOpen(false);
        setAddPickerSearch('');
        setConfirmOpen(true);
    };

    const confirmMembershipEdit = () => {
        setConfirmOpen(false);
        setMembershipEditing(true);
    };

    const cancelMembershipEdit = () => {
        setMembershipEditing(false);
        setMembershipDraft([]);
        setAddPickerOpen(false);
        setAddPickerSearch('');
    };

    const removeMember = (userId) => {
        setMembershipDraft((prev) => prev.filter((id) => id !== userId));
    };

    const pickMember = (person) => {
        setMembershipDraft((prev) => (prev.includes(person.id) ? prev : [...prev, person.id]));
        setAddPickerOpen(false);
        setAddPickerSearch('');
    };

    const saveMembership = () => {
        const originalIds = new Set(members.map((m) => m.id));
        const draftIds = new Set(membershipDraft);
        // Added: in draft but not in original → add groupId to their assignments.
        draftIds.forEach((uid) => {
            if (!originalIds.has(uid)) {
                const current = getGroupsForUser(uid);
                if (!current.includes(groupId)) setGroupsForUser(uid, [...current, groupId]);
            }
        });
        // Removed: in original but not in draft → strip groupId from their assignments.
        originalIds.forEach((uid) => {
            if (!draftIds.has(uid)) {
                const current = getGroupsForUser(uid);
                setGroupsForUser(uid, current.filter((g) => g !== groupId));
            }
        });
        setMembershipEditing(false);
        setMembershipDraft([]);
        setAddUserId('');
    };

    const displayMembers = membershipEditing
        ? membershipDraft.map((id) => users.find((u) => u.id === id)).filter(Boolean)
        : members;

    // UBS personnel = members of the `users` array (login-capable operators).
    // The picker treats them as UBS-scoped staff and omits the clients
    // section entirely, matching the transcript speaker-assignment UI.
    const pickerItems = users
        .filter((u) => !membershipDraft.includes(u.id))
        .map((u) => {
            const profile = MOCK_USER_PROFILES[u.id] || {};
            return {
                id: u.id,
                name: profile.name || u.name,
                company: 'UBS',
                role: profile.designation || u.role,
                type: 'operator',
                profilePic: profile.profilePic || '/default_pfp.png',
            };
        });

    return (
        <div>
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-[0.6875rem] mb-2" style={{ color: '#7a7574' }}>
                <span className="uppercase tracking-widest" style={{ color: '#b20100' }}>Institutional Management</span>
                <span>/</span>
                <Link href="/admin/groups" className="uppercase tracking-widest no-underline" style={{ color: '#7a7574' }}>User Groups</Link>
                <span>/</span>
                <span className="uppercase tracking-widest">{meta.name}</span>
            </div>

            {/* Header */}
            <div className="flex items-end justify-between mb-8 pb-6 gap-6" style={{ borderBottom: '2px solid #1c1b1b' }}>
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-3">
                        <CategoryBadge category={meta.category} />
                        <span className="text-[0.5625rem] font-mono uppercase tracking-widest" style={{ color: '#7a7574' }}>{meta.id}</span>
                    </div>
                    <h1 className="text-[2.25rem] font-bold leading-none tracking-tight" style={{ color: '#1c1b1b', letterSpacing: '-0.03em' }}>
                        {meta.name}
                    </h1>
                    <p className="text-[0.8125rem] mt-3 max-w-2xl" style={{ color: '#1c1b1b' }}>{meta.description}</p>
                    <p className="text-[0.625rem] uppercase tracking-widest mt-2" style={{ color: '#7a7574' }}>
                        Repository: {meta.repositorySize} &middot; {members.length} member{members.length === 1 ? '' : 's'}
                    </p>
                </div>
                <button
                    onClick={() => router.push('/admin/groups')}
                    className="px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer shrink-0"
                    style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(233, 188, 181, 0.3)', borderRadius: 0, color: '#1c1b1b' }}
                >
                    Back
                </button>
            </div>

            {/* ── Two-column grid: left = members + audit; right = policies + clients ── */}
            <div className="grid grid-cols-3 gap-4">
                {/* LEFT COLUMN (2/3) */}
                <div className="col-span-2 space-y-4">
                    {/* Members */}
                    <section className="p-5" style={{ backgroundColor: '#ffffff' }}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-[0.875rem] font-bold uppercase tracking-widest" style={{ color: '#1c1b1b' }}>
                                    Members
                                    <span className="ml-2 text-[0.6875rem] font-semibold" style={{ color: '#7a7574' }}>({displayMembers.length})</span>
                                </h2>
                                <p className="text-[0.625rem] uppercase tracking-widest mt-1" style={{ color: '#7a7574' }}>
                                    {membershipEditing ? 'Editing — remember to save' : 'Who has access through this group'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {!membershipEditing ? (
                                    <button
                                        type="button"
                                        onClick={beginMembershipEdit}
                                        className="px-4 py-2 text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer"
                                        style={{ backgroundColor: 'transparent', border: '1.5px solid #1c1b1b', borderRadius: 0, color: '#1c1b1b' }}
                                    >
                                        Manage Members
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={cancelMembershipEdit}
                                            className="px-4 py-2 text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer"
                                            style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(233, 188, 181, 0.3)', borderRadius: 0, color: '#1c1b1b' }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={saveMembership}
                                            className="px-4 py-2 text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer"
                                            style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: 0 }}
                                        >
                                            Save Membership
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {displayMembers.length === 0 ? (
                            <p className="text-[0.75rem] p-4" style={{ color: '#7a7574', backgroundColor: '#f6f3f2' }}>
                                No members assigned to this group.
                            </p>
                        ) : (
                            <div>
                                {displayMembers.map((m) => (
                                    <div
                                        key={m.id}
                                        className="flex items-center gap-3 px-3 py-3"
                                        style={{ borderBottom: '1px solid rgba(233, 188, 181, 0.15)' }}
                                    >
                                        <OwnerBadge owner={m.name} size="sm" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[0.8125rem] font-bold truncate" style={{ color: '#1c1b1b' }}>{m.name}</p>
                                            <p className="text-[0.625rem]" style={{ color: '#7a7574' }}>{m.email}</p>
                                        </div>
                                        <RoleBadge role={m.role} />
                                        {membershipEditing && (
                                            <button
                                                type="button"
                                                onClick={() => removeMember(m.id)}
                                                className="text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer"
                                                style={{ backgroundColor: 'transparent', border: 'none', color: '#b20100' }}
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {membershipEditing && (
                            <div className="flex items-center justify-between gap-2 mt-4 pt-4" style={{ borderTop: '1px solid rgba(233, 188, 181, 0.2)' }}>
                                <p className="text-[0.6875rem] uppercase tracking-widest" style={{ color: '#7a7574' }}>
                                    {pickerItems.length > 0
                                        ? `${pickerItems.length} UBS personnel available to add`
                                        : 'All UBS personnel are already in this group'}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAddPickerSearch('');
                                        setAddPickerOpen(true);
                                    }}
                                    disabled={pickerItems.length === 0}
                                    className="px-4 py-2 text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ backgroundColor: '#1c1b1b', color: '#ffffff', border: 'none', borderRadius: 0 }}
                                >
                                    + Add Member
                                </button>
                            </div>
                        )}
                    </section>

                    {/* Audit log */}
                    <section className="p-5" style={{ backgroundColor: '#ffffff' }}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-[0.875rem] font-bold uppercase tracking-widest" style={{ color: '#1c1b1b' }}>
                                    Audit Log
                                    <span className="ml-2 text-[0.6875rem] font-semibold" style={{ color: '#7a7574' }}>({audit.length})</span>
                                </h2>
                                <p className="text-[0.625rem] uppercase tracking-widest mt-1" style={{ color: '#7a7574' }}>
                                    Every action by members of this group
                                </p>
                            </div>
                        </div>

                        {audit.length === 0 ? (
                            <p className="text-[0.75rem] p-4" style={{ color: '#7a7574', backgroundColor: '#f6f3f2' }}>
                                No activity yet. Events appear as members interact with recordings.
                            </p>
                        ) : (
                            <div style={{ maxHeight: '520px', overflowY: 'auto' }}>
                                {audit.map((ev) => {
                                    const actionMeta = AUDIT_ACTIONS[ev.action] || { label: ev.action, verb: ev.action, category: 'Other', color: '#7a7574' };
                                    return (
                                        <div
                                            key={ev.id}
                                            className="flex items-start gap-3 px-3 py-3"
                                            style={{ borderBottom: '1px solid rgba(233, 188, 181, 0.12)' }}
                                        >
                                            <span
                                                className="shrink-0 mt-1"
                                                style={{ width: '6px', height: '6px', backgroundColor: actionMeta.color, borderRadius: '50%' }}
                                                aria-hidden
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[0.75rem]" style={{ color: '#1c1b1b' }}>
                                                    <span className="font-bold">{ev.actorName}</span>{' '}
                                                    <span style={{ color: '#7a7574' }}>{actionMeta.verb}</span>{' '}
                                                    {ev.target && (
                                                        <span className="font-mono" style={{ color: '#1c1b1b' }}>{ev.target.name}</span>
                                                    )}
                                                </p>
                                                <div className="flex items-center gap-3 mt-1">
                                                    <span
                                                        className="text-[0.5625rem] font-semibold uppercase tracking-widest"
                                                        style={{ color: actionMeta.color }}
                                                    >
                                                        {actionMeta.category}
                                                    </span>
                                                    <span
                                                        className="text-[0.625rem]"
                                                        style={{ color: '#7a7574' }}
                                                        title={formatAbsolute(ev.timestamp)}
                                                    >
                                                        {formatRelative(ev.timestamp)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                </div>

                {/* RIGHT COLUMN (1/3) */}
                <div className="col-span-1 space-y-4">
                    {/* Permissions editor */}
                    <section className="p-5" style={{ backgroundColor: '#ffffff' }}>
                        <div className="flex items-start justify-between mb-3 gap-2">
                            <div>
                                <h2 className="text-[0.875rem] font-bold uppercase tracking-widest" style={{ color: '#1c1b1b' }}>Permissions</h2>
                                <p className="text-[0.625rem] uppercase tracking-widest mt-1" style={{ color: '#7a7574' }}>
                                    Actions members can perform
                                </p>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {ALL_PERMISSIONS.map((p) => {
                                const on = policyDraft.permissions.includes(p.key);
                                return (
                                    <button
                                        key={p.key}
                                        type="button"
                                        onClick={() => togglePolicyKey('permissions', p.key)}
                                        className="w-full flex items-start gap-2 p-2 text-left cursor-pointer"
                                        style={{
                                            backgroundColor: on ? 'rgba(178, 1, 0, 0.06)' : '#f6f3f2',
                                            border: `1.5px solid ${on ? '#b20100' : 'transparent'}`,
                                            borderRadius: 0,
                                        }}
                                    >
                                        <span
                                            className="mt-0.5 shrink-0"
                                            style={{
                                                width: '12px',
                                                height: '12px',
                                                backgroundColor: on ? '#b20100' : 'transparent',
                                                border: `1.5px solid ${on ? '#b20100' : '#c4c4c4'}`,
                                            }}
                                            aria-hidden
                                        >
                                            {on && (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="square">
                                                    <path d="M5 12l5 5L20 7" />
                                                </svg>
                                            )}
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[0.75rem] font-bold" style={{ color: '#1c1b1b' }}>{p.label}</p>
                                            <p className="text-[0.625rem] mt-0.5" style={{ color: '#7a7574' }}>{p.description}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    {/* Resources editor */}
                    <section className="p-5" style={{ backgroundColor: '#ffffff' }}>
                        <div className="flex items-start justify-between mb-3 gap-2">
                            <div>
                                <h2 className="text-[0.875rem] font-bold uppercase tracking-widest" style={{ color: '#1c1b1b' }}>Resources</h2>
                                <p className="text-[0.625rem] uppercase tracking-widest mt-1" style={{ color: '#7a7574' }}>
                                    Surfaces this group can reach
                                </p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {ALL_RESOURCES.map((r) => {
                                const on = policyDraft.resources.includes(r.key);
                                return (
                                    <button
                                        key={r.key}
                                        type="button"
                                        onClick={() => togglePolicyKey('resources', r.key)}
                                        className="flex items-center gap-2 p-2 cursor-pointer"
                                        style={{
                                            backgroundColor: on ? 'rgba(178, 1, 0, 0.06)' : '#f6f3f2',
                                            border: `1.5px solid ${on ? '#b20100' : 'transparent'}`,
                                            borderRadius: 0,
                                        }}
                                    >
                                        <span
                                            className="shrink-0"
                                            style={{
                                                width: '10px',
                                                height: '10px',
                                                backgroundColor: on ? '#b20100' : 'transparent',
                                                border: `1.5px solid ${on ? '#b20100' : '#c4c4c4'}`,
                                            }}
                                            aria-hidden
                                        />
                                        <span className="text-[0.6875rem] font-semibold" style={{ color: '#1c1b1b' }}>{r.label}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {policyDirty && (
                            <div className="flex items-center justify-between gap-2 mt-4 pt-4" style={{ borderTop: '1px solid rgba(233, 188, 181, 0.3)' }}>
                                <span className="text-[0.625rem] uppercase tracking-widest" style={{ color: '#b20100' }}>Unsaved changes</span>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={revertPolicy}
                                        className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer"
                                        style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(233, 188, 181, 0.3)', borderRadius: 0, color: '#1c1b1b' }}
                                    >
                                        Revert
                                    </button>
                                    <button
                                        type="button"
                                        onClick={savePolicy}
                                        className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer"
                                        style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: 0 }}
                                    >
                                        Save Policy
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* External clients */}
                    <section className="p-5" style={{ backgroundColor: '#ffffff' }}>
                        <div className="mb-4">
                            <h2 className="text-[0.875rem] font-bold uppercase tracking-widest" style={{ color: '#1c1b1b' }}>
                                External Clients
                                <span className="ml-2 text-[0.6875rem] font-semibold" style={{ color: '#7a7574' }}>({clientInteractions.length})</span>
                            </h2>
                            <p className="text-[0.625rem] uppercase tracking-widest mt-1" style={{ color: '#7a7574' }}>
                                Counterparties this group has touched
                            </p>
                        </div>
                        {clientInteractions.length === 0 ? (
                            <p className="text-[0.75rem] p-3" style={{ color: '#7a7574', backgroundColor: '#f6f3f2' }}>
                                No external clients associated.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {clientInteractions.map((c) => (
                                    <div key={c.id} className="p-3" style={{ backgroundColor: '#f6f3f2' }}>
                                        <div className="flex items-start justify-between gap-2 mb-1">
                                            <p className="text-[0.75rem] font-bold truncate" style={{ color: '#1c1b1b' }}>{c.name}</p>
                                            {c.riskLevel === 'elevated' && (
                                                <span className="text-[0.5rem] font-semibold uppercase tracking-widest px-1.5 py-0.5" style={{ backgroundColor: '#b20100', color: '#ffffff' }}>
                                                    Elevated
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[0.625rem] truncate" style={{ color: '#7a7574' }}>{c.company}</p>
                                        <p className="text-[0.5625rem] uppercase tracking-widest mt-1" style={{ color: '#7a7574' }}>{c.region}</p>
                                        <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid rgba(233, 188, 181, 0.3)' }}>
                                            <span className="text-[0.625rem]" style={{ color: '#1c1b1b' }}>
                                                <span className="font-bold">{c.callCount}</span> calls
                                            </span>
                                            <span className="text-[0.625rem]" style={{ color: '#7a7574' }} title={formatAbsolute(c.lastContactIso)}>
                                                {formatRelative(c.lastContactIso)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>

            {/* Footer audit strip */}
            <div className="flex items-center justify-between mt-10 pt-4 text-[0.5625rem] uppercase tracking-widest" style={{ color: '#7a7574', borderTop: '1px solid rgba(233, 188, 181, 0.2)' }}>
                <span>Policy: {policy.permissions.length} permissions · {policy.resources.length} resources</span>
                <span>Persisted in localStorage</span>
                <span>Audit derived from member actions</span>
            </div>

            {/* Add-member picker — reuses the transcript speaker-assignment UI,
                filtered to UBS operators (no clients section). */}
            <Dialog
                open={addPickerOpen}
                onClose={() => {
                    setAddPickerOpen(false);
                    setAddPickerSearch('');
                }}
                title={`Add a member to ${meta.name}`}
            >
                <input
                    value={addPickerSearch}
                    onChange={(e) => setAddPickerSearch(e.target.value)}
                    placeholder="Search by name or company..."
                    autoFocus
                    className="w-full text-[0.8125rem] px-3 py-2 mb-3 outline-none"
                    style={{ backgroundColor: '#f6f3f2', border: '1px solid #f0edec', color: '#1c1b1b' }}
                />

                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                    {pickerItems.length === 0 ? (
                        <p className="px-1 py-6 text-[0.8125rem] text-center" style={{ color: '#7a7574' }}>
                            All UBS personnel are already assigned to this group.
                        </p>
                    ) : (
                        <SpeakerPickerSection
                            label="Operators (UBS)"
                            items={pickerItems}
                            search={addPickerSearch}
                            onPick={pickMember}
                            currentId={null}
                        />
                    )}
                </div>
            </Dialog>

            {/* Confirmation dialog for membership edit */}
            {confirmOpen && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{ backgroundColor: 'rgba(28, 27, 27, 0.55)' }}
                    onClick={() => setConfirmOpen(false)}
                >
                    <div
                        className="p-6"
                        style={{ backgroundColor: '#ffffff', width: '480px', maxWidth: '100%', borderTop: '3px solid #b20100' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: '#b20100' }}>
                            Confirm membership edit
                        </p>
                        <h3 className="text-[1.25rem] font-bold tracking-tight mb-3" style={{ color: '#1c1b1b', letterSpacing: '-0.01em' }}>
                            Modify who can access {meta.name}?
                        </h3>
                        <p className="text-[0.8125rem] leading-relaxed mb-3" style={{ color: '#1c1b1b' }}>
                            Changing membership on this group grants or revokes access to its repository ({meta.repositorySize}) effective immediately at the next session refresh.
                        </p>
                        <ul className="text-[0.75rem] leading-relaxed mb-5 pl-4 space-y-1" style={{ color: '#7a7574', listStyle: 'disc' }}>
                            <li>Added users inherit every permission configured on this group.</li>
                            <li>Removed users lose visibility into files scoped to this group.</li>
                            <li>The change is logged to the audit trail under your admin account.</li>
                        </ul>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirmOpen(false)}
                                className="px-4 py-2 text-[0.75rem] font-semibold uppercase tracking-widest cursor-pointer"
                                style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(28,27,27,0.2)', borderRadius: 0, color: '#1c1b1b' }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmMembershipEdit}
                                className="px-5 py-2 text-[0.75rem] font-semibold uppercase tracking-widest cursor-pointer"
                                style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: 0 }}
                            >
                                I understand — continue
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
