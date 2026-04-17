# UX Research: Diff-style Transcript Editing

**Scope.** Patterns, conventions, and recommendations for showing user edits to
an ASR transcript using the visual language of `git diff` (red for removed
content, green for added content). Targets the review/edit screen at
`/files/[id]`.

---

## 1. Why borrow from git diffs

Reviewers of an ASR transcript do the same job as code reviewers: they need to
know, at a glance, *what the model produced* vs. *what a human changed*, and
why. The git-diff visual language is one of the most established and learnt
conventions in software — porting it costs nothing in training and gives the
reviewer immediate orientation:

- Red = removed (originally there, now gone).
- Green = added (not originally there, now present).
- Unchanged content stays neutral so the eye can skim straight to the deltas.

**Storage vs view.** The persisted edit log (`transcript_edit` in
`schema_platform.sql`) is **character-level** with two ops, `add` and
`delete`, anchored on `start_char`. The reviewer's view, however, is
word-level with three visual kinds — `unchanged`, `deleted`, `inserted` —
because that's the resolution at which a human reads a transcript. A word
swap is persisted as one `delete` + one `add` at the same `start_char`; the
diff renderer pairs that adjacency back into a single deleted/inserted token
sequence at view time (see §3). There is no `replace` op at the storage
layer — the schema treats it as a derived rendering, not a primitive.

---

## 2. Reference patterns

### 2.1 GitHub / GitLab — line-level diffs with intra-line word highlighting

- **Inline (unified) view:** removed lines prefixed `-` on a red background
  (`#ffebe9` light fill, `#cf222e` text in the GitHub light theme); added lines
  prefixed `+` on a green background (`#dafbe1` light fill, `#116329` text).
- **Within a changed line**, GitHub additionally highlights the *changed words*
  with a darker red/green so the reader doesn't have to re-read the whole line
  to find the substantive change. This is closest to what we want — we operate
  at word resolution all the time, not just within "changed lines."
- **Split view** puts old/new side-by-side. Higher information density but
  requires width; less appropriate for a transcript paragraph that already
  flows inline.

**Takeaway:** use inline word-level diffing. Don't add per-line backgrounds —
our segments aren't lines, they're spoken paragraphs, and a full red/green
background block would dominate the page.

### 2.2 Microsoft Word — Track Changes

- Inserted text: colored (per-author) and underlined.
- Deleted text: colored (per-author) and struck through.
- Optional change bar in the gutter.
- Reviewer can `accept` / `reject` each change individually.

**Takeaway:** strikethrough for deletions and a distinct color for insertions
are the strongest visual signals. Underline on inserts is a useful redundancy
when color alone isn't enough (accessibility, see §4).

### 2.3 Google Docs — Suggesting mode

- Insertions appear in the suggester's color, underlined.
- Deletions appear struck through, in the same color.
- A side comment offers `Accept` / `Reject` buttons.
- Hovering reveals attribution ("Suggested by …").

**Takeaway:** acceptance/rejection per word is overkill at our current
fidelity — the reviewer is the editor in our flow. A future "approve edits"
gate could lean on this pattern when a separate reviewer role enters the
loop.

### 2.4 Diff viewers in transcription tools (Otter, Rev, Descript)

- Most transcript editors *don't* show pre-edit text at all once a correction
  is committed — they just replace it. This is faster but loses provenance.
- Descript shows a faint underline on words that have been edited from the
  original; hovering reveals the original. This is a middle ground between
  "noisy diff" and "no history."

**Takeaway:** if reviewers complain that the full diff view is too noisy on
heavily-edited segments, an opt-in toggle ("show original") is a recognised
fallback pattern.

---

## 3. Token model

A diff renderer needs an ordered list of tokens. The persisted edits are
char-level (`add` / `delete` at `start_char`); the renderer walks the raw
text and the sorted edit list and emits word-level tokens:

| Persisted situation                                             | Rendered as                                         |
|-----------------------------------------------------------------|-----------------------------------------------------|
| No edit overlaps this word                                      | `unchanged` token, neutral color                    |
| `delete` covers this word's char range                          | `deleted` token, red strikethrough                  |
| `delete` of word W immediately followed by `add` at same offset | `deleted` (old word) then `inserted` (new) — a "replace" pair |
| `add` at offset between two words                               | `inserted` token placed at that offset              |

Why emit a delete + add pair as two tokens rather than collapsing into a
single "changed" token: it lets the renderer style each side with its proper
colour without inventing a third state, and it matches GitHub's intra-line
diff which paints removed and added text separately even when they're
adjacent. The pairing is a *view* concern only — the storage layer never
materialises a third op.

---

## 4. Accessibility & colour

Roughly 8% of men and 0.5% of women have some form of red-green colour vision
deficiency. Red-vs-green is the *worst* pairing for protan/deuteran vision.
Two mitigations:

1. **Redundant encoding.** Pair colour with shape: insertions get an underline,
   deletions get a strikethrough. Anyone reading purely on shape can still
   distinguish them.
2. **Sufficient contrast.** Use the dark text on light tint pairing rather
   than mid-tone vs mid-tone. GitHub's `#cf222e` on `#ffebe9` and `#116329` on
   `#dafbe1` are both above WCAG AA for body text.

