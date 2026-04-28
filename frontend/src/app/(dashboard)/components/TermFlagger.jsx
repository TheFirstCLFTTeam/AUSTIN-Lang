'use client';

// Selection-based "💼 Add to financial dictionary" affordance for the
// transcript editor. Mounts inside the transcript scroll area; listens for
// text selection inside the container; renders a small floating button when
// the selection looks like a plausible term (1-5 words, no sentence-internal
// punctuation). Click → modal pre-fills the term + asks "did the model get
// it right?". Submit POSTs to /api/financial-terms + /occurrences.
//
// Spec: docs/07 Integration CAA 27APR2026/financial-terms-dictionary.md §7.
// Rendering nothing while no selection is active means zero visual weight
// in the default editor view.

import { useCallback, useEffect, useRef, useState } from 'react';

import { recordOccurrence, submitTerm } from '@/services/financial-terms';
import Dialog from './Dialog';


// Heuristic: is this selection plausibly a term?
//   - 1 to 5 whitespace-delimited tokens
//   - no internal sentence punctuation (.,!? followed by space, indicating
//     it spans more than one sentence)
function looksLikeTerm(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (trimmed.length > 80) return false;
    // Sentence punctuation followed by whitespace = probably multi-sentence
    if (/[.!?]\s/.test(trimmed)) return false;
    const tokens = trimmed.split(/\s+/);
    return tokens.length >= 1 && tokens.length <= 5;
}


