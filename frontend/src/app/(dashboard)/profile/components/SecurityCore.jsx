'use client';

export default function SecurityCore({ security }) {
    return (
        <div className="p-5" style={{ backgroundColor: '#ffffff' }}>
            <div className="flex items-center justify-between mb-4">
                <h3
                    className="text-[0.6875rem] font-semibold uppercase tracking-wider"
                    style={{ color: '#7a7574' }}
                >
                    Security Core
                </h3>
                <span
                    className="text-[0.625rem] font-bold uppercase tracking-wider"
                    style={{ color: '#22c55e' }}
                >
                    {security.status.toUpperCase()}
                </span>
            </div>
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <p
                            className="text-[0.8125rem] font-bold"
                            style={{ color: '#1c1b1b' }}
                        >
                            Multi-Factor Auth
                        </p>
                        <p
                            className="text-[0.625rem]"
                            style={{ color: '#7a7574' }}
                        >
                            {security.mfaEnabled ?
                                'Hardware Token, Biometric'
                            :   'Not configured'}
                        </p>
                    </div>
                    <button
                        className="px-3 py-1.5 text-[0.6875rem] font-semibold cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            border: '1.5px solid rgba(233, 188, 181, 0.3)',
                            borderRadius: '0px',
                            color: '#1c1b1b',
                        }}
                    >
                        MANAGE
                    </button>
                </div>
                <div>
                    <p
                        className="text-[0.8125rem] font-bold mb-2"
                        style={{ color: '#1c1b1b' }}
                    >
                        Active Sessions
                    </p>
                    <div className="space-y-1.5">
                        {security.activeSessions.map((s) => (
                            <div
                                key={s.id}
                                className="flex items-center gap-2"
                            >
                                <span
                                    className="w-1.5 h-1.5"
                                    style={{
                                        backgroundColor: '#22c55e',
                                        borderRadius: '0px',
                                    }}
                                />
                                <span
                                    className="text-[0.75rem]"
                                    style={{ color: '#1c1b1b' }}
                                >
                                    {s.label}
                                </span>
                            </div>
                        ))}
                    </div>
                    <p
                        className="text-[0.625rem] mt-2"
                        style={{ color: '#7a7574' }}
                    >
                        TOTAL: {security.activeSessions.length}
                    </p>
                </div>
            </div>
        </div>
    );
}
