'use client';

import { useEffect, useRef } from 'react';

export default function Dialog({ open, onClose, title, children }) {
    const backdropRef = useRef(null);

    useEffect(() => {
        if (open) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [open]);

    if (!open) return null;

    return (
        <div
            ref={backdropRef}
            onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(28, 27, 27, 0.6)' }}
        >
            <div
                className="w-full max-w-md p-6"
                style={{ backgroundColor: '#ffffff' }}
            >
                <div className="flex items-center justify-between mb-5">
                    <h2
                        className="text-[0.875rem] font-bold uppercase tracking-wider"
                        style={{ color: '#1c1b1b' }}
                    >
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 flex items-center justify-center cursor-pointer transition-colors"
                        style={{ backgroundColor: '#f6f3f2', border: 'none', color: '#1c1b1b' }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#b20100'; e.currentTarget.style.color = '#ffffff'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f6f3f2'; e.currentTarget.style.color = '#1c1b1b'; }}
                        aria-label="Close"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
                            <path d="M18 6L6 18" />
                            <path d="M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