For our app we're rendering inline (no full-row background), so we use
foreground colours only. Picked values:

| Token       | Colour     | Decoration       |
|-------------|------------|------------------|
| `inserted`  | `#1a7f37`  | underline        |
| `deleted`   | `#b20100`  | line-through     |
| `unchanged` | `#1c1b1b`  | none             |

`#1a7f37` is GitHub's "open / added" green at WCAG AA on white. `#b20100` is
the existing brand red used elsewhere in the app — keeping it makes the
deletion colour feel native rather than imported.

---

## 5. Audio-time highlighting interaction

The existing playhead-following highlight (subtle red background on the word
currently being spoken) needs to coexist with the diff colours. Resolution:

- The audio highlight is keyed to raw word indices via linear interpolation
  across `[segment.start, segment.end]`. It only applies to `unchanged` and
  `deleted` tokens — those have a `rawIndex` and therefore an audio interval.
- `inserted` tokens have no place in the audio timeline (the speaker did not
  say them) and stay statically green.
- When the playhead is on a `deleted` word, the strikethrough red wins
  visually; we layer the audio-active background *under* the strikethrough so
  the reviewer can still see the playhead is there but the diff intent is
  preserved.

This is an honest visual: it tells the reviewer "the model heard this word
here, but it has been removed." If we ever switch to per-word ASR
timestamps, the model is identical — only `wordIntervals` changes.

---

## 6. Edit-mode toggle (preserved from existing design)

Diff rendering replaces the *display* layer; the input layer is unchanged:

- **View mode (default):** diff tokens, red/green/neutral.
- **Edit mode (double-click on a segment):** plain `contentEditable` showing
  the *applied* text (raw + edits), focused with caret at end. On `blur` the
  text is re-diffed against the raw segment and the segment's edits in the
  global `edits` array are replaced atomically. `Esc` cancels.

Reasoning: we tried showing diff tokens *inside* a `contentEditable` element
in an earlier iteration and it shreds the user's caret on every audio
`timeupdate` re-render (~4 Hz). Separating display and input fixes that with
no loss of expressiveness — the user types in plain text, the diff
materialises the moment they blur.

---

## 7. Segment-level edit count

Long files can accumulate dozens of edits and a reviewer needs a way to skim
to the changed segments. We add a small `+N` chip in the speaker gutter when
a segment has any edits:

```
[14:23:01]  AGENT      Lorem ipsum dolor sit amet, [strikethrough: consectetur]
            +2 edits   adipiscing elit. [green: in fact] sed do eiusmod...
```

Two-digit count is fine; reviewers don't typically need to know "47 edits" vs
"48 edits" — they need to know "much-edited vs lightly-edited." This chip
also doubles as the entry point for a future "go to next/previous edit"
keyboard navigation feature.

---

## 8. What we deliberately do *not* implement (yet)

- **Per-edit accept/reject UI.** Our reviewer is the editor; we don't have a
  two-stage approval flow. Adding accept/reject would imply we do, and that's
  a product decision, not a UI one.
- **Author attribution colour-coding.** Single editor today. When multi-user
  co-editing arrives, lift the per-author colour pattern from Google Docs.
- **Char-level diff inside a "replaced" word.** When `twelve → thirteen`
  happens, we show `twelve` (struck) `thirteen` (added) as two whole-word
  tokens, not `t-w-e-l-v-e` vs `t-h-i-r-t-e-e-n` letter overlap. Char-level
  diff is technically possible (Myers algorithm at character resolution)
  but visually noisy at typical word lengths.

  Note: storage **is** char-level (one row per `add`/`delete` at
  `start_char`), but the *displayed* diff coalesces those rows back into
  word-level tokens. WER must therefore be computed from a word-level
  Levenshtein over `raw_text` vs `applied_text` — counting persisted edit
  rows directly would inflate WER (a one-word swap is two rows).
- **Per-word audio highlight on inserts.** No timestamp exists for words the
  speaker never said. Faking one (e.g., interpolating from neighbours) would
  be misleading. If/when ASR provides real per-word timestamps and a real
  forced-alignment of inserted text against the audio is available, this can
  change.

---

## 9. Implementation summary

| File                                          | Change                                                                |
|-----------------------------------------------|-----------------------------------------------------------------------|
| `src/lib/transcriptEdits.js`                  | New `buildDiffView(rawSegment, edits)` returning the token list.      |
| `src/app/(dashboard)/files/[id]/page.jsx`     | View mode renders diff tokens; edit count chip in the speaker gutter. |

When persistence lands, `transcriptEdits.js` will need:
- a converter on save: word-level `insert | delete | replace` ops → char-level
  `add | delete` rows at `start_char` (a `replace` flattens to one `delete` +
  one `add` at the same offset);
- a converter on load: walk `transcript_edit` rows in `start_char` order and
  pair adjacent `delete` + `add` at the same offset back into a "replace"
  rendering pair for the diff view;
- a WER change: switch from `edits.length / totalRawWords` to a word-level
  Levenshtein over raw vs applied text, since char-level row count and word
  count are no longer 1:1.

In-memory the editor can keep its existing word-level model — the schema
only constrains what crosses the persistence boundary.
