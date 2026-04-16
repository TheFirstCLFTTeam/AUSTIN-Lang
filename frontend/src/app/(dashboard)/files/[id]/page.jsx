'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import AudioPlayer from '../../../../components/AudioPlayer';
import Dialog from '../../components/Dialog';
import {
    fetchFileDetail,
    saveEdits,
    getCurrentUser,
    submitForReview,
    approveTranscript,
    requestChanges,
} from '../../../../services/api';
import { canTransition } from '../../../../lib/statusFlow';
import { recordAccess } from '../../../../lib/recents';
import {
    applyEdits,
    buildDiffView,
    computeWER,
    totalRawWords,
    rawWordIntervals,
    recomputeSegmentEdits,
} from '../../../../lib/transcriptEdits';
import {
    users,
    MOCK_CLIENTS,
    MOCK_USER_PROFILES,
} from '../../../../services/mock_data-users';

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function SpeakerLabel({ speaker, time, onAssign }) {
    const color = speaker === 'AGENT' ? '#7a7574' : '#b20100';
    return (
        <div className="mb-1">
            <span
                className="text-[0.6875rem] font-semibold uppercase tracking-wider"
                style={{ color }}
            >
                {time}
            </span>
            <br />
            <span
                onClick={(e) => {
                    e.stopPropagation();
                    onAssign?.();
                }}
                className="text-[0.75rem] font-bold uppercase tracking-wider cursor-pointer"
                style={{
                    color,
                    borderBottom: '1px dashed currentColor',
                    paddingBottom: '1px',
                }}
                title="Click to assign speaker"
            >
                {speaker}
            </span>
        </div>
    );
}

function CopySegmentButton({ rawText, editedText, hasEdits }) {
    const [copied, setCopied] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
    const timerRef = useRef(null);

    const copyText = (text) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
        setMenuOpen(false);
    };

    useEffect(() => () => clearTimeout(timerRef.current), []);

    const handleClick = (e) => {
        e.stopPropagation();
        copyText(hasEdits ? editedText : rawText);
    };

    const handleContextMenu = (e) => {
        if (!hasEdits) return; // no menu needed if there are no edits
        e.preventDefault();
        e.stopPropagation();
        setMenuPos({ x: e.clientX, y: e.clientY });
        setMenuOpen(true);
    };

    useEffect(() => {
        if (!menuOpen) return;
        const close = () => setMenuOpen(false);
        window.addEventListener('click', close);
        window.addEventListener('contextmenu', close);
        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('contextmenu', close);
        };
    }, [menuOpen]);

    return (
        <>
            <button
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center cursor-pointer opacity-0 group-hover/seg:opacity-100 transition-opacity"
                style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                }}
                title={
                    copied ? 'Copied!'
                    : hasEdits ?
                        'Copy edited transcript (right-click for options)'
                    :   'Copy transcript'
                }
            >
                {copied ?
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#1a7f37"
                        strokeWidth="2"
                        strokeLinecap="square"
                    >
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                :   <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#7a7574"
                        strokeWidth="1.75"
                        strokeLinecap="square"
                    >
                        <rect
                            x="9"
                            y="9"
                            width="13"
                            height="13"
                            rx="1"
                        />
                        <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
                    </svg>
                }
            </button>

            {menuOpen && (
                <div
                    className="fixed z-50 py-1"
                    style={{
                        left: menuPos.x,
                        top: menuPos.y,
                        backgroundColor: '#1c1b1b',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                        minWidth: '180px',
                    }}
                >
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            copyText(editedText);
                        }}
                        className="w-full px-4 py-2 text-left text-[0.75rem] cursor-pointer flex items-center gap-2"
                        style={{
                            backgroundColor: 'transparent',
                            border: 'none',
                            color: '#ffffff',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor =
                                'rgba(255,255,255,0.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor =
                                'transparent';
                        }}
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Copy edited transcript
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            copyText(rawText);
                        }}
                        className="w-full px-4 py-2 text-left text-[0.75rem] cursor-pointer flex items-center gap-2"
                        style={{
                            backgroundColor: 'transparent',
                            border: 'none',
                            color: 'rgba(255,255,255,0.7)',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor =
                                'rgba(255,255,255,0.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor =
                                'transparent';
                        }}
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                        Copy raw transcript
                    </button>
                </div>
            )}
        </>
    );
}

