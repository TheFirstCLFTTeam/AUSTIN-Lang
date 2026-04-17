'use client';

import { users, MOCK_USER_PROFILES } from '../../../services/mock_data-users';

// Accepts any of: a user id (e.g. "u2"), an operator short-form name (e.g.
// "R. Nakamura"), or a full name (e.g. "Engineer User") and resolves it
// back to a { profilePic, displayName } pair.
//
// The short-form name comes from MOCK_USER_PROFILES (matches what the rest
// of the app renders — e.g. the transcript speaker pills and the verifier
// chip on the file detail page). If nothing resolves, we fall back to a
// neutral initial disc so rows don't break visually.
function resolveOwner(ownerRef) {
    if (!ownerRef) return null;
    const idMatch = MOCK_USER_PROFILES[ownerRef];
    if (idMatch) return { displayName: idMatch.name, profilePic: idMatch.profilePic };

    // Match against full-name in users[]
    const userByName = users.find((u) => u.name === ownerRef);
    if (userByName) {
        const prof = MOCK_USER_PROFILES[userByName.id];
        if (prof) return { displayName: prof.name, profilePic: prof.profilePic };
    }

    // Match against short-form name in MOCK_USER_PROFILES
    const profByShortName = Object.values(MOCK_USER_PROFILES).find((p) => p.name === ownerRef);
    if (profByShortName) return { displayName: profByShortName.name, profilePic: profByShortName.profilePic };

    return null;
}

function initialsOf(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase() || '?';
}

// Size presets keep the badge consistent wherever it's rendered.
const SIZES = {
    xs: { pic: 16, gap: 'gap-1.5', text: 'text-[0.75rem]' },
    sm: { pic: 20, gap: 'gap-2', text: 'text-[0.8125rem]' },
    md: { pic: 24, gap: 'gap-2', text: 'text-[0.875rem]' },
};

export default function OwnerBadge({
    owner,
    selfId,
    size = 'sm',
    fallbackLabel = '\u2014',
    justify = 'start',
}) {
    const preset = SIZES[size] || SIZES.sm;
    const isSelf = selfId != null && owner === selfId;
    const resolved = resolveOwner(owner);
    const displayName = isSelf ? 'You' : resolved?.displayName || owner || fallbackLabel;
    const isResolved = Boolean(resolved) || isSelf;
    const justifyClass = justify === 'center' ? 'justify-center' : justify === 'end' ? 'justify-end' : '';

    if (!owner && !isSelf) {
        return <span style={{ color: '#7a7574' }}>{fallbackLabel}</span>;
    }

    return (
        <div className={`flex items-center ${preset.gap} ${justifyClass} min-w-0`}>
            {resolved?.profilePic ? (
                <img
                    src={resolved.profilePic}
                    alt=""
                    className="shrink-0 object-cover"
                    style={{ width: preset.pic, height: preset.pic, borderRadius: '50%' }}
                />
            ) : (
                <span
                    className="shrink-0 inline-flex items-center justify-center text-[0.625rem] font-bold"
                    style={{
                        width: preset.pic,
                        height: preset.pic,
                        borderRadius: '50%',
                        backgroundColor: '#f0edec',
                        color: '#7a7574',
                    }}
                    aria-hidden
                >
                    {isSelf ? 'Y' : initialsOf(displayName)}
                </span>
            )}
            <span
                className={`${preset.text} truncate`}
                style={{ color: isResolved ? '#1c1b1b' : '#7a7574' }}
                title={displayName}
            >
                {displayName}
            </span>
        </div>
    );
}
