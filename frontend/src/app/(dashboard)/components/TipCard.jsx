'use client';

import { useState, useEffect, useRef } from 'react';

// Vertical gap between the tip button and the retract-sidebar button below it.
// Increase this value to push the tip button further up the sidebar.
const BUTTON_GAP = '0.4rem';

// Number of tips preloaded into the cycle when the user first clicks the button.
const PRELOAD_COUNT = 4;

const TIPS = [
    'Drop audio files anywhere on the transcripts page to queue them instantly.',
    'Star transcripts to pin them to the top of your recent view.',
    'Use Privacy Flags to mask PII before sharing transcripts outside your group.',
    'Assign colleagues to a group once, then share whole folders in one click.',
    'Check the Metrics Dashboard weekly to track accuracy trends across your team.',
    'Items in Trash auto-purge after 30 days — restore them before then.',
    'Press Ctrl+K anywhere in the app to jump to a transcript by name.',
];

function buildQueue(count) {
    const pool = [...TIPS];
    // Fisher-Yates shuffle, then take `count` items (cycling if TIPS has fewer).
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const queue = [];
    for (let i = 0; i < count; i++) queue.push(pool[i % pool.length]);
    return queue;
}

export default function TipCard({ collapsed = false }) {
    const [open, setOpen] = useState(false);
    const [queue, setQueue] = useState(null);
    const [cursor, setCursor] = useState(0);
    const containerRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    useEffect(() => {
        if (collapsed) setOpen(false);
    }, [collapsed]);

    const handleClick = () => {
        if (queue === null) {
            setQueue(buildQueue(PRELOAD_COUNT));
            setCursor(0);
            setOpen(true);
            return;
        }
        if (!open) {
            setOpen(true);
            return;
        }
        setCursor((c) => (c + 1) % queue.length);
    };

    const tip = queue ? queue[cursor] : '';

    const popoverStyle = collapsed
        ? { left: '100%', bottom: 0, marginLeft: '0.5rem', width: '14rem' }
        : { left: '0.75rem', right: '0.75rem', bottom: '100%', marginBottom: '0.5rem' };

    return (
        <div
            className="relative flex justify-end px-3"
            style={{ paddingBottom: BUTTON_GAP }}
            ref={containerRef}
        >
            {open && (
                <div
                    className="absolute"
                    style={{
                        ...popoverStyle,
                        backgroundColor: '#f9f9f9',
                        borderRadius: '0px',
                        boxShadow: '0 20px 40px rgba(0,0,0,0.06)',
                    }}
                >
                    <div className="relative px-4 py-4">
                        <span
                            aria-hidden
                            className="absolute left-0 top-0 h-6 w-[3px]"
                            style={{ backgroundColor: '#c20000' }}
                        />
                        <p className="text-[0.75rem] leading-snug" style={{ color: '#4a4746' }}>
                            {tip}
                        </p>
                    </div>
                </div>
            )}
            <button
                type="button"
                onClick={handleClick}
                aria-label="Show tip"
                aria-expanded={open}
                className="w-8 h-8 flex items-center justify-center cursor-pointer rounded-full transition-all duration-200"
                style={{
                    backgroundColor: open ? '#1c1b1b' : 'transparent',
                    border: '1px solid #e8e4e3',
                    color: open ? '#ffffff' : '#7a7574',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                }}
                onMouseEnter={(e) => {
                    if (open) return;
                    e.currentTarget.style.backgroundColor = '#f6f3f2';
                    e.currentTarget.style.color = '#1c1b1b';
                }}
                onMouseLeave={(e) => {
                    if (open) return;
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#7a7574';
                }}
            >
                ?
            </button>
        </div>
    );
}