export default function FileDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const audioRef = useRef(null);

    const [fileData, setFileData] = useState(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [audioReady, setAudioReady] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [success, setSuccess] = useState(false);
    const [edits, setEdits] = useState([]);
    const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
    const [volume, setVolume] = useState(1.0);
    const [muted, setMuted] = useState(false);
    const [duration, setDuration] = useState(0);
    const [accessDenied, setAccessDenied] = useState(false);
    const [editingSeg, setEditingSeg] = useState(null);
    const editRef = useRef(null);

    // Editor UX state — undo/redo stacks, save status, find bar, help overlay.
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [savedEdits, setSavedEdits] = useState([]);
    const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showHelp, setShowHelp] = useState(false);
    const [speakerMap, setSpeakerMap] = useState({}); // segId -> { id, name, type, company, profilePic }
    const [speakerUndoStack, setSpeakerUndoStack] = useState([]);
    const [speakerRedoStack, setSpeakerRedoStack] = useState([]);
    const [assignSegId, setAssignSegId] = useState(null); // which segment's dialog is open
    const [speakerSearch, setSpeakerSearch] = useState('');
    const [alternateMode, setAlternateMode] = useState(false);
    const [actionHistory, setActionHistory] = useState([]); // [{ type, description, timestamp }]
    const [showHistory, setShowHistory] = useState(false);
    const [pendingMask, setPendingMask] = useState(null); // { word, segId } — triggers cross-segment dialog on blur
    const [partiesExpanded, setPartiesExpanded] = useState(true);
    const [verifier, setVerifier] = useState(null); // { id, name, profilePic, designation }
    const [verifierPickerOpen, setVerifierPickerOpen] = useState(false);
    const [verifierSearch, setVerifierSearch] = useState('');
    const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
    const [selectedReviewer, setSelectedReviewer] = useState(null);
    const [reviewerSearchQuery, setReviewerSearchQuery] = useState('');
    const [submitStatus, setSubmitStatus] = useState('idle'); // 'idle' | 'submitting' | 'submitted'
    const [fileStatus, setFileStatus] = useState(null); // tracks current file status
    const searchInputRef = useRef(null);
    const historyRef = useRef(null);
    const sidebarRef = useRef(null);
    const partiesCardRef = useRef(null);

    const user = getCurrentUser();
    const userRole = user?.role || 'generic';
    const canApprove = userRole === 'reviewer' || userRole === 'admin';

    useEffect(() => {
        fetchFileDetail(id).then((data) => {
            if (!data) return;
            // Engineers can only view their own files' content
            if (
                userRole === 'engineer' &&
                data.ownerId &&
                data.ownerId !== user?.id
            ) {
                setAccessDenied(true);
                return;
            }
            setFileData(data);
            const initial = data.edits || [];
            setEdits(initial);
            setSavedEdits(initial);
            setUndoStack([]);
            setRedoStack([]);
            setFileStatus(data.status === 'completed' ? 'needs action' : (data.status || 'needs action'));
            if (data.status === 'in review' && data.reviewerId) {
                setSubmitStatus('submitted');
            }
            recordAccess(user?.id || 'anon', id);
        });
    }, [id, userRole, user?.id]);

    const rawSegments =
        fileData?.rawTranscript?.transcript_segments || [];
    // Applied text per segment — only consumed by edit mode, where the user
    // edits the post-edit version they see. View mode renders the diff
    // directly from rawSegments + edits.
    const appliedSegments = applyEdits(rawSegments, edits);

    useEffect(() => {
        if (audioRef.current)
            audioRef.current.playbackRate = playbackSpeed;
    }, [playbackSpeed]);

    useEffect(() => {
        if (!audioRef.current) return;
        audioRef.current.volume = volume;
        audioRef.current.muted = muted;
    }, [volume, muted, audioReady]);

    // Track play/pause state off the audio element so the toggle button can
    // reactively swap its icon. `paused` isn't observable via React props —
    // we have to listen for the events. Duration also isn't reactive via the
    // ref, so we capture it on `loadedmetadata`.
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onDuration = () => {
            if (Number.isFinite(audio.duration))
                setDuration(audio.duration);
        };
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onPause);
        audio.addEventListener('loadedmetadata', onDuration);
        audio.addEventListener('durationchange', onDuration);
        setIsPlaying(!audio.paused);
        if (Number.isFinite(audio.duration))
            setDuration(audio.duration);
        return () => {
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onPause);
            audio.removeEventListener('loadedmetadata', onDuration);
            audio.removeEventListener('durationchange', onDuration);
        };
    }, [audioReady]);

    const activeId = rawSegments.find(
        (s) => currentTime >= s.start && currentTime < s.end,
    )?.id;

    useEffect(() => {
        const el = document.getElementById(`seg-${activeId}`);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [activeId]);

    // When entering edit mode, focus the editable paragraph and put the caret
    // at the end so the user can start typing immediately.
    useEffect(() => {
        if (editingSeg == null || !editRef.current) return;
        editRef.current.focus();
        const range = document.createRange();
        range.selectNodeContents(editRef.current);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }, [editingSeg]);

    function handleSeek(time) {
        if (!audioRef.current || !audioReady) return;
        audioRef.current.currentTime = time;
        if (audioRef.current.readyState >= 2) audioRef.current.play();
    }

    function logAction(type, description) {
        setActionHistory((h) => [
            { type, description, timestamp: new Date() },
            ...h,
        ]);
    }

    // Commit a new edits array and record the previous one for undo. Every
    // user-initiated change to `edits` (text edit, revert segment) funnels
    // through this so undo/redo semantics stay consistent.
    function commitEdits(nextEdits, description) {
        setUndoStack((s) => [...s, edits]);
        setRedoStack([]);
        setEdits(nextEdits);
        logAction('text', description || 'Text edit');
    }

    function commitSpeakerMap(nextMap, description) {
        setSpeakerUndoStack((s) => [...s, speakerMap]);
        setSpeakerRedoStack([]);
        setSpeakerMap(nextMap);
        logAction('speaker', description || 'Speaker assignment');
    }

    function undo() {
        if (undoStack.length === 0) return;
        const prev = undoStack[undoStack.length - 1];
        setUndoStack((s) => s.slice(0, -1));
        setRedoStack((s) => [...s, edits]);
        setEdits(prev);
        logAction('undo', 'Undo text edit');
    }

    function redo() {
        if (redoStack.length === 0) return;
        const next = redoStack[redoStack.length - 1];
        setRedoStack((s) => s.slice(0, -1));
        setUndoStack((s) => [...s, edits]);
        setEdits(next);
        logAction('redo', 'Redo text edit');
    }

    function undoSpeaker() {
        if (speakerUndoStack.length === 0) return;
        const prev = speakerUndoStack[speakerUndoStack.length - 1];
        setSpeakerUndoStack((s) => s.slice(0, -1));
        setSpeakerRedoStack((s) => [...s, speakerMap]);
        setSpeakerMap(prev);
        logAction('undo', 'Undo speaker assignment');
    }

    function redoSpeaker() {
        if (speakerRedoStack.length === 0) return;
        const next = speakerRedoStack[speakerRedoStack.length - 1];
        setSpeakerRedoStack((s) => s.slice(0, -1));
        setSpeakerUndoStack((s) => [...s, speakerMap]);
        setSpeakerMap(next);
        logAction('redo', 'Redo speaker assignment');
    }

    function updateText(segId, newText) {
        const rawSeg = rawSegments.find((s) => s.id === segId);
        if (!rawSeg) return;
        const next = recomputeSegmentEdits(
            edits,
            segId,
            rawSeg.text,
            newText,
            { editedBy: user?.id },
        );
        // Skip the undo entry if the text didn't actually change.
        if (
            next.length === edits.length &&
            next.every((e, i) => e === edits[i])
        )
            return;
        const segIdx = rawSegments.indexOf(rawSeg);
        commitEdits(next, `Edited segment ${segIdx + 1}`);
    }

    function applyMaskAcrossSegments(word) {
        // Replace every occurrence of `word` with [MASK] across all segments.
        let nextEdits = [...edits];
        let maskedCount = 0;
        for (const seg of rawSegments) {
            const applied =
                appliedSegments.find((s) => s.id === seg.id) || seg;
            const words = (applied.text || '')
                .trim()
                .split(/\s+/)
                .filter(Boolean);
            const hasWord = words.some((w) => w === word);
            if (!hasWord) continue;
            const masked = words
                .map((w) => (w === word ? '[MASK]' : w))
                .join(' ');
            nextEdits = recomputeSegmentEdits(
                nextEdits,
                seg.id,
                seg.text,
                masked,
                { editedBy: user?.id },
            );
            maskedCount++;
        }
        if (maskedCount > 0) {
            commitEdits(
                nextEdits,
                `Masked "${word}" across ${maskedCount} segment${maskedCount === 1 ? '' : 's'}`,
            );
        }
    }

    function revertSegment(segId) {
        const next = edits.filter((e) => e.segmentId !== segId);
        if (next.length === edits.length) return;
        const segIdx = rawSegments.findIndex((s) => s.id === segId);
        commitEdits(next, `Reverted segment ${segIdx + 1}`);
    }

    // Segments that have edits, in reading order. Used for Alt+↓/↑ navigation.
    const editedSegmentIds = rawSegments
        .filter((s) => edits.some((e) => e.segmentId === s.id))
        .map((s) => s.id);

    function jumpToEdit(direction) {
        if (editedSegmentIds.length === 0) return;
        const activeIndex = editedSegmentIds.indexOf(activeId);
        let nextIndex;
        if (direction === 'next') {
            nextIndex =
                activeIndex === -1 ?
                    editedSegmentIds.findIndex((sid) => {
                        const seg = rawSegments.find(
                            (s) => s.id === sid,
                        );
                        return seg && seg.start >= currentTime;
                    })
                :   activeIndex + 1;
            if (nextIndex < 0 || nextIndex >= editedSegmentIds.length)
                nextIndex = 0;
        } else {
            nextIndex =
                activeIndex <= 0 ?
                    editedSegmentIds.length - 1
                :   activeIndex - 1;
        }
        const targetId = editedSegmentIds[nextIndex];
        const el = document.getElementById(`seg-${targetId}`);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const target = rawSegments.find((s) => s.id === targetId);
        if (target) handleSeek(target.start);
    }

    function togglePlay() {
        if (!audioRef.current) return;
        if (audioRef.current.paused) {
            audioRef.current.play().catch(() => {});
        } else {
            audioRef.current.pause();
        }
    }

    // `edits` is considered "dirty" when it differs from the last-saved
    // snapshot. Shallow length check plus per-entry identity is enough
    // because every edit commit produces fresh objects.
    const isDirty =
        edits.length !== savedEdits.length ||
        edits.some((e, i) => e !== savedEdits[i]);

    async function handleSubmit() {
        if (!fileData || !isDirty) return;
        setSaveStatus('saving');
        try {
            await saveEdits(fileData.id, edits);
            setSavedEdits(edits);
            setSaveStatus('saved');
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (err) {
            console.error(err);
            setSaveStatus('error');
        }
    }

    // Default reviewer is the reviewer persona (u4).
    const defaultReviewer = users.find((u) => u.role === 'reviewer');

    function openReviewDialog() {
        const defaultPerson = defaultReviewer
            ? { id: defaultReviewer.id, name: MOCK_USER_PROFILES[defaultReviewer.id]?.name || defaultReviewer.name, profilePic: MOCK_USER_PROFILES[defaultReviewer.id]?.profilePic || '/default_pfp.png', designation: MOCK_USER_PROFILES[defaultReviewer.id]?.designation || defaultReviewer.role }
            : null;
        setSelectedReviewer(defaultPerson);
        setReviewerSearchQuery('');
        setReviewDialogOpen(true);
    }

    async function handleSubmitForReview() {
        if (!selectedReviewer || !fileData) return;
        setSubmitStatus('submitting');
        try {
            await submitForReview(fileData.id, selectedReviewer.id);
            setSubmitStatus('submitted');
            setFileStatus('in review');
            setReviewDialogOpen(false);
        } catch (err) {
            console.error(err);
            setSubmitStatus('idle');
        }
    }

    // Reviewer actions
    const [reviewActionStatus, setReviewActionStatus] = useState('idle'); // 'idle' | 'approving' | 'rejecting' | 'done'
    const [requestChangesOpen, setRequestChangesOpen] = useState(false);
    const [changeReason, setChangeReason] = useState('');

    async function handleApprove() {
        if (!fileData) return;
        setReviewActionStatus('approving');
        try {
            await approveTranscript(fileData.id);
            setFileStatus('reviewed');
            setReviewActionStatus('done');
        } catch (err) {
            console.error(err);
            setReviewActionStatus('idle');
        }
    }

    async function handleRequestChanges() {
        if (!fileData) return;
        setReviewActionStatus('rejecting');
        try {
            await requestChanges(fileData.id, changeReason);
            setFileStatus('needs action');
            setReviewActionStatus('done');
            setRequestChangesOpen(false);
            setChangeReason('');
        } catch (err) {
            console.error(err);
            setReviewActionStatus('idle');
        }
    }

    // Reflect dirty state back into the save-status chip while idle.
    useEffect(() => {
        if (saveStatus === 'saving' || saveStatus === 'error') return;
        setSaveStatus(isDirty ? 'idle' : 'saved');
    }, [isDirty, saveStatus]);

    // Focus the find input when the bar opens.
    useEffect(() => {
        if (searchOpen) searchInputRef.current?.focus();
    }, [searchOpen]);

    // Close history popover on outside click.
    useEffect(() => {
        if (!showHistory) return;
        function handleClick(e) {
            if (
                historyRef.current &&
                !historyRef.current.contains(e.target)
            )
                setShowHistory(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () =>
            document.removeEventListener('mousedown', handleClick);
    }, [showHistory]);

    // Collapse the Recording Parties card if the sidebar exceeds the reference
    // height used by the files-page preview card (88% of viewport minus top bar).
    useEffect(() => {
        if (!sidebarRef.current) return;
        const check = () => {
            const maxH = window.innerHeight * 0.88;
            const curH = sidebarRef.current?.scrollHeight || 0;
            if (curH > maxH && partiesExpanded) setPartiesExpanded(false);
        };
        check();
        const ro = new ResizeObserver(check);
        ro.observe(sidebarRef.current);
        return () => ro.disconnect();
    }, [partiesExpanded]);

    // Derive unique speakers from the speakerMap for the Recording Parties card.
    const derivedSpeakers = Object.values(
        Object.values(speakerMap).reduce((acc, s) => {
            if (!acc[s.id]) acc[s.id] = s;
            return acc;
        }, {}),
    );

    // Mock related users — auto-populated from the same permission group as current user.
    const relatedUsers = (() => {
        const profile = MOCK_USER_PROFILES[user?.id];
        if (!profile) return [];
        const primaryGroup = profile.permissionGroups?.find((g) => g.isPrimary)?.name;
        if (!primaryGroup) return [];
        return Object.entries(MOCK_USER_PROFILES)
            .filter(([uid, p]) => uid !== user?.id && p.permissionGroups?.some((g) => g.name === primaryGroup))
            .map(([uid, p]) => ({ id: uid, name: p.name, designation: p.designation }));
    })();

    // Eligible reviewers — users who belong to the "Transcript Review" permission group.
    const eligibleReviewers = Object.entries(MOCK_USER_PROFILES)
        .filter(([uid, p]) => uid !== user?.id && p.permissionGroups?.some((g) => g.name === 'Transcript Review'))
        .map(([uid, p]) => ({
            id: uid,
            name: p.name,
            profilePic: p.profilePic,
            designation: p.designation,
            role: users.find((u) => u.id === uid)?.role || 'unknown',
        }));

    // Global keyboard shortcuts. Inside editable content we defer to the
    // browser for undo/redo so the native text-level history wins; our
    // app-level history only fires outside edit mode.
    useEffect(() => {
        function onKey(e) {
            const t = e.target;
            const isTyping =
                t?.isContentEditable ||
                t?.tagName === 'INPUT' ||
                t?.tagName === 'TEXTAREA';
            const mod = e.metaKey || e.ctrlKey;

            if (e.key === 'Escape') {
                if (showHelp) {
                    setShowHelp(false);
                    return;
                }
                if (searchOpen) {
                    setSearchOpen(false);
                    setSearchQuery('');
                    return;
                }
                return;
            }

            if (isTyping) return;

            if (mod && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
                return;
            }
            if (mod && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                setSearchOpen(true);
                return;
            }
            if (e.key === ' ') {
                e.preventDefault();
                togglePlay();
                return;
            }
            // Plain ↑/↓ navigates between segments that have edits. We only
            // preventDefault (suppressing the browser's native scroll) when there's
            // somewhere to jump — otherwise the page scrolls as normal.
            if (
                e.key === 'ArrowDown' &&
                editedSegmentIds.length > 0
            ) {
                e.preventDefault();
                jumpToEdit('next');
                return;
            }
            if (e.key === 'ArrowUp' && editedSegmentIds.length > 0) {
                e.preventDefault();
                jumpToEdit('prev');
                return;
            }
            if (e.key === '?') {
                e.preventDefault();
                setShowHelp((v) => !v);
                return;
            }
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    });

    const wer = computeWER(rawSegments, edits).toFixed(2);

    if (accessDenied) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#7a7574"
                    strokeWidth="2"
                    className="mb-4"
                >
                    <rect
                        x="3"
                        y="11"
                        width="18"
                        height="11"
                        rx="0"
                    />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <h2
                    className="text-[1.25rem] font-bold mb-2"
                    style={{ color: '#1c1b1b' }}
                >
                    Access Restricted
                </h2>
                <p
                    className="text-[0.875rem] mb-6"
                    style={{ color: '#7a7574' }}
                >
                    You can only view metadata for this file. Audio
                    and transcript content are not available.
                </p>
                <button
                    onClick={() => router.push('/files')}
                    className="px-6 py-2 text-[0.8125rem] font-semibold cursor-pointer"
                    style={{
                        background:
                            'linear-gradient(135deg, #b20100, #e10000)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '0px',
                    }}
                >
                    BACK TO FILES
                </button>
            </div>
        );
    }

    if (!fileData)
        return (
            <div className="flex items-center justify-center py-20">
                <div className="flex flex-col items-center gap-4">
                    <DotLottieReact
                        src="https://lottie.host/c0dd85b9-4b16-423a-acc1-a99b7db2fa8b/JTRJuIh54G.lottie"
                        loop
                        autoplay
                        style={{ width: 200, height: 200 }}
                    />
                    <p
                        className="text-[0.875rem] font-medium"
                        style={{ color: '#7a7574' }}
                    >
                        Loading transcript...
                    </p>
                </div>
            </div>
        );

    // Derive the distinct speaker slots from segments. Segments alternate
    // between speakers based on their index parity (even = slot 0, odd = slot 1).
    // When the model provides a speaker field we use that instead.
    function getSpeakerSlot(seg, index) {
        return (
            seg.speaker ||
            (index % 2 === 0 ? 'speaker_0' : 'speaker_1')
        );
    }

    function getSpeakerName(segId, index) {
        if (speakerMap[segId]) return speakerMap[segId].name;
        return index % 2 === 0 ? 'Agent' : 'Client';
    }

    function getSpeakerPic(segId) {
        const assigned = speakerMap[segId];
        if (!assigned) return null;
        return assigned.profilePic || '/default_pfp.png';
    }

    function assignSpeaker(person) {
        if (alternateMode) {
            // Apply to all segments sharing the same speaker slot
            const targetSeg = rawSegments.find(
                (s) => s.id === assignSegId,
            );
            const targetIdx = rawSegments.indexOf(targetSeg);
            const targetSlot = getSpeakerSlot(targetSeg, targetIdx);
            const nextMap = { ...speakerMap };
            rawSegments.forEach((seg, i) => {
                if (getSpeakerSlot(seg, i) === targetSlot) {
                    nextMap[seg.id] = person;
                }
            });
            const count = rawSegments.filter(
                (seg, i) => getSpeakerSlot(seg, i) === targetSlot,
            ).length;
            commitSpeakerMap(
                nextMap,
                `Assigned ${person.name} to ${count} segments (all ${targetSlot === 'speaker_0' ? 'Speaker 1' : 'Speaker 2'})`,
            );
        } else {
            const nextMap = { ...speakerMap, [assignSegId]: person };
            const segIdx = rawSegments.findIndex(
                (s) => s.id === assignSegId,
            );
            commitSpeakerMap(
                nextMap,
                `Assigned ${person.name} to segment ${segIdx + 1}`,
            );
        }
        setAssignSegId(null);
        setSpeakerSearch('');
    }

    function unassignSpeaker(segId) {
        const removed = speakerMap[segId];
        const nextMap = { ...speakerMap };
        delete nextMap[segId];
        const segIdx = rawSegments.findIndex((s) => s.id === segId);
        commitSpeakerMap(
            nextMap,
            `Removed ${removed?.name || 'speaker'} from segment ${segIdx + 1}`,
        );
        setAssignSegId(null);
        setSpeakerSearch('');
    }

    return (
        <div>
            {/* Top Action Bar */}
            <div
                className="flex items-center justify-between px-6 py-3 mb-6 -mx-6 -mt-6"
                style={{ backgroundColor: '#ffffff' }}
            >
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.push('/files')}
                        className="text-[0.8125rem] cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            border: 'none',
                            color: '#7a7574',
                        }}
                    >
                        &larr;
                    </button>
                    <span
                        className="text-[0.875rem] font-semibold"
                        style={{ color: '#1c1b1b' }}
                    >
                        {fileData.name}
                    </span>
                    <span
                        className="inline-block px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider"
                        style={{
                            backgroundColor: ({ 'in review': 'rgba(0, 78, 198, 0.08)', 'needs action': 'rgba(178, 1, 0, 0.08)', reviewed: 'rgba(26, 127, 55, 0.08)', transcribed: 'rgba(158, 106, 0, 0.08)' })[fileStatus] || 'rgba(122, 117, 116, 0.1)',
                            color: ({ 'in review': '#004ec6', 'needs action': '#b20100', reviewed: '#1a7f37', transcribed: '#9e6a00' })[fileStatus] || '#7a7574',
                            borderRadius: '0px',
                        }}
                    >
                        {(fileStatus || 'needs action').toUpperCase()}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <SaveStatus
                        status={saveStatus}
                        isDirty={isDirty}
                        actionHistory={actionHistory}
                        showHistory={showHistory}
                        onToggleHistory={() =>
                            setShowHistory((v) => !v)
                        }
                        historyRef={historyRef}
                        onUndoText={undo}
                        onUndoSpeaker={undoSpeaker}
                        canUndoText={undoStack.length > 0}
                        canUndoSpeaker={speakerUndoStack.length > 0}
                    />
                    <button
                        onClick={() => {
                            const title =
                                fileData.name || 'Untitled Recording';
                            const lines = [
                                `# ${title}`,
                                '',
                                '## Transcript',
                                '',
                            ];
                            const segments = applyEdits(
                                rawSegments,
                                edits,
                            );
                            segments.forEach((seg, i) => {
                                const speaker = getSpeakerName(
                                    seg.id,
                                    i,
                                );
                                lines.push(`${speaker}:`);
                                lines.push(seg.text);
                                lines.push('');
                            });
                            const md = lines.join('\n');
                            const blob = new Blob([md], {
                                type: 'text/markdown',
                            });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${title.replace(/[^a-zA-Z0-9_\- ]/g, '')}.md`;
                            a.click();
                            URL.revokeObjectURL(url);
                        }}
                        className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            border: '1.5px solid rgba(233, 188, 181, 0.3)',
                            borderRadius: '0px',
                            color: '#1c1b1b',
                        }}
                    >
                        EXPORT
                    </button>
                    <button
                        className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            border: '1.5px solid rgba(233, 188, 181, 0.3)',
                            borderRadius: '0px',
                            color: '#b20100',
                        }}
                    >
                        FLAG PRIVACY
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!isDirty || saveStatus === 'saving'}
                        className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                            backgroundColor: 'transparent',
                            border: '1.5px solid rgba(233, 188, 181, 0.3)',
                            borderRadius: '0px',
                            color: '#1c1b1b',
                        }}
                    >
                        {saveStatus === 'saving' ?
                            'SAVING…'
                        :   'SAVE EDITS'}
                    </button>
                    {canApprove ? (
                        <>
                            <button
                                onClick={() => setRequestChangesOpen(true)}
                                disabled={fileStatus !== 'in review' || reviewActionStatus !== 'idle'}
                                className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                                style={{
                                    backgroundColor: 'transparent',
                                    border: '1.5px solid rgba(233, 188, 181, 0.3)',
                                    borderRadius: '0px',
                                    color: '#b20100',
                                }}
                            >
                                REQUEST CHANGES
                            </button>
                            <button
                                onClick={handleApprove}
                                disabled={fileStatus !== 'in review' || reviewActionStatus !== 'idle'}
                                className="px-4 py-1.5 text-[0.8125rem] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                                style={{
                                    background: fileStatus === 'reviewed'
                                        ? '#1a7f37'
                                        : 'linear-gradient(135deg, #b20100, #e10000)',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '0px',
                                }}
                            >
                                {reviewActionStatus === 'approving' ? 'APPROVING…' : fileStatus === 'reviewed' ? 'APPROVED' : 'APPROVE TRANSCRIPT'}
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={openReviewDialog}
                            disabled={!canTransition(fileStatus, 'in review') || submitStatus === 'submitting' || submitStatus === 'submitted'}
                            className="px-4 py-1.5 text-[0.8125rem] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                            style={{
                                background: submitStatus === 'submitted' || fileStatus === 'in review'
                                    ? '#7a7574'
                                    : fileStatus === 'reviewed'
                                        ? '#1a7f37'
                                        : 'linear-gradient(135deg, #b20100, #e10000)',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '0px',
                            }}
                        >
                            {submitStatus === 'submitting' ? 'SUBMITTING…'
                                : fileStatus === 'in review' ? 'IN REVIEW'
                                : fileStatus === 'reviewed' ? 'REVIEWED'
                                : fileStatus === 'transcribing' ? 'TRANSCRIBING'
                                : 'SUBMIT FOR REVIEW'}
                        </button>
                    )}
                </div>
            </div>

            {success && (
                <div
                    className="mb-4 p-3 text-[0.8125rem]"
                    style={{
                        backgroundColor: 'rgba(0, 78, 198, 0.05)',
                        color: '#004ec6',
                    }}
                >
                    Transcript updated successfully.
                </div>
            )}

            <div className="flex gap-6">
                <div className="flex-1">
                    {/* Audio Player */}
                    <div
                        className="p-4 mb-6"
                        style={{ backgroundColor: '#ffffff' }}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                                <button
                                    className="w-8 h-8 flex items-center justify-center cursor-pointer"
                                    style={{
                                        backgroundColor:
                                            'transparent',
                                        border: 'none',
                                        color: '#7a7574',
                                    }}
                                    onClick={() => {
                                        if (audioRef.current)
                                            audioRef.current.currentTime -= 10;
                                    }}
                                >
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <polyline points="1 4 1 10 7 10" />
                                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                                    </svg>
                                </button>
                                <button
                                    onClick={togglePlay}
                                    aria-label={
                                        isPlaying ? 'Pause' : 'Play'
                                    }
                                    className="relative w-10 h-10 flex items-center justify-center cursor-pointer"
                                    style={{
                                        backgroundColor: '#1c1b1b',
                                        border: 'none',
                                        borderRadius: '0px',
                                        color: '#ffffff',
                                    }}
                                >
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        className="absolute"
                                        style={{
                                            opacity:
                                                isPlaying ? 0 : 1,
                                            transform:
                                                isPlaying ?
                                                    'scale(0.6)'
                                                :   'scale(1)',
                                            transition:
                                                'opacity 150ms ease, transform 150ms ease',
                                        }}
                                    >
                                        <polygon points="5 3 19 12 5 21 5 3" />
                                    </svg>
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        className="absolute"
                                        style={{
                                            opacity:
                                                isPlaying ? 1 : 0,
                                            transform:
                                                isPlaying ? 'scale(1)'
                                                :   'scale(0.6)',
                                            transition:
                                                'opacity 150ms ease, transform 150ms ease',
                                        }}
                                    >
                                        <rect
                                            x="6"
                                            y="4"
                                            width="4"
                                            height="16"
                                        />
                                        <rect
                                            x="14"
                                            y="4"
                                            width="4"
                                            height="16"
                                        />
                                    </svg>
                                </button>
                                <button
                                    className="w-8 h-8 flex items-center justify-center cursor-pointer"
                                    style={{
                                        backgroundColor:
                                            'transparent',
                                        border: 'none',
                                        color: '#7a7574',
                                    }}
                                    onClick={() => {
                                        if (audioRef.current)
                                            audioRef.current.currentTime += 10;
                                    }}
                                >
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <polyline points="23 4 23 10 17 10" />
                                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                                    </svg>
                                </button>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() =>
                                            setMuted((v) => !v)
                                        }
                                        aria-label={
                                            muted || volume === 0 ?
                                                'Unmute'
                                            :   'Mute'
                                        }
                                        title={
                                            muted || volume === 0 ?
                                                'Unmute'
                                            :   'Mute'
                                        }
                                        className="w-6 h-6 flex items-center justify-center cursor-pointer"
                                        style={{
                                            backgroundColor:
                                                'transparent',
                                            border: 'none',
                                            color: '#7a7574',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.color =
                                                '#1c1b1b';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.color =
                                                '#7a7574';
                                        }}
                                    >
                                        <VolumeIcon
                                            muted={
                                                muted || volume === 0
                                            }
                                            level={volume}
                                        />
                                    </button>
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        value={muted ? 0 : volume}
                                        onChange={(e) => {
                                            const v = parseFloat(
                                                e.target.value,
                                            );
                                            setVolume(v);
                                            if (v > 0 && muted)
                                                setMuted(false);
                                        }}
                                        aria-label="Volume"
                                        className="cursor-pointer"
                                        style={{
                                            accentColor: '#b20100',
                                            width: '80px',
                                        }}
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <span
                                        className="text-[0.6875rem] uppercase tracking-wider"
                                        style={{ color: '#7a7574' }}
                                    >
                                        Playback Speed
                                    </span>
                                    <select
                                        value={playbackSpeed}
                                        onChange={(e) =>
                                            setPlaybackSpeed(
                                                parseFloat(
                                                    e.target.value,
                                                ),
                                            )
                                        }
                                        className="text-[0.8125rem] px-2 py-1 cursor-pointer"
                                        style={{
                                            backgroundColor:
                                                '#f6f3f2',
                                            border: 'none',
                                            borderRadius: '0px',
                                            color: '#1c1b1b',
                                        }}
                                    >
                                        <option value={0.5}>
                                            0.5x
                                        </option>
                                        <option value={0.75}>
                                            0.75x
                                        </option>
                                        <option value={1.0}>
                                            1.0x
                                        </option>
                                        <option value={1.25}>
                                            1.25x
                                        </option>
                                        <option value={1.5}>
                                            1.5x
                                        </option>
                                        <option value={2.0}>
                                            2.0x
                                        </option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div
                            role="slider"
                            aria-label="Seek"
                            className="relative h-16 mb-2 cursor-pointer"
                            style={{ backgroundColor: '#f6f3f2' }}
                            onClick={(e) => {
                                if (!duration) return;
                                const rect =
                                    e.currentTarget.getBoundingClientRect();
                                const ratio = Math.min(
                                    1,
                                    Math.max(
                                        0,
                                        (e.clientX - rect.left) /
                                            rect.width,
                                    ),
                                );
                                handleSeek(ratio * duration);
                            }}
                        >
                            <div className="absolute inset-0 flex items-center justify-center gap-px px-2 pointer-events-none">
                                {Array.from({ length: 80 }).map(
                                    (_, i) => {
                                        const h =
                                            8 +
                                            Math.sin(i * 0.5) * 20 +
                                            Math.sin(i * 1.3) * 12;
                                        const progress =
                                            duration ?
                                                currentTime / duration
                                            :   0;
                                        return (
                                            <div
                                                key={i}
                                                className="w-1"
                                                style={{
                                                    height: `${h}px`,
                                                    backgroundColor:
                                                        (
                                                            i / 80 <
                                                            progress
                                                        ) ?
                                                            '#b20100'
                                                        :   '#c4c4c4',
                                                }}
                                            />
                                        );
                                    },
                                )}
                            </div>
                        </div>

                        <div
                            className="text-center text-[0.75rem] font-mono"
                            style={{ color: '#7a7574' }}
                        >
                            {formatTime(currentTime)} /{' '}
                            {duration ?
                                formatTime(duration)
                            :   '\u2014'}
                        </div>

                        <AudioPlayer
                            fileUrl={fileData.audioUrl}
                            audioRef={audioRef}
                            onTimeUpdate={setCurrentTime}
                            onReady={() => setAudioReady(true)}
                        />
                    </div>

                    {/* Editor toolbar — undo/redo, find, jump-between-edits, help. */}
                    <div
                        className="flex items-center justify-between px-4 py-2 mb-4"
                        style={{
                            backgroundColor: '#ffffff',
                            border: '1px solid #f0edec',
                        }}
                    >
                        <div className="flex items-center gap-1">
                            <ToolbarButton
                                onClick={undo}
                                disabled={undoStack.length === 0}
                                title="Undo text edit (Ctrl+Z)"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <path d="M3 7v6h6" />
                                    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-7 3L3 13" />
                                </svg>
                            </ToolbarButton>
                            <ToolbarButton
                                onClick={redo}
                                disabled={redoStack.length === 0}
                                title="Redo text edit (Ctrl+Shift+Z)"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <path d="M21 7v6h-6" />
                                    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 7 3l2 2" />
                                </svg>
                            </ToolbarButton>
                            <div
                                className="w-px h-5 mx-1"
                                style={{ backgroundColor: '#f0edec' }}
                            />
                            <ToolbarButton
                                onClick={undoSpeaker}
                                disabled={
                                    speakerUndoStack.length === 0
                                }
                                title="Undo speaker assignment"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                    <circle cx="12" cy="7" r="4" />
                                </svg>
                            </ToolbarButton>
                            <ToolbarButton
                                onClick={redoSpeaker}
                                disabled={
                                    speakerRedoStack.length === 0
                                }
                                title="Redo speaker assignment"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                    <circle cx="12" cy="7" r="4" />
                                    <path d="M16 3l2 2-2 2" />
                                </svg>
                            </ToolbarButton>
                            <div
                                className="w-px h-5 mx-1"
                                style={{ backgroundColor: '#f0edec' }}
                            />
                            <ToolbarButton
                                onClick={() =>
                                    setSearchOpen((v) => !v)
                                }
                                title="Find (Ctrl+F)"
                                active={searchOpen}
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <circle cx="11" cy="11" r="7" />
                                    <line
                                        x1="21"
                                        y1="21"
                                        x2="16.65"
                                        y2="16.65"
                                    />
                                </svg>
                            </ToolbarButton>
                            <div
                                className="w-px h-5 mx-1"
                                style={{ backgroundColor: '#f0edec' }}
                            />
                            <ToolbarButton
                                onClick={() => jumpToEdit('prev')}
                                disabled={
                                    editedSegmentIds.length === 0
                                }
                                title="Previous edit (↑)"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <polyline points="18 15 12 9 6 15" />
                                </svg>
                            </ToolbarButton>
                            <ToolbarButton
                                onClick={() => jumpToEdit('next')}
                                disabled={
                                    editedSegmentIds.length === 0
                                }
                                title="Next edit (↓)"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
                            </ToolbarButton>
                            <span
                                className="ml-2 text-[0.6875rem]"
                                style={{ color: '#7a7574' }}
                            >
                                {editedSegmentIds.length === 0 ?
                                    'No edits'
                                :   `${edits.length} edit${edits.length === 1 ? '' : 's'} across ${editedSegmentIds.length} segment${editedSegmentIds.length === 1 ? '' : 's'}`
                                }
                            </span>
                        </div>
                        <ToolbarButton
                            onClick={() => setShowHelp(true)}
                            title="Keyboard shortcuts (?)"
                        >
                            <span
                                className="text-[0.75rem] font-semibold"
                                style={{ fontFamily: 'monospace' }}
                            >
                                ?
                            </span>
                        </ToolbarButton>
                    </div>

                    {searchOpen && (
                        <div
                            className="flex items-center gap-2 px-4 py-2 mb-4"
                            style={{
                                backgroundColor: '#fffbea',
                                border: '1px solid #f5e6a8',
                            }}
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#7a7574"
                                strokeWidth="2"
                            >
                                <circle cx="11" cy="11" r="7" />
                                <line
                                    x1="21"
                                    y1="21"
                                    x2="16.65"
                                    y2="16.65"
                                />
                            </svg>
                            <input
                                ref={searchInputRef}
                                value={searchQuery}
                                onChange={(e) =>
                                    setSearchQuery(e.target.value)
                                }
                                placeholder="Find in transcript…"
                                className="flex-1 text-[0.8125rem] outline-none"
                                style={{
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    color: '#1c1b1b',
                                }}
                            />
                            <button
                                onClick={() => {
                                    setSearchOpen(false);
                                    setSearchQuery('');
                                }}
                                className="text-[0.75rem] cursor-pointer"
                                style={{
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    color: '#7a7574',
                                }}
                            >
                                Esc
                            </button>
                        </div>
                    )}

                    {/* Transcript */}
                    <div className="space-y-6">
                        {rawSegments.map((rawSeg, i) => {
                            const isActive = rawSeg.id === activeId;
                            const speaker = getSpeakerName(
                                rawSeg.id,
                                i,
                            );
                            const isAssigned =
                                !!speakerMap[rawSeg.id];
                            const intervals =
                                rawWordIntervals(rawSeg);
                            const tokens = buildDiffView(
                                rawSeg,
                                edits,
                            );
                            const editCount = edits.filter(
                                (e) => e.segmentId === rawSeg.id,
                            ).length;
                            const appliedText =
                                appliedSegments[i]?.text ??
                                rawSeg.text;
                            return (
                                <div
                                    key={rawSeg.id}
                                    id={`seg-${rawSeg.id}`}
                                    className="flex gap-6 cursor-pointer"
                                    onClick={() =>
                                        handleSeek(rawSeg.start)
                                    }
                                >
                                    <div className="w-24 shrink-0 pt-1">
                                        <SpeakerLabel
                                            speaker={speaker.toUpperCase()}
                                            time={formatTime(
                                                rawSeg.start,
                                            )}
                                            onAssign={() =>
                                                setAssignSegId(
                                                    rawSeg.id,
                                                )
                                            }
                                        />
                                        {isAssigned && (
                                            <span
                                                className="text-[0.5625rem] block mt-0.5"
                                                style={{
                                                    color: '#004ec6',
                                                }}
                                            >
                                                {(
                                                    speakerMap[
                                                        rawSeg.id
                                                    ].type ===
                                                    'client'
                                                ) ?
                                                    speakerMap[
                                                        rawSeg.id
                                                    ].company
                                                :   'UBS'}
                                            </span>
                                        )}
                                        {editCount > 0 && (
                                            <div className="flex items-center gap-1 mt-1">
                                                <span
                                                    className="inline-block px-1.5 py-0.5 text-[0.625rem] font-semibold"
                                                    style={{
                                                        backgroundColor:
                                                            'rgba(26, 127, 55, 0.10)',
                                                        color: '#1a7f37',
                                                        borderRadius:
                                                            '2px',
                                                    }}
                                                    title={`${editCount} edit${editCount === 1 ? '' : 's'} in this segment`}
                                                >
                                                    +{editCount}
                                                </span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        revertSegment(
                                                            rawSeg.id,
                                                        );
                                                    }}
                                                    className="text-[0.625rem] cursor-pointer"
                                                    style={{
                                                        backgroundColor:
                                                            'transparent',
                                                        border: 'none',
                                                        color: '#7a7574',
                                                        padding: 0,
                                                    }}
                                                    title="Revert this segment to the model output"
                                                >
                                                    revert
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <div
                                        className="w-px self-stretch"
                                        style={{
                                            backgroundColor:
                                                isActive ? '#b20100'
                                                :   'rgba(233, 188, 181, 0.2)',
                                        }}
                                    />
                                    <div
                                        className="flex-1 p-4 transition-colors relative group/seg"
                                        style={{
                                            backgroundColor:
                                                isActive ?
                                                    'rgba(178, 1, 0, 0.06)'
                                                :   'transparent',
                                        }}
                                    >
                                        <CopySegmentButton
                                            rawText={rawSeg.text}
                                            editedText={appliedText}
                                            hasEdits={editCount > 0}
                                        />
                                        {editingSeg === rawSeg.id ?
                                            <p
                                                ref={editRef}
                                                contentEditable
                                                suppressContentEditableWarning
                                                onClick={(e) =>
                                                    e.stopPropagation()
                                                }
                                                onBlur={(e) => {
                                                    const newText =
                                                        e.target
                                                            .innerText;
                                                    updateText(
                                                        rawSeg.id,
                                                        newText,
                                                    );
                                                    setEditingSeg(
                                                        null,
                                                    );
                                                }}
                                                onKeyDown={(e) => {
                                                    if (
                                                        e.key ===
                                                        'Escape'
                                                    ) {
                                                        e.preventDefault();
                                                        setEditingSeg(
                                                            null,
                                                        );
                                                        return;
                                                    }
                                                    // Alt+G: replace a single highlighted word with [MASK]
                                                    if (
                                                        e.altKey &&
                                                        e.key === 'g'
                                                    ) {
                                                        e.preventDefault();
                                                        const sel =
                                                            window.getSelection();
                                                        if (
                                                            !sel ||
                                                            sel.isCollapsed
                                                        )
                                                            return;
                                                        const selected =
                                                            sel.toString();
                                                        // Must be exactly one word (no internal whitespace, non-empty after trim)
                                                        const trimmed =
                                                            selected.trim();
                                                        if (
                                                            !trimmed ||
                                                            /\s/.test(
                                                                trimmed,
                                                            )
                                                        )
                                                            return;
                                                        // Preserve leading/trailing whitespace from the original selection
                                                        const leadingWs =
                                                            selected.match(
                                                                /^\s*/,
                                                            )[0];
                                                        const trailingWs =
                                                            selected.match(
                                                                /\s*$/,
                                                            )[0];
                                                        // Replace the selection with [MASK], retaining surrounding whitespace
                                                        const range =
                                                            sel.getRangeAt(
                                                                0,
                                                            );
                                                        range.deleteContents();
                                                        range.insertNode(
                                                            document.createTextNode(
                                                                leadingWs +
                                                                    '[MASK]' +
                                                                    trailingWs,
                                                            ),
                                                        );
                                                        // Collapse cursor after the inserted text
                                                        sel.collapseToEnd();
                                                        // Store the original word so the blur handler can offer cross-segment masking
                                                        setPendingMask(
                                                            {
                                                                word: trimmed,
                                                                segId: rawSeg.id,
                                                            },
                                                        );
                                                    }
                                                }}
                                                className="text-[0.875rem] leading-relaxed outline-none"
                                                style={{
                                                    color: '#1c1b1b',
                                                    boxShadow:
                                                        '0 0 0 2px rgba(178, 1, 0, 0.25)',
                                                    padding:
                                                        '2px 4px',
                                                }}
                                            >
                                                {appliedText}
                                            </p>
                                        :   <p
                                                onDoubleClick={(
                                                    e,
                                                ) => {
                                                    e.stopPropagation();
                                                    setEditingSeg(
                                                        rawSeg.id,
                                                    );
                                                }}
                                                className="text-[0.875rem] leading-relaxed"
                                                style={{
                                                    color: '#1c1b1b',
                                                }}
                                                title="Double-click to edit"
                                            >
                                                {tokens.map(
                                                    (tok, ti) => {
                                                        const interval =

                                                                (
                                                                    tok.rawIndex !=
                                                                    null
                                                                ) ?
                                                                    intervals[
                                                                        tok
                                                                            .rawIndex
                                                                    ]
                                                                :   null;
                                                        const isWordActive =
                                                            isActive &&
                                                            interval &&
                                                            currentTime >=
                                                                interval.start &&
                                                            currentTime <
                                                                interval.end;
                                                        const q =
                                                            searchQuery
                                                                .trim()
                                                                .toLowerCase();
                                                        const isMatch =
                                                            q.length >
                                                                0 &&
                                                            tok.text
                                                                .toLowerCase()
                                                                .includes(
                                                                    q,
                                                                );
                                                        const searchBg =
                                                            'rgba(245, 183, 0, 0.45)'; // yellow, wins over audio highlight when both apply
                                                        const base = {
                                                            padding:
                                                                '0 1px',
                                                            borderRadius:
                                                                '2px',
                                                            transition:
                                                                'background-color 0.1s ease-out',
                                                        };
                                                        if (
                                                            tok.kind ===
                                                            'inserted'
                                                        ) {
                                                            return (
                                                                <span
                                                                    key={
                                                                        ti
                                                                    }
                                                                    style={{
                                                                        ...base,
                                                                        color: '#1a7f37',
                                                                        textDecoration:
                                                                            'underline',
                                                                        textDecorationStyle:
                                                                            'solid',
                                                                        textUnderlineOffset:
                                                                            '2px',
                                                                        backgroundColor:

                                                                                (
                                                                                    isMatch
                                                                                ) ?
                                                                                    searchBg
                                                                                :   'transparent',
                                                                    }}
                                                                    title="Inserted by reviewer"
                                                                >
                                                                    {
                                                                        tok.text
                                                                    }{' '}
                                                                </span>
                                                            );
                                                        }
                                                        if (
                                                            tok.kind ===
                                                            'deleted'
                                                        ) {
                                                            return (
                                                                <span
                                                                    key={
                                                                        ti
                                                                    }
                                                                    onClick={(
                                                                        e,
                                                                    ) => {
                                                                        e.stopPropagation();
                                                                        if (
                                                                            interval
                                                                        )
                                                                            handleSeek(
                                                                                interval.start,
                                                                            );
                                                                    }}
                                                                    style={{
                                                                        ...base,
                                                                        color: '#b20100',
                                                                        textDecoration:
                                                                            'line-through',
                                                                        backgroundColor:
                                                                            (
                                                                                isMatch
                                                                            ) ?
                                                                                searchBg
                                                                            : (
                                                                                isWordActive
                                                                            ) ?
                                                                                'rgba(178, 1, 0, 0.15)'
                                                                            :   'transparent',
                                                                        cursor: 'pointer',
                                                                    }}
                                                                    title="Removed by reviewer — click to seek"
                                                                >
                                                                    {
                                                                        tok.text
                                                                    }{' '}
                                                                </span>
                                                            );
                                                        }
                                                        return (
                                                            <span
                                                                key={
                                                                    ti
                                                                }
                                                                onClick={(
                                                                    e,
                                                                ) => {
                                                                    e.stopPropagation();
                                                                    if (
                                                                        interval
                                                                    )
                                                                        handleSeek(
                                                                            interval.start,
                                                                        );
                                                                }}
                                                                style={{
                                                                    ...base,
                                                                    color:
                                                                        (
                                                                            isWordActive
                                                                        ) ?
                                                                            '#1c1b1b'
                                                                        :   'inherit',
                                                                    backgroundColor:
                                                                        (
                                                                            isMatch
                                                                        ) ?
                                                                            searchBg
                                                                        : (
                                                                            isWordActive
                                                                        ) ?
                                                                            'rgba(178, 1, 0, 0.20)'
                                                                        :   'transparent',
                                                                    fontWeight:

                                                                            (
                                                                                isWordActive
                                                                            ) ?
                                                                                600
                                                                            :   'inherit',
                                                                    cursor: 'pointer',
                                                                }}
                                                            >
                                                                {
                                                                    tok.text
                                                                }{' '}
                                                            </span>
                                                        );
                                                    },
                                                )}
                                            </p>
                                        }
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right Sidebar */}
                <div ref={sidebarRef} className="w-64 shrink-0 space-y-6">
                    {/* Word Error Rate */}
                    <div
                        className="p-4"
                        style={{ backgroundColor: '#ffffff' }}
                    >
                        <div className="mb-1">
                            <span
                                className="text-[0.6875rem] font-semibold uppercase tracking-wider"
                                style={{ color: '#7a7574' }}
                            >
                                Word Error Rate
                            </span>
                        </div>
                        <p
                            className="text-[2rem] font-bold"
                            style={{ color: '#1c1b1b' }}
                        >
                            {fileStatus === 'transcribing' || fileStatus === 'transcribed' ? '\u2014' : `${wer}%`}
                        </p>
                        <p
                            className="text-[0.6875rem]"
                            style={{ color: '#7a7574' }}
                        >
                            {fileStatus === 'transcribing'
                                ? 'Transcription in progress'
                                : fileStatus === 'transcribed'
                                    ? 'No edits yet'
                                    : `${edits.length} of ${totalRawWords(rawSegments)} words corrected`}
                        </p>
                    </div>

                    {/* Recording Parties */}
                    <div
                        ref={partiesCardRef}
                        className="p-4"
                        style={{ backgroundColor: '#ffffff' }}
                    >
                        <p
                            className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-3"
                            style={{ color: '#7a7574' }}
                        >
                            Recording Parties
                        </p>

                        {/* OWNER */}
                        <div className="mb-3">
                            <span
                                className="text-[0.625rem] font-semibold uppercase tracking-wider"
                                style={{ color: '#7a7574' }}
                            >
                                Owner
                            </span>
                            <div
                                className="flex items-center gap-2 mt-1 px-2 py-1.5"
                                style={{
                                    border: '1px solid #f0edec',
                                    backgroundColor: '#fafaf9',
                                }}
                            >
                                <span
                                    className="w-2 h-2 shrink-0"
                                    style={{
                                        backgroundColor: '#1a7f37',
                                        borderRadius: '50%',
                                    }}
                                />
                                <span
                                    className="text-[0.8125rem] font-medium truncate"
                                    style={{ color: '#1c1b1b' }}
                                >
                                    {MOCK_USER_PROFILES[user?.id]?.name || user?.name || 'Unknown'}
                                </span>
                            </div>
                        </div>

                        {/* VERIFIER */}
                        <div className="mb-3">
                            <span
                                className="text-[0.625rem] font-semibold uppercase tracking-wider"
                                style={{ color: '#7a7574' }}
                            >
                                Verifier
                            </span>
                            {verifier ? (
                                <div
                                    className="flex items-center gap-2 mt-1 px-2 py-1.5"
                                    style={{
                                        border: '1px solid #f0edec',
                                        backgroundColor: '#fafaf9',
                                    }}
                                >
                                    <span
                                        className="w-2 h-2 shrink-0"
                                        style={{
                                            backgroundColor: '#1a7f37',
                                            borderRadius: '50%',
                                        }}
                                    />
                                    {verifier.profilePic && (
                                        <img
                                            src={verifier.profilePic}
                                            alt=""
                                            className="w-4 h-4 shrink-0 object-cover"
                                            style={{ borderRadius: '50%' }}
                                        />
                                    )}
                                    <span
                                        className="text-[0.8125rem] font-medium truncate"
                                        style={{ color: '#1c1b1b' }}
                                    >
                                        {verifier.name}
                                    </span>
                                    <button
                                        onClick={() => setVerifier(null)}
                                        className="ml-auto text-[0.625rem] font-semibold cursor-pointer shrink-0"
                                        style={{
                                            backgroundColor: 'transparent',
                                            border: 'none',
                                            color: '#b20100',
                                            padding: 0,
                                        }}
                                        title="Remove verifier"
                                    >
                                        &times;
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => { setVerifierPickerOpen(true); setVerifierSearch(''); }}
                                    className="flex items-center gap-2 mt-1 px-2 py-1.5 w-full cursor-pointer"
                                    style={{
                                        border: '1px dashed #e8e4e3',
                                        backgroundColor: '#fafaf9',
                                    }}
                                >
                                    <span
                                        className="w-2 h-2 shrink-0"
                                        style={{
                                            backgroundColor: '#d4a017',
                                            borderRadius: '50%',
                                        }}
                                    />
                                    <span
                                        className="text-[0.8125rem] truncate"
                                        style={{ color: '#7a7574', fontStyle: 'italic' }}
                                    >
                                        Unassigned
                                    </span>
                                    <span
                                        className="ml-auto text-[0.6875rem] font-semibold shrink-0"
                                        style={{ color: '#b20100' }}
                                    >
                                        +
                                    </span>
                                </button>
                            )}
                        </div>

                        {/* Collapsible section */}
                        {!partiesExpanded && (
                            <button
                                onClick={() => setPartiesExpanded(true)}
                                className="w-full py-1.5 text-[0.625rem] font-semibold uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2"
                                style={{
                                    backgroundColor: '#f6f3f2',
                                    border: 'none',
                                    color: '#7a7574',
                                }}
                            >
                                <span style={{ fontSize: '0.5rem' }}>&#9660;</span>
                                show more
                                <span style={{ fontSize: '0.5rem' }}>&#9660;</span>
                            </button>
                        )}

                        {partiesExpanded && (
                            <>
                                {/* SPEAKERS */}
                                <div className="mb-3">
                                    <span
                                        className="text-[0.625rem] font-semibold uppercase tracking-wider"
                                        style={{ color: '#7a7574' }}
                                    >
                                        Speakers{derivedSpeakers.length > 0 ? ` (${derivedSpeakers.length})` : ''}
                                    </span>
                                    {derivedSpeakers.length > 0 ? (
                                        <div
                                            className="mt-1 divide-y"
                                            style={{ borderColor: '#f0edec' }}
                                        >
                                            {derivedSpeakers.map((s) => (
                                                <div
                                                    key={s.id}
                                                    className="flex items-center gap-2 px-2 py-1.5"
                                                    style={{ borderColor: '#f0edec' }}
                                                >
                                                    {s.profilePic ? (
                                                        <img
                                                            src={s.profilePic}
                                                            alt=""
                                                            className="w-4 h-4 shrink-0 object-cover"
                                                            style={{ borderRadius: '50%' }}
                                                        />
                                                    ) : (
                                                        <span
                                                            className="w-4 h-4 shrink-0 flex items-center justify-center text-[0.5rem]"
                                                            style={{
                                                                backgroundColor: '#e8e4e3',
                                                                borderRadius: '50%',
                                                                color: '#7a7574',
                                                            }}
                                                        >
                                                            {s.name?.[0] || '?'}
                                                        </span>
                                                    )}
                                                    <span
                                                        className="text-[0.75rem] truncate"
                                                        style={{ color: '#1c1b1b' }}
                                                    >
                                                        {s.name}
                                                    </span>
                                                    <span
                                                        className="ml-auto text-[0.625rem] shrink-0"
                                                        style={{ color: '#7a7574' }}
                                                    >
                                                        {s.type === 'client' ? s.company : 'UBS'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p
                                            className="text-[0.6875rem] mt-1"
                                            style={{ color: '#7a7574', fontStyle: 'italic' }}
                                        >
                                            No speakers assigned yet
                                        </p>
                                    )}
                                    <p
                                        className="text-[0.5625rem] mt-1"
                                        style={{ color: '#7a7574' }}
                                    >
                                        Derived from transcript
                                    </p>
                                </div>

                                {/* RELATED */}
                                <div>
                                    <span
                                        className="text-[0.625rem] font-semibold uppercase tracking-wider"
                                        style={{ color: '#7a7574' }}
                                    >
                                        Related{relatedUsers.length > 0 ? ` (${relatedUsers.length})` : ''}
                                    </span>
                                    {relatedUsers.length > 0 ? (
                                        <div
                                            className="mt-1 divide-y"
                                            style={{ borderColor: '#f0edec' }}
                                        >
                                            {relatedUsers.map((r) => (
                                                <div
                                                    key={r.id}
                                                    className="flex items-center gap-2 px-2 py-1.5"
                                                    style={{ borderColor: '#f0edec' }}
                                                >
                                                    <span
                                                        className="w-4 h-4 shrink-0 flex items-center justify-center text-[0.5rem]"
                                                        style={{
                                                            backgroundColor: '#e8e4e3',
                                                            borderRadius: '50%',
                                                            color: '#7a7574',
                                                        }}
                                                    >
                                                        {r.name?.[0] || '?'}
                                                    </span>
                                                    <span
                                                        className="text-[0.75rem] truncate"
                                                        style={{ color: '#1c1b1b' }}
                                                    >
                                                        {r.name}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p
                                            className="text-[0.6875rem] mt-1"
                                            style={{ color: '#7a7574', fontStyle: 'italic' }}
                                        >
                                            No related users
                                        </p>
                                    )}
                                    <p
                                        className="text-[0.5625rem] mt-1"
                                        style={{ color: '#7a7574' }}
                                    >
                                        Auto-populated from group
                                    </p>
                                </div>

                                {/* Collapse toggle */}
                                <button
                                    onClick={() => setPartiesExpanded(false)}
                                    className="w-full mt-3 py-1.5 text-[0.625rem] font-semibold uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2"
                                    style={{
                                        backgroundColor: '#f6f3f2',
                                        border: 'none',
                                        color: '#7a7574',
                                    }}
                                >
                                    <span style={{ fontSize: '0.5rem' }}>&#9650;</span>
                                    show less
                                    <span style={{ fontSize: '0.5rem' }}>&#9650;</span>
                                </button>
                            </>
                        )}
                    </div>

                    {/* Compliance Protocol — reviewer only */}
                    {userRole === 'reviewer' && (
                        <div
                            className="p-4"
                            style={{ backgroundColor: '#ffffff' }}
                        >
                            <p
                                className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-3"
                                style={{ color: '#7a7574' }}
                            >
                                Compliance Protocol (FR-A01)
                            </p>
                            <label className="flex items-center gap-2 mb-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4"
                                    style={{ accentColor: '#b20100' }}
                                />
                                <span
                                    className="text-[0.8125rem] font-medium"
                                    style={{ color: '#1c1b1b' }}
                                >
                                    PII Redacted
                                </span>
                            </label>
                            <label className="flex items-center gap-2 mb-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4"
                                    style={{ accentColor: '#b20100' }}
                                />
                                <span
                                    className="text-[0.8125rem] font-medium"
                                    style={{ color: '#1c1b1b' }}
                                >
                                    Legal Disclaimers
                                </span>
                            </label>
                        </div>
                    )}

                    {/* Sensitivity Alert */}
                    <div
                        className="p-4"
                        style={{
                            backgroundColor: '#ffffff',
                            borderLeft: '3px solid #b20100',
                        }}
                    >
                        <p
                            className="text-[0.6875rem] font-bold uppercase tracking-wider mb-1"
                            style={{ color: '#b20100' }}
                        >
                            SENSITIVITY ALERT
                        </p>
                        <p
                            className="text-[0.75rem]"
                            style={{ color: '#1c1b1b' }}
                        >
                            Non-public data disclosure detected.
                        </p>
                        <button
                            className="text-[0.6875rem] font-semibold mt-2 cursor-pointer"
                            style={{
                                backgroundColor: 'transparent',
                                border: 'none',
                                color: '#b20100',
                            }}
                        >
                            REVIEW ALERT &rarr;
                        </button>
                    </div>

                    {/* Institutional Audit */}
                    <div
                        className="p-4"
                        style={{ backgroundColor: '#ffffff' }}
                    >
                        <p
                            className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-3"
                            style={{ color: '#7a7574' }}
                        >
                            Institutional Audit
                        </p>
                        <AuditRow
                            label="Duration"
                            value={
                                rawSegments.length ?
                                    formatTime(
                                        rawSegments[
                                            rawSegments.length - 1
                                        ]?.end || 0,
                                    )
                                :   '\u2014'
                            }
                        />
                        <AuditRow
                            label="Asset Quality"
                            value="HIGH"
                        />
                        <AuditRow
                            label="Source Format"
                            value="WAV (48kHz)"
                        />
                    </div>
                </div>
            </div>

            {/* Speaker Assignment Dialog */}
            <Dialog
                open={assignSegId !== null}
                onClose={() => {
                    setAssignSegId(null);
                    setSpeakerSearch('');
                }}
                title="Assign Speaker"
            >
                <input
                    value={speakerSearch}
                    onChange={(e) => setSpeakerSearch(e.target.value)}
                    placeholder="Search by name or company..."
                    autoFocus
                    className="w-full text-[0.8125rem] px-3 py-2 mb-3 outline-none"
                    style={{
                        backgroundColor: '#f6f3f2',
                        border: '1px solid #f0edec',
                        color: '#1c1b1b',
                    }}
                />

                <label
                    className="flex items-center gap-2 px-1 py-2 mb-3 cursor-pointer select-none"
                    style={{ borderBottom: '1px solid #f0edec' }}
                >
                    <input
                        type="checkbox"
                        checked={alternateMode}
                        onChange={(e) =>
                            setAlternateMode(e.target.checked)
                        }
                        className="w-4 h-4 shrink-0"
                        style={{ accentColor: '#b20100' }}
                    />
                    <div>
                        <span
                            className="text-[0.8125rem] font-medium"
                            style={{ color: '#1c1b1b' }}
                        >
                            Apply to all matching speakers
                        </span>
                        <p
                            className="text-[0.625rem]"
                            style={{ color: '#7a7574' }}
                        >
                            Assigns this person to every segment from
                            the same speaker slot
                        </p>
                    </div>
                </label>

                {assignSegId && speakerMap[assignSegId] && (
                    <div
                        className="flex items-center justify-between px-3 py-2 mb-3"
                        style={{
                            backgroundColor: 'rgba(0, 78, 198, 0.05)',
                            border: '1px solid rgba(0, 78, 198, 0.15)',
                        }}
                    >
                        <div className="flex items-center gap-2">
                            <img
                                src={
                                    speakerMap[assignSegId]
                                        .profilePic ||
                                    '/default_pfp.png'
                                }
                                alt=""
                                className="w-5 h-5 object-cover"
                                style={{ borderRadius: '0px' }}
                            />
                            <span
                                className="text-[0.75rem]"
                                style={{ color: '#004ec6' }}
                            >
                                Assigned:{' '}
                                <strong>
                                    {speakerMap[assignSegId].name}
                                </strong>
                            </span>
                        </div>
                        <button
                            onClick={() =>
                                unassignSpeaker(assignSegId)
                            }
                            className="text-[0.6875rem] font-semibold cursor-pointer"
                            style={{
                                backgroundColor: 'transparent',
                                border: 'none',
                                color: '#b20100',
                            }}
                        >
                            REMOVE
                        </button>
                    </div>
                )}

                <div
                    style={{ maxHeight: '280px', overflowY: 'auto' }}
                >
                    <SpeakerPickerSection
                        label="Operators (UBS)"
                        items={users.map((u) => ({
                            id: u.id,
                            name:
                                MOCK_USER_PROFILES[u.id]?.name ||
                                u.name,
                            company: 'UBS',
                            role: u.role,
                            type: 'operator',
                            profilePic:
                                MOCK_USER_PROFILES[u.id]
                                    ?.profilePic ||
                                '/default_pfp.png',
                        }))}
                        search={speakerSearch}
                        onPick={assignSpeaker}
                        currentId={
                            assignSegId ?
                                speakerMap[assignSegId]?.id
                            :   null
                        }
                    />
                    <SpeakerPickerSection
                        label="Clients"
                        items={MOCK_CLIENTS.map((c) => ({
                            id: c.id,
                            name: c.name,
                            company: c.company,
                            role: c.relationship,
                            type: 'client',
                            profilePic: '/default_pfp.png',
                        }))}
                        search={speakerSearch}
                        onPick={assignSpeaker}
                        currentId={
                            assignSegId ?
                                speakerMap[assignSegId]?.id
                            :   null
                        }
                    />
                </div>
            </Dialog>

            {/* Verifier Assignment Dialog */}
            <Dialog
                open={verifierPickerOpen}
                onClose={() => setVerifierPickerOpen(false)}
                title="Assign Verifier"
            >
                <p
                    className="text-[0.75rem] mb-3"
                    style={{ color: '#7a7574' }}
                >
                    Select a reviewer to verify this transcript. Only users in the Transcript Review group are shown.
                </p>
                <input
                    value={verifierSearch}
                    onChange={(e) => setVerifierSearch(e.target.value)}
                    placeholder="Search by name..."
                    autoFocus
                    className="w-full text-[0.8125rem] px-3 py-2 mb-3 outline-none"
                    style={{
                        backgroundColor: '#f6f3f2',
                        border: '1px solid #f0edec',
                        color: '#1c1b1b',
                    }}
                />
                <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
                    {eligibleReviewers
                        .filter((r) => !verifierSearch || r.name.toLowerCase().includes(verifierSearch.toLowerCase()))
                        .map((r) => (
                            <button
                                key={r.id}
                                onClick={() => {
                                    setVerifier(r);
                                    setVerifierPickerOpen(false);
                                }}
                                className="flex items-center gap-3 w-full px-3 py-2.5 cursor-pointer text-left"
                                style={{
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    borderBottom: '1px solid #f0edec',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f6f3f2'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                                {r.profilePic ? (
                                    <img
                                        src={r.profilePic}
                                        alt=""
                                        className="w-7 h-7 shrink-0 object-cover"
                                        style={{ borderRadius: '50%' }}
                                    />
                                ) : (
                                    <span
                                        className="w-7 h-7 shrink-0 flex items-center justify-center text-[0.625rem] font-semibold"
                                        style={{
                                            backgroundColor: '#e8e4e3',
                                            borderRadius: '50%',
                                            color: '#7a7574',
                                        }}
                                    >
                                        {r.name?.[0] || '?'}
                                    </span>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p
                                        className="text-[0.8125rem] font-medium truncate"
                                        style={{ color: '#1c1b1b' }}
                                    >
                                        {r.name}
                                    </p>
                                    <p
                                        className="text-[0.625rem] truncate"
                                        style={{ color: '#7a7574' }}
                                    >
                                        {r.designation} &middot; {r.role}
                                    </p>
                                </div>
                            </button>
                        ))}
                    {eligibleReviewers.filter((r) => !verifierSearch || r.name.toLowerCase().includes(verifierSearch.toLowerCase())).length === 0 && (
                        <p
                            className="text-[0.75rem] text-center py-4"
                            style={{ color: '#7a7574' }}
                        >
                            No matching reviewers found
                        </p>
                    )}
                </div>
            </Dialog>

            {/* Mask Across Segments Confirmation Dialog */}
            <Dialog
                open={pendingMask !== null}
                onClose={() => setPendingMask(null)}
                title="Apply Mask Globally?"
            >
                <p
                    className="text-[0.8125rem] mb-2"
                    style={{ color: '#1c1b1b' }}
                >
                    You replaced{' '}
                    <strong
                        style={{
                            fontFamily: 'monospace',
                            backgroundColor: '#f6f3f2',
                            padding: '1px 4px',
                        }}
                    >
                        {pendingMask?.word}
                    </strong>{' '}
                    with{' '}
                    <strong
                        style={{
                            fontFamily: 'monospace',
                            backgroundColor: 'rgba(178, 1, 0, 0.08)',
                            color: '#b20100',
                            padding: '1px 4px',
                        }}
                    >
                        [MASK]
                    </strong>{' '}
                    in this segment.
                </p>
                <p
                    className="text-[0.8125rem] mb-5"
                    style={{ color: '#7a7574' }}
                >
                    Would you like to mask every occurrence of this
                    word across all segments in this transcript?
                </p>
                <div className="flex items-center justify-end gap-3">
                    <button
                        onClick={() => setPendingMask(null)}
                        className="px-4 py-1.5 text-[0.8125rem] font-medium cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            border: '1.5px solid #f0edec',
                            borderRadius: '0px',
                            color: '#7a7574',
                        }}
                    >
                        NO, JUST THIS SEGMENT
                    </button>
                    <button
                        onClick={() => {
                            if (pendingMask)
                                applyMaskAcrossSegments(
                                    pendingMask.word,
                                );
                            setPendingMask(null);
                        }}
                        className="px-4 py-1.5 text-[0.8125rem] font-semibold cursor-pointer"
                        style={{
                            background:
                                'linear-gradient(135deg, #b20100, #e10000)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '0px',
                        }}
                    >
                        YES, MASK ALL
                    </button>
                </div>
            </Dialog>

            {/* Submit for Review Dialog */}
            <Dialog
                open={reviewDialogOpen}
                onClose={() => { setReviewDialogOpen(false); setReviewerSearchQuery(''); }}
                title="Submit for Review"
            >
                <p className="text-[0.8125rem] mb-4" style={{ color: '#7a7574' }}>
                    Select a reviewer or admin to review this transcript. Only one reviewer can be assigned.
                </p>
                <input
                    value={reviewerSearchQuery}
                    onChange={(e) => setReviewerSearchQuery(e.target.value)}
                    placeholder="Search by name or role..."
                    autoFocus
                    className="w-full text-[0.8125rem] px-3 py-2 mb-3 outline-none"
                    style={{ backgroundColor: '#f6f3f2', border: '1px solid #f0edec', color: '#1c1b1b' }}
                />
                <div style={{ maxHeight: '280px', overflowY: 'auto' }} className="mb-4">
                    {users
                        .filter((u) => u.role === 'reviewer' || u.role === 'admin')
                        .filter((u) => u.id !== user?.id)
                        .filter((u) => {
                            const q = reviewerSearchQuery.trim().toLowerCase();
                            if (!q) return true;
                            const profile = MOCK_USER_PROFILES[u.id];
                            const name = profile?.name || u.name;
                            const role = profile?.designation || u.role;
                            return name.toLowerCase().includes(q) || role.toLowerCase().includes(q);
                        })
                        .map((u) => {
                            const profile = MOCK_USER_PROFILES[u.id];
                            const name = profile?.name || u.name;
                            const pic = profile?.profilePic || '/default_pfp.png';
                            const designation = profile?.designation || u.role;
                            const isSelected = selectedReviewer?.id === u.id;
                            return (
                                <button
                                    key={u.id}
                                    onClick={() => setSelectedReviewer({ id: u.id, name, profilePic: pic, designation })}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer transition-colors"
                                    style={{
                                        backgroundColor: isSelected ? 'rgba(0, 78, 198, 0.06)' : 'transparent',
                                        border: isSelected ? '1px solid rgba(0, 78, 198, 0.2)' : '1px solid transparent',
                                        color: '#1c1b1b',
                                    }}
                                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = '#f6f3f2'; }}
                                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = isSelected ? 'rgba(0, 78, 198, 0.06)' : 'transparent'; }}
                                >
                                    <img
                                        src={pic}
                                        alt=""
                                        className="w-8 h-8 shrink-0 object-cover"
                                        style={{ borderRadius: '0px', border: isSelected ? '2px solid #004ec6' : '2px solid transparent' }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[0.8125rem] font-medium truncate">{name}</p>
                                        <p className="text-[0.6875rem] truncate" style={{ color: '#7a7574' }}>
                                            {designation} &middot; {u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                                        </p>
                                    </div>
                                    {isSelected && (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#004ec6" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                                    )}
                                </button>
                            );
                        })}
                </div>
                <div className="flex items-center justify-end gap-3">
                    <button
                        onClick={() => { setReviewDialogOpen(false); setReviewerSearchQuery(''); }}
                        className="px-4 py-1.5 text-[0.8125rem] font-medium cursor-pointer"
                        style={{ backgroundColor: 'transparent', border: '1.5px solid #f0edec', borderRadius: '0px', color: '#7a7574' }}
                    >
                        CANCEL
                    </button>
                    <button
                        onClick={handleSubmitForReview}
                        disabled={!selectedReviewer || submitStatus === 'submitting'}
                        className="px-4 py-1.5 text-[0.8125rem] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}
                    >
                        {submitStatus === 'submitting' ? 'SUBMITTING…' : 'SUBMIT'}
                    </button>
                </div>
            </Dialog>

            {/* Request Changes Dialog (reviewer/admin) */}
            <Dialog
                open={requestChangesOpen}
                onClose={() => { setRequestChangesOpen(false); setChangeReason(''); }}
                title="Request Changes"
            >
                <p className="text-[0.8125rem] mb-3" style={{ color: '#7a7574' }}>
                    This transcript will be sent back to the submitter for further edits. Optionally provide a reason.
                </p>
                <textarea
                    value={changeReason}
                    onChange={(e) => setChangeReason(e.target.value)}
                    placeholder="Describe what needs to be changed..."
                    rows={3}
                    className="w-full text-[0.8125rem] px-3 py-2 mb-4 outline-none resize-none"
                    style={{ backgroundColor: '#f6f3f2', border: '1px solid #f0edec', color: '#1c1b1b' }}
                />
                <div className="flex items-center justify-end gap-3">
                    <button
                        onClick={() => { setRequestChangesOpen(false); setChangeReason(''); }}
                        className="px-4 py-1.5 text-[0.8125rem] font-medium cursor-pointer"
                        style={{ backgroundColor: 'transparent', border: '1.5px solid #f0edec', borderRadius: '0px', color: '#7a7574' }}
                    >
                        CANCEL
                    </button>
                    <button
                        onClick={handleRequestChanges}
                        disabled={reviewActionStatus === 'rejecting'}
                        className="px-4 py-1.5 text-[0.8125rem] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}
                    >
                        {reviewActionStatus === 'rejecting' ? 'SENDING…' : 'REQUEST CHANGES'}
                    </button>
                </div>
            </Dialog>

            {showHelp && (
                <HelpOverlay onClose={() => setShowHelp(false)} />
            )}
        </div>
    );
}

function VolumeIcon({ muted, level }) {
    // 14x14 speaker glyph; wave count scales with level. Muted renders the
    // speaker with an X over it.
    if (muted) {
        return (
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
        );
    }
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            {level > 0.05 && (
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            )}
            {level > 0.55 && (
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            )}
        </svg>
    );
}

function ToolbarButton({
    children,
    onClick,
    disabled,
    title,
    active,
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            className="w-7 h-7 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            style={{
                backgroundColor:
                    active ? 'rgba(178, 1, 0, 0.08)' : 'transparent',
                border: 'none',
                borderRadius: '2px',
                color: active ? '#b20100' : '#1c1b1b',
            }}
            onMouseEnter={(e) => {
                if (!disabled && !active)
                    e.currentTarget.style.backgroundColor = '#f6f3f2';
            }}
            onMouseLeave={(e) => {
                if (!active)
                    e.currentTarget.style.backgroundColor =
                        'transparent';
            }}
        >
            {children}
        </button>
    );
}

function SaveStatus({
    status,
    isDirty,
    actionHistory,
    showHistory,
    onToggleHistory,
    historyRef,
    onUndoText,
    onUndoSpeaker,
    canUndoText,
    canUndoSpeaker,
}) {
    let label;
    let color;
    if (status === 'saving') {
        label = 'Saving…';
        color = '#7a7574';
    } else if (status === 'error') {
        label = 'Save failed';
        color = '#b20100';
    } else if (isDirty) {
        label = 'Unsaved';
        color = '#7a7574';
    } else {
        label = 'Saved';
        color = '#1a7f37';
    }

    function formatTimestamp(d) {
        return d.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }

    const iconForType = (type) => {
        if (type === 'text')
            return (
                <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#7a7574"
                    strokeWidth="2"
                >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
            );
        if (type === 'speaker')
            return (
                <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#7a7574"
                    strokeWidth="2"
                >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                </svg>
            );
        return (
            <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#7a7574"
                strokeWidth="2"
            >
                <path d="M3 7v6h6" />
                <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-7 3L3 13" />
            </svg>
        );
    };

    return (
        <div className="relative" ref={historyRef}>
            <button
                onClick={onToggleHistory}
                className="text-[0.6875rem] font-medium uppercase tracking-wider cursor-pointer flex items-center gap-1"
                style={{
                    color,
                    backgroundColor: 'transparent',
                    border: 'none',
                }}
                title="View action history"
            >
                {label}
                {actionHistory.length > 0 && (
                    <span
                        className="text-[0.5625rem] font-bold"
                        style={{ color: '#7a7574' }}
                    >
                        ({actionHistory.length})
                    </span>
                )}
                <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    style={{
                        transform:
                            showHistory ? 'rotate(180deg)' : (
                                'rotate(0)'
                            ),
                        transition: 'transform 150ms',
                    }}
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {showHistory && (
                <div
                    className="absolute right-0 top-full mt-2 w-80 z-50"
                    style={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #f0edec',
                        boxShadow:
                            '0 4px 16px rgba(28, 27, 27, 0.10)',
                    }}
                >
                    <div
                        className="flex items-center justify-between px-3 py-2"
                        style={{ borderBottom: '1px solid #f0edec' }}
                    >
                        <span
                            className="text-[0.6875rem] font-bold uppercase tracking-wider"
                            style={{ color: '#1c1b1b' }}
                        >
                            Action History
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={onUndoSpeaker}
                                disabled={!canUndoSpeaker}
                                className="text-[0.625rem] font-semibold px-2 py-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{
                                    backgroundColor: 'transparent',
                                    border: '1px solid #f0edec',
                                    color: '#1c1b1b',
                                }}
                                title="Undo last speaker assignment"
                            >
                                Undo Speaker
                            </button>
                            <button
                                onClick={onUndoText}
                                disabled={!canUndoText}
                                className="text-[0.625rem] font-semibold px-2 py-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{
                                    backgroundColor: 'transparent',
                                    border: '1px solid #f0edec',
                                    color: '#1c1b1b',
                                }}
                                title="Undo last text edit"
                            >
                                Undo Text
                            </button>
                        </div>
                    </div>
                    <div
                        style={{
                            maxHeight: '240px',
                            overflowY: 'auto',
                        }}
                    >
                        {actionHistory.length === 0 ?
                            <p
                                className="px-3 py-4 text-center text-[0.75rem]"
                                style={{ color: '#7a7574' }}
                            >
                                No actions yet
                            </p>
                        :   actionHistory.map((action, i) => (
                                <div
                                    key={i}
                                    className="flex items-start gap-2 px-3 py-2"
                                    style={{
                                        borderBottom:
                                            '1px solid #f6f3f2',
                                    }}
                                >
                                    <div className="mt-0.5 shrink-0">
                                        {iconForType(action.type)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p
                                            className="text-[0.75rem] truncate"
                                            style={{
                                                color: '#1c1b1b',
                                            }}
                                        >
                                            {action.description}
                                        </p>
                                        <p
                                            className="text-[0.625rem]"
                                            style={{
                                                color: '#7a7574',
                                            }}
                                        >
                                            {formatTimestamp(
                                                action.timestamp,
                                            )}
                                        </p>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                </div>
            )}
        </div>
    );
}

function HelpOverlay({ onClose }) {
    const rows = [
        ['Play / pause', 'Space'],
        ['Undo', 'Ctrl/Cmd + Z'],
        ['Redo', 'Ctrl/Cmd + Shift + Z'],
        ['Find in transcript', 'Ctrl/Cmd + F'],
        ['Close find / help / edit', 'Esc'],
        ['Next edit', '↓'],
        ['Previous edit', '↑'],
        ['Edit segment', 'Double-click'],
        ['Mask a word', 'Select word + Alt+G'],
        ['Seek to a word', 'Click the word'],
        ['Toggle this help', '?'],
    ];
    return (
        <div
            onClick={onClose}
            className="fixed inset-0 flex items-center justify-center z-50"
            style={{ backgroundColor: 'rgba(28, 27, 27, 0.45)' }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="p-6 max-w-md w-full"
                style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #f0edec',
                }}
            >
                <div className="flex items-center justify-between mb-4">
                    <h3
                        className="text-[0.875rem] font-bold uppercase tracking-wider"
                        style={{ color: '#1c1b1b' }}
                    >
                        Keyboard Shortcuts
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-[0.75rem] cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            border: 'none',
                            color: '#7a7574',
                        }}
                    >
                        Esc
                    </button>
                </div>
                <div className="space-y-2">
                    {rows.map(([label, key]) => (
                        <div
                            key={label}
                            className="flex items-center justify-between py-1"
                        >
                            <span
                                className="text-[0.8125rem]"
                                style={{ color: '#1c1b1b' }}
                            >
                                {label}
                            </span>
                            <span
                                className="text-[0.6875rem] px-2 py-0.5 font-mono"
                                style={{
                                    backgroundColor: '#f6f3f2',
                                    color: '#1c1b1b',
                                    borderRadius: '2px',
                                }}
                            >
                                {key}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function AuditRow({ label, value }) {
    return (
        <div className="flex justify-between items-center py-1">
            <span
                className="text-[0.75rem]"
                style={{ color: '#7a7574' }}
            >
                {label}
            </span>
            <span
                className="text-[0.75rem] font-semibold"
                style={{ color: '#1c1b1b' }}
            >
                {value}
            </span>
        </div>
    );
}

function SpeakerPickerSection({
    label,
    items,
    search,
    onPick,
    currentId,
}) {
    const q = search.trim().toLowerCase();
    const filtered =
        q ?
            items.filter(
                (p) =>
                    p.name.toLowerCase().includes(q) ||
                    p.company.toLowerCase().includes(q),
            )
        :   items;
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
                                backgroundColor:
                                    isSelected ?
                                        'rgba(0, 78, 198, 0.06)'
                                    :   'transparent',
                                border:
                                    isSelected ?
                                        '1px solid rgba(0, 78, 198, 0.2)'
                                    :   '1px solid transparent',
                                color: '#1c1b1b',
                            }}
                            onMouseEnter={(e) => {
                                if (!isSelected)
                                    e.currentTarget.style.backgroundColor =
                                        '#f6f3f2';
                            }}
                            onMouseLeave={(e) => {
                                if (!isSelected)
                                    e.currentTarget.style.backgroundColor =
                                        'transparent';
                            }}
                        >
                            <img
                                src={
                                    person.profilePic ||
                                    '/default_pfp.png'
                                }
                                alt=""
                                className="w-7 h-7 shrink-0 object-cover"
                                style={{
                                    borderRadius: '0px',
                                    border:
                                        isSelected ?
                                            '2px solid #004ec6'
                                        :   '2px solid transparent',
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
                                    {person.company} &middot;{' '}
                                    {person.role}
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
