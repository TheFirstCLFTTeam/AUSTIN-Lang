'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MOCK_FILE_STORE } from '@/services/mock-data';

const MAX_RESULTS = 8;

function scoreMatch(name, query) {
  if (!query) return 1;
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  const idx = n.indexOf(q);
  if (idx === -1) return 0;
  // Earlier matches + shorter filenames rank higher.
  return 1000 - idx - n.length * 0.1;
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Global Ctrl+K / Cmd+K listener. preventDefault overrides Chrome's
  // default (Ctrl+K = focus omnibox for search).
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const files = MOCK_FILE_STORE || [];
    if (!query) {
      return files.slice(0, MAX_RESULTS).map((f) => ({ file: f, score: 0 }));
    }
    const scored = files
      .map((f) => ({ file: f, score: scoreMatch(f.name || '', query) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
    return scored;
  }, [query]);

  useEffect(() => {
    if (cursor >= results.length) setCursor(Math.max(0, results.length - 1));
  }, [results, cursor]);

  // Auto-scroll active item into view inside the results list.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [cursor]);

  const jumpTo = (file) => {
    if (!file) return;
    setOpen(false);
    router.push(`/files/${file.id}`);
  };

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      jumpTo(results[cursor]?.file);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setCursor(results.length - 1);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Jump to transcript"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(28, 27, 27, 0.45)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 92vw)',
          backgroundColor: '#ffffff',
          boxShadow: '0 12px 40px rgba(28, 27, 27, 0.35)',
          borderRadius: 0,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '70vh',
        }}
      >
        <div className="flex items-center gap-3 px-5" style={{ borderBottom: '1.5px solid #1c1b1b', height: '56px' }}>
          <span className="text-[0.625rem] font-semibold uppercase tracking-widest" style={{ color: '#b20100' }}>
            Jump to
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={onInputKey}
            placeholder="Search transcripts by name…"
            className="flex-1"
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: '0.9375rem',
              color: '#1c1b1b',
              padding: '8px 0',
            }}
          />
          <span
            className="text-[0.5625rem] font-semibold uppercase tracking-widest"
            style={{ color: '#7a7574', border: '1px solid #c4c4c4', padding: '2px 6px' }}
          >
            Esc
          </span>
        </div>

        <div
          ref={listRef}
          style={{ overflowY: 'auto', flex: 1 }}
        >
          {results.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[0.8125rem]" style={{ color: '#7a7574' }}>No transcripts match &ldquo;{query}&rdquo;.</p>
            </div>
          ) : (
            results.map(({ file }, idx) => {
              const active = idx === cursor;
              return (
                <div
                  key={file.id}
                  data-idx={idx}
                  role="button"
                  tabIndex={-1}
                  onClick={() => jumpTo(file)}
                  onMouseEnter={() => setCursor(idx)}
                  className="flex items-center justify-between px-5 py-3 cursor-pointer"
                  style={{
                    backgroundColor: active ? 'rgba(178, 1, 0, 0.06)' : 'transparent',
                    borderLeft: active ? '3px solid #b20100' : '3px solid transparent',
                    borderBottom: '1px solid rgba(233, 188, 181, 0.15)',
                  }}
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <p className="text-[0.8125rem] font-bold truncate" style={{ color: '#1c1b1b' }}>
                      {highlightMatch(file.name || '', query)}
                    </p>
                    <p className="text-[0.625rem] mt-0.5 truncate" style={{ color: '#7a7574' }}>
                      {file.duration || ''}{file.duration && file.dataset ? ' · ' : ''}{file.dataset || ''}
                    </p>
                  </div>
                  {active && (
                    <span className="text-[0.5625rem] font-semibold uppercase tracking-widest" style={{ color: '#b20100' }}>
                      Open &rarr;
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div
          className="flex items-center justify-between px-5"
          style={{ borderTop: '1px solid rgba(233, 188, 181, 0.3)', backgroundColor: '#f6f3f2', height: '36px' }}
        >
          <div className="flex items-center gap-4 text-[0.5625rem] font-semibold uppercase tracking-widest" style={{ color: '#7a7574' }}>
            <span><kbd style={kbdStyle}>↑</kbd> <kbd style={kbdStyle}>↓</kbd> Navigate</span>
            <span><kbd style={kbdStyle}>↵</kbd> Open</span>
            <span><kbd style={kbdStyle}>Esc</kbd> Close</span>
          </div>
          <span className="text-[0.5625rem] uppercase tracking-widest" style={{ color: '#7a7574' }}>
            {results.length} match{results.length === 1 ? '' : 'es'}
          </span>
        </div>
      </div>
    </div>
  );
}

const kbdStyle = {
  display: 'inline-block',
  padding: '1px 5px',
  border: '1px solid #c4c4c4',
  borderRadius: 0,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.5625rem',
  lineHeight: 1,
  color: '#1c1b1b',
  backgroundColor: '#ffffff',
};

function highlightMatch(name, query) {
  if (!query) return name;
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <span style={{ backgroundColor: 'rgba(178, 1, 0, 0.15)', color: '#b20100', padding: '0 2px' }}>
        {name.slice(idx, idx + query.length)}
      </span>
      {name.slice(idx + query.length)}
    </>
  );
}
