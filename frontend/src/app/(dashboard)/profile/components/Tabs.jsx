'use client';

export default function Tabs({ tabs, activeId, onChange }) {
    return (
        <div className="flex" style={{ backgroundColor: '#ffffff' }}>
            {tabs.map((tab) => {
                const active = tab.id === activeId;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onChange(tab.id)}
                        className="relative px-5 py-3 text-[0.6875rem] font-semibold uppercase cursor-pointer transition-colors"
                        style={{
                            color: active ? '#1c1b1b' : '#7a7574',
                            backgroundColor: 'transparent',
                            letterSpacing: '0.1em',
                            border: 'none',
                            borderRadius: '0px',
                        }}
                        onMouseEnter={(e) => {
                            if (active) return;
                            e.currentTarget.style.color = '#1c1b1b';
                        }}
                        onMouseLeave={(e) => {
                            if (active) return;
                            e.currentTarget.style.color = '#7a7574';
                        }}
                    >
                        {tab.label}
                        {active && (
                            <span
                                aria-hidden
                                className="absolute left-0 right-0 bottom-0"
                                style={{ height: '2px', backgroundColor: '#c20000' }}
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
}