export default function TermFlagger({ fileId, containerRef }) {
    const [selection, setSelection] = useState(null); // { text, x, y } | null
    const [modalOpen, setModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const buttonRef = useRef(null);

    // Form state
    const [termText, setTermText] = useState('');
    const [category, setCategory] = useState('');
    const [wasCorrect, setWasCorrect] = useState(true);
    const [note, setNote] = useState('');

    // ── Selection tracking ────────────────────────────────────────────────

    const onSelectionChange = useCallback(() => {
        // If the modal is open we're freezing the selection — don't react
        // to it being lost when the dialog grabs focus.
        if (modalOpen) return;

        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
            setSelection(null);
            return;
        }
        const range = sel.getRangeAt(0);
        const text = sel.toString();

        // Only consider selections inside the transcript container.
        const container = containerRef?.current;
        if (container) {
            const ancestor = range.commonAncestorContainer;
            const node = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentNode : ancestor;
            if (!container.contains(node)) {
                setSelection(null);
                return;
            }
        }

        if (!looksLikeTerm(text)) {
            setSelection(null);
            return;
        }

        const rect = range.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) {
            setSelection(null);
            return;
        }
        // Position the floating button just above the selection.
        setSelection({
            text: text.trim(),
            x: rect.left + rect.width / 2,
            y: rect.top - 8,
        });
    }, [containerRef, modalOpen]);

    useEffect(() => {
        document.addEventListener('selectionchange', onSelectionChange);
        return () => document.removeEventListener('selectionchange', onSelectionChange);
    }, [onSelectionChange]);

    // ── Submit ────────────────────────────────────────────────────────────

    const openModal = useCallback(() => {
        if (!selection) return;
        setTermText(selection.text);
        setCategory('');
        setWasCorrect(true);
        setNote('');
        setError(null);
        setModalOpen(true);
    }, [selection]);

    const handleSubmit = useCallback(async () => {
        if (!termText.trim()) {
            setError('Term cannot be empty.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const term = await submitTerm({
                term: termText.trim(),
                category: category.trim() || null,
                source_file_id: fileId,
                notes: note.trim() || null,
            });
            // Best-effort occurrence write — don't block on this.
            if (term?.id) {
                try {
                    await recordOccurrence({
                        term_id: term.id,
                        audio_file_external_id: String(fileId),
                        correctly_transcribed: wasCorrect,
                    });
                } catch {
                    /* silent — the term landed; the occurrence is incidental */
                }
            }
            setSuccess(`"${termText.trim()}" submitted${term?.status === 'pending' ? ' (pending admin review)' : ''}.`);
            setModalOpen(false);
            setSelection(null);
            // Clear the success banner after 4 seconds.
            setTimeout(() => setSuccess(null), 4000);
        } catch (err) {
            setError(err?.body?.detail || err?.message || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    }, [termText, category, note, wasCorrect, fileId]);

    // ── Render ────────────────────────────────────────────────────────────

    return (
        <>
            {selection && !modalOpen && (
                <button
                    ref={buttonRef}
                    onMouseDown={(e) => {
                        // Prevent the click from clearing the selection before
                        // we capture it.
                        e.preventDefault();
                    }}
                    onClick={openModal}
                    className="fixed z-50 px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wider cursor-pointer"
                    style={{
                        left: selection.x,
                        top: selection.y,
                        transform: 'translate(-50%, -100%)',
                        backgroundColor: '#1c1b1b',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '3px',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                    }}
                >
                    💼 Add to dictionary
                </button>
            )}

            {success && (
                <div
                    className="fixed bottom-6 right-6 z-50 px-3 py-2 text-[0.8125rem]"
                    style={{
                        backgroundColor: '#d1fae5',
                        color: '#1a7f37',
                        border: '1px solid #99e2bd',
                        borderRadius: '4px',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                    }}
                >
                    ✓ {success}
                </div>
            )}

            <Dialog
                open={modalOpen}
                onClose={() => !submitting && setModalOpen(false)}
                title="Add to financial dictionary"
            >
                <div className="space-y-4">
                    <Field label="Term">
                        <input
                            type="text"
                            value={termText}
                            onChange={(e) => setTermText(e.target.value)}
                            disabled={submitting}
                            className="w-full px-3 py-2 text-[0.875rem]"
                            style={inputStyle}
                            autoFocus
                        />
                    </Field>

                    <Field label="Category (optional)">
                        <input
                            type="text"
                            placeholder="e.g. ratio, instrument, regulation"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            disabled={submitting}
                            className="w-full px-3 py-2 text-[0.875rem]"
                            style={inputStyle}
                        />
                    </Field>

                    <Field label="Source">
                        <div
                            className="px-3 py-2 text-[0.8125rem] flex items-center justify-between"
                            style={{ backgroundColor: '#f6f3f2', color: '#7a7574' }}
                        >
                            <span>This transcript</span>
                            <code style={{ color: '#1c1b1b' }}>{fileId || '—'}</code>
                        </div>
                    </Field>

                    <Field label="Did the model transcribe it correctly?">
                        <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-[0.8125rem] cursor-pointer">
                                <input
                                    type="radio"
                                    name="wasCorrect"
                                    checked={wasCorrect}
                                    onChange={() => setWasCorrect(true)}
                                    disabled={submitting}
                                />
                                <span style={{ color: '#1c1b1b' }}>Yes, it got this right</span>
                            </label>
                            <label className="flex items-center gap-2 text-[0.8125rem] cursor-pointer">
                                <input
                                    type="radio"
                                    name="wasCorrect"
                                    checked={!wasCorrect}
                                    onChange={() => setWasCorrect(false)}
                                    disabled={submitting}
                                />
                                <span style={{ color: '#1c1b1b' }}>No, I&apos;m correcting it</span>
                            </label>
                        </div>
                    </Field>

                    <Field label="Note (optional, for admins)">
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            disabled={submitting}
                            rows={2}
                            className="w-full px-3 py-2 text-[0.8125rem] resize-none"
                            style={inputStyle}
                        />
                    </Field>

                    {error && (
                        <div
                            role="alert"
                            className="px-3 py-2 text-[0.8125rem]"
                            style={{ backgroundColor: '#fff1f2', color: '#b20100', border: '1px solid #ffd5d8' }}
                        >
                            {error}
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            onClick={() => !submitting && setModalOpen(false)}
                            disabled={submitting}
                            className="px-4 py-2 text-[0.8125rem] uppercase tracking-wider cursor-pointer"
                            style={{ backgroundColor: 'transparent', color: '#7a7574', border: 'none' }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="px-4 py-2 text-[0.8125rem] uppercase tracking-wider cursor-pointer"
                            style={{
                                backgroundColor: submitting ? '#e6e1df' : '#1c1b1b',
                                color: '#ffffff', border: 'none',
                                cursor: submitting ? 'wait' : 'pointer',
                            }}
                        >
                            {submitting ? 'Submitting…' : '💼 Submit'}
                        </button>
                    </div>
                </div>
            </Dialog>
        </>
    );
}


function Field({ label, children }) {
    return (
        <div>
            <label
                className="block text-[0.6875rem] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: '#7a7574' }}
            >
                {label}
            </label>
            {children}
        </div>
    );
}


const inputStyle = {
    backgroundColor: '#f6f3f2',
    border: 'none',
    borderBottom: '2px solid #c4c4c4',
    borderRadius: '0px',
    color: '#1c1b1b',
};
