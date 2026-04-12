'use client';

export default function UserStatistics({ stats }) {
    const maxCount = Math.max(...stats.daily.map((d) => d.count), 1);

    return (
        <div className="p-5" style={{ backgroundColor: '#1c1b1b' }}>
            <h3
                className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-2"
                style={{ color: '#7a7574' }}
            >
                User Statistics
            </h3>
            <p
                className="text-[0.625rem] uppercase tracking-wider mb-1"
                style={{ color: '#7a7574' }}
            >
                Recordings Handled (Last 5 Days)
            </p>
            <p
                className="text-[3rem] font-bold leading-none mb-4"
                style={{ color: '#ffffff', letterSpacing: '-0.02em' }}
            >
                {stats.total}
            </p>
            <div className="space-y-2">
                {stats.daily.map((d) => (
                    <div
                        key={d.day}
                        className="flex items-center gap-3"
                    >
                        <span
                            className="text-[0.6875rem] w-6 shrink-0"
                            style={{ color: '#7a7574' }}
                        >
                            {d.day}
                        </span>
                        <div
                            className="flex-1 h-2"
                            style={{
                                backgroundColor:
                                    'rgba(255,255,255,0.08)',
                            }}
                        >
                            <div
                                className="h-2"
                                style={{
                                    width: `${(d.count / maxCount) * 100}%`,
                                    backgroundColor: '#b20100',
                                }}
                            />
                        </div>
                        <span
                            className="text-[0.6875rem] w-6 text-right shrink-0"
                            style={{ color: '#ffffff' }}
                        >
                            {d.count}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
