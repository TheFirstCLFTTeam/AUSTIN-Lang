// Transcript edit model.
//
// A file stores `rawTranscript` (immutable model output) plus a flat `edits`
// array. Each edit is a single word-level operation against a specific raw
// segment. The displayed text is the raw text with the relevant edits
// applied. Word Error Rate is computed live as edits.length / totalRawWords.

export function tokenize(text) {
    return (text || '').trim().split(/\s+/).filter(Boolean);
}

export function totalRawWords(rawSegments) {
    let n = 0;
    for (const s of rawSegments || []) n += tokenize(s.text).length;
    return n;
}

// Word-level diff using LCS backtrace. Adjacent delete+insert at the same
// raw index collapse into a single `replace` so a one-word fix counts as
// one edit, not two.
function diffWords(rawWords, currWords) {
    const m = rawWords.length;
    const n = currWords.length;
    const t = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            t[i][j] = rawWords[i - 1] === currWords[j - 1]
                ? t[i - 1][j - 1] + 1
                : Math.max(t[i - 1][j], t[i][j - 1]);
        }
    }
    const ops = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && rawWords[i - 1] === currWords[j - 1]) {
            i--; j--;
        } else if (j > 0 && (i === 0 || t[i][j - 1] >= t[i - 1][j])) {
            ops.unshift({ op: 'insert', wordIndex: i, before: null, after: currWords[j - 1] });
            j--;
        } else {
            ops.unshift({ op: 'delete', wordIndex: i - 1, before: rawWords[i - 1], after: null });
            i--;
        }
    }

    const collapsed = [];
    for (let k = 0; k < ops.length; k++) {
        const cur = ops[k];
        const next = ops[k + 1];
        if (cur.op === 'delete' && next?.op === 'insert' && next.wordIndex === cur.wordIndex) {
            collapsed.push({ op: 'replace', wordIndex: cur.wordIndex, before: cur.before, after: next.after });
            k++;
        } else {
            collapsed.push(cur);
        }
    }
    return collapsed;
}

let _editSeq = 0;
function newEditId() {
    _editSeq += 1;
    return `e_${Date.now().toString(36)}_${_editSeq}`;
}

// Replace this segment's edits with a fresh diff against its raw text.
// Other segments' edits are preserved.
export function recomputeSegmentEdits(edits, segmentId, rawText, currentText, meta = {}) {
    const ops = diffWords(tokenize(rawText), tokenize(currentText));
    const editedAt = meta.editedAt || new Date().toISOString();
    const editedBy = meta.editedBy || null;
    const next = (edits || []).filter((e) => e.segmentId !== segmentId);
    for (const o of ops) {
        next.push({ id: newEditId(), segmentId, ...o, editedBy, editedAt });
    }
    return next;
}

// Return raw segments with this segment's edits folded into `text`.
// `originalText` is preserved as the immutable raw text.
export function applyEdits(rawSegments, edits) {
    const bySegment = new Map();
    for (const e of edits || []) {
        const arr = bySegment.get(e.segmentId) || [];
        arr.push(e);
        bySegment.set(e.segmentId, arr);
    }
    return (rawSegments || []).map((seg) => {
        const segEdits = bySegment.get(seg.id);
        const text = segEdits?.length ? applySegment(seg.text, segEdits) : seg.text;
        return { ...seg, text, originalText: seg.text };
    });
}

function applySegment(rawText, segEdits) {
    const words = tokenize(rawText);
    const insertsAt = new Map();
    const deletes = new Set();
    const replaces = new Map();
    for (const e of segEdits) {
        if (e.op === 'insert') {
            const arr = insertsAt.get(e.wordIndex) || [];
            arr.push(e.after);
            insertsAt.set(e.wordIndex, arr);
        } else if (e.op === 'delete') {
            deletes.add(e.wordIndex);
        } else if (e.op === 'replace') {
            replaces.set(e.wordIndex, e.after);
        }
    }
    const out = [];
    for (let i = 0; i <= words.length; i++) {
        const ins = insertsAt.get(i);
        if (ins) out.push(...ins);
        if (i < words.length) {
            if (deletes.has(i)) continue;
            out.push(replaces.has(i) ? replaces.get(i) : words[i]);
        }
    }
    return out.join(' ');
}

export function computeWER(rawSegments, edits) {
    const total = totalRawWords(rawSegments);
    if (total === 0) return 0;
    return ((edits?.length || 0) / total) * 100;
}

// Produce an ordered token list for git-diff-style rendering of a single
// segment. Tokens carry `kind` plus the `rawIndex` they originate from, so
// the renderer can drive audio-time highlighting off raw word positions.
//
// Token shapes:
//   { kind: 'unchanged', text, rawIndex }
//   { kind: 'deleted',   text, rawIndex }   // includes the deleted side of a `replace`
//   { kind: 'inserted',  text }             // includes the inserted side of a `replace`; no rawIndex
export function buildDiffView(rawSegment, edits) {
    const words = tokenize(rawSegment?.text || '');
    const segId = rawSegment?.id;
    const segEdits = (edits || []).filter((e) => e.segmentId === segId);

    const insertsBefore = new Map(); // rawIndex -> [text, ...] (for op 'insert')
    const deletes = new Map();       // rawIndex -> deleted text
    const replaces = new Map();      // rawIndex -> { before, after }

    for (const e of segEdits) {
        if (e.op === 'insert') {
            const arr = insertsBefore.get(e.wordIndex) || [];
            arr.push(e.after);
            insertsBefore.set(e.wordIndex, arr);
        } else if (e.op === 'delete') {
            deletes.set(e.wordIndex, e.before ?? words[e.wordIndex] ?? '');
        } else if (e.op === 'replace') {
            replaces.set(e.wordIndex, { before: e.before ?? words[e.wordIndex] ?? '', after: e.after ?? '' });
        }
    }

    const tokens = [];
    for (let i = 0; i <= words.length; i++) {
        const ins = insertsBefore.get(i);
        if (ins) {
            for (const text of ins) tokens.push({ kind: 'inserted', text });
        }
        if (i < words.length) {
            if (replaces.has(i)) {
                const { before, after } = replaces.get(i);
                tokens.push({ kind: 'deleted', text: before, rawIndex: i });
                tokens.push({ kind: 'inserted', text: after });
            } else if (deletes.has(i)) {
                tokens.push({ kind: 'deleted', text: deletes.get(i), rawIndex: i });
            } else {
                tokens.push({ kind: 'unchanged', text: words[i], rawIndex: i });
            }
        }
    }
    return tokens;
}

// Pre-compute audio intervals for raw words in a segment using linear
// interpolation across [segment.start, segment.end]. The renderer keys the
// playhead-follow highlight off `rawIndex`, so this gives us O(1) lookup
// per token.
export function rawWordIntervals(rawSegment) {
    const words = tokenize(rawSegment?.text || '');
    const start = rawSegment?.start ?? 0;
    const end = rawSegment?.end ?? start;
    const dur = Math.max(0, end - start);
    const per = words.length > 0 && dur > 0 ? dur / words.length : 0;
    return words.map((_, i) => ({
        start: start + i * per,
        end: per > 0 ? start + (i + 1) * per : end,
    }));
}
