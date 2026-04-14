'use client';

import { useEffect, useState } from 'react';
import {
    getTimeFormat,
    setTimeFormat,
    TIME_FORMAT_EVENT,
    TIME_FORMAT_KEY,
} from '../../../../lib/timeFormat';

const TIME_FORMAT_CHOICES = [
    { value: '12h', label: '12-HOUR', hint: '3:25 PM' },
    { value: '24h', label: '24-HOUR', hint: '15:25' },
];

export default function InterfacePreferences({ preferences }) {
    const [timeFormat, setTimeFormatLocal] = useState('12h');

    useEffect(() => {
        setTimeFormatLocal(getTimeFormat());
        const handleCustom = (e) =>
            setTimeFormatLocal(e.detail ?? getTimeFormat());
        const handleStorage = (e) => {
            if (e.key === TIME_FORMAT_KEY)
                setTimeFormatLocal(getTimeFormat());
        };
        window.addEventListener(TIME_FORMAT_EVENT, handleCustom);
        window.addEventListener('storage', handleStorage);
        return () => {
            window.removeEventListener(TIME_FORMAT_EVENT, handleCustom);
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    const handleSelect = (value) => {
        setTimeFormatLocal(value);
        setTimeFormat(value);
    };

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
                <div>
                    <p
                        className="text-[0.625rem] uppercase tracking-wider mb-3"
                        style={{ color: '#7a7574' }}
                    >
                        Time Format
                    </p>
                    <div className="flex gap-2">
                        {TIME_FORMAT_CHOICES.map((choice) => {
                            const active = timeFormat === choice.value;
                            return (
                                <button
                                    key={choice.value}
                                    onClick={() => handleSelect(choice.value)}
                                    className="px-3 py-1.5 text-[0.75rem] font-semibold cursor-pointer"
                                    style={{
                                        backgroundColor: active
                                            ? '#1c1b1b'
                                            : '#f6f3f2',
                                        color: active ? '#ffffff' : '#1c1b1b',
                                        border: 'none',
                                        borderRadius: '0px',
                                    }}
                                >
                                    {choice.label}
                                </button>
                            );
                        })}
                    </div>
                    <p
                        className="text-[0.6875rem] mt-2"
                        style={{ color: '#7a7574' }}
                    >
                        Example:{' '}
                        {
                            TIME_FORMAT_CHOICES.find(
                                (c) => c.value === timeFormat,
                            )?.hint
                        }
                    </p>
                </div>
            </div>
        </div>
    );
}
