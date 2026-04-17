'use client';

// Shared picker row list. Renders a single labelled section of people that
// can be picked from. Used by the transcript speaker-assignment dialog and
// by the admin group-management "ADD USER" dialog — both want the same
// visual + search behaviour against a list of people with a photo,
// name, company and role.
//
// Props
//   label       section title above the rows (e.g. "Operators (UBS)").
//   items       [{ id, name, company, role, profilePic, type }]
//   search      current search query (trimmed + lowercased internally).
//   onPick      called with the full person object when a row is clicked.
//   currentId   id of the currently-selected person for the check mark /
//               accent treatment. Pass null if none.
export default function SpeakerPickerSection({
    label,
    items,
    search,
    onPick,
    currentId,
}) {
    const q = search.trim().toLowerCase();
    const filtered = q
        ? items.filter(
              (p) =>
                  p.name.toLowerCase().includes(q) ||
                  p.company.toLowerCase().includes(q),
          )
        : items;
    if (filtered.length === 0) return null;
    return (
        <div className="mb-3">
            <p
                className="text-[0.625rem] font-semibold uppercase tracking-wider mb-1 px-1"
                style={{ color: '#7a7574' }}
            >
                {label}
            </p>
            <div className="space-y-0.5">
                {filtered.map((person) => {
                    const isSelected = person.id === currentId;
                    return (
                        <button
                            key={person.id}
                            onClick={() => onPick(person)}
                            className="w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer transition-colors"
                            style={{
                                backgroundColor: isSelected
                                    ? 'rgba(0, 78, 198, 0.06)'
                                    : 'transparent',
                                border: isSelected
                                    ? '1px solid rgba(0, 78, 198, 0.2)'
                                    : '1px solid transparent',
                                color: '#1c1b1b',
                            }}
                            onMouseEnter={(e) => {
                                if (!isSelected)
                                    e.currentTarget.style.backgroundColor = '#f6f3f2';
                            }}
                            onMouseLeave={(e) => {
                                if (!isSelected)
                                    e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                        >
                            <img
                                src={person.profilePic || '/default_pfp.png'}
                                alt=""
                                className="w-7 h-7 shrink-0 object-cover"
                                style={{
                                    borderRadius: '0px',
                                    border: isSelected
                                        ? '2px solid #004ec6'
                                        : '2px solid transparent',
                                }}
                            />
                            <div className="flex-1 min-w-0">
                                <p className="text-[0.8125rem] font-medium truncate">
                                    {person.name}
                                </p>
                                <p
                                    className="text-[0.6875rem] truncate"
                                    style={{ color: '#7a7574' }}
                                >
                                    {person.company} &middot; {person.role}
                                </p>
                            </div>
                            {isSelected && (
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="#004ec6"
                                    strokeWidth="2.5"
                                >
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
