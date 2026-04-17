// Status lifecycle for recording + transcript pairs.
//
// Flow:
//   transcribing → transcribed → in review → completed  (done — reviewer approved)
//                                    ↓
//                               needs action → in review  (loop until completed)

export const VALID_TRANSITIONS = {
    'transcribing': ['transcribed'],
    'transcribed':  ['in review'],
    'in review':    ['completed', 'needs action'],
    'needs action': ['in review'],
    'completed':    [],                       // terminal state — reviewer approved
};

export const ALL_STATUSES = Object.keys(VALID_TRANSITIONS);

// Returns true if moving from `current` to `next` is allowed.
export function canTransition(current, next) {
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed) return false;
    return allowed.includes(next);
}

// Throws if the transition is invalid; returns `next` on success.
export function assertTransition(current, next) {
    if (!canTransition(current, next)) {
        throw new Error(
            `Invalid status transition: "${current}" → "${next}". ` +
            `Allowed: ${(VALID_TRANSITIONS[current] || []).join(', ') || 'none (terminal state)'}`,
        );
    }
    return next;
}
