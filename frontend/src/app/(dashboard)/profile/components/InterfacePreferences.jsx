'use client';

export default function InterfacePreferences({ preferences }) {
    return (
        <div className="p-5" style={{ backgroundColor: '#ffffff' }}>
            <h3
                className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-4"
                style={{ color: '#7a7574' }}
            >
                Interface Preferences
            </h3>
            <div className="flex gap-10">
                <div>
                    <p
                        className="text-[0.625rem] uppercase tracking-wider mb-3"
                        style={{ color: '#7a7574' }}
                    >
                        Localization
                    </p>
                    <div className="flex gap-2">
                        <span
                            className="px-3 py-1.5 text-[0.75rem] font-semibold"
                            style={{
                                backgroundColor: '#1c1b1b',
                                color: '#ffffff',
                                borderRadius: '0px',
                            }}
                        >
                            PRIMARY
                        </span>
                        <span
                            className="px-3 py-1.5 text-[0.75rem] font-semibold"
                            style={{
                                backgroundColor: '#f6f3f2',
                                color: '#1c1b1b',
                                borderRadius: '0px',
                            }}
                        >
                            {preferences.localization.primary.toUpperCase()}
                        </span>
                    </div>
                    {preferences.localization.secondary && (
                        <div className="flex gap-2 mt-2">
                            <span
                                className="px-3 py-1.5 text-[0.75rem] font-semibold"
                                style={{
                                    backgroundColor: '#f6f3f2',
                                    color: '#7a7574',
                                    borderRadius: '0px',
                                }}
                            >
                                SECONDARY
                            </span>
                            <span
                                className="px-3 py-1.5 text-[0.75rem] font-semibold"
                                style={{
                                    backgroundColor: '#f6f3f2',
                                    color: '#7a7574',
                                    borderRadius: '0px',
                                }}
                            >
                                {preferences.localization.secondary.toUpperCase()}
                            </span>
                        </div>
                    )}
                </div>
                <div>
                    <p
                        className="text-[0.625rem] uppercase tracking-wider mb-3"
                        style={{ color: '#7a7574' }}
                    >
                        Notifications
                    </p>
                    <div className="space-y-2">
                        {preferences.notifications.map((n) => (
                            <div
                                key={n}
                                className="flex items-center gap-2"
                            >
                                <span
                                    className="w-2 h-2 shrink-0"
                                    style={{
                                        backgroundColor: '#b20100',
                                        borderRadius: '0px',
                                    }}
                                />
                                <span
                                    className="text-[0.75rem] font-semibold"
                                    style={{ color: '#1c1b1b' }}
                                >
                                    {n.toUpperCase()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
