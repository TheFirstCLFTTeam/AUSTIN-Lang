# UX Research: Common Editor Features for the Transcript Review Page

**Scope.** Patterns borrowed from general-purpose text editors (Microsoft Word,
Google Docs, Vim — ideas only, not motions) and transcription-specific tools
(Descript, Sonix, Otter) that the transcript review page at `/files/[id]`
should adopt to feel familiar and efficient for reviewers. Companion doc to
`UX_research_editing.md` (which covers the diff visual language).

---

## 1. What reviewers actually do on this page

A transcript reviewer's session is *not* free-form writing. It's a tight loop
of:

1. Hit play.
2. Listen to a phrase.
3. Spot a wrong word.
4. Fix it.
5. Keep going.

Repeat hundreds of times per hour for a skilled reviewer. The UX bar is low
*in novelty* and high *in muscle memory* — every extra click or missed
keyboard shortcut costs real minutes over a long file. The features we pick
should optimise for that loop, not for first-time exploration.

---

## 2. Features surveyed

### 2.1 Microsoft Word

- `Ctrl+Z` / `Ctrl+Y` — undo / redo (global, unlimited stack).
- `Ctrl+F` — find pane on the right edge, highlights all matches, `Enter`
  cycles.
- `Ctrl+H` — find-and-replace with separate boxes.
- `F7` — spellcheck pane.
- Track Changes (see neighbouring `UX_research_editing.md`).
- Status bar at the bottom: word count, language, zoom, save indicator.

### 2.2 Google Docs

- `Ctrl+Z` / `Ctrl+Shift+Z` — undo / redo.
- `Ctrl+F` — inline search bar that slides in from the top-right; matches
  highlighted inline in yellow.
- `Ctrl+H` — find & replace (richer than Word's in some ways, poorer in
  others).
- **Autosave with status text** — "Saved" / "Saving…" / "Offline" next to the
  title. This is one of Docs' most copied patterns because it removes the
  "did my edit stick?" anxiety.
- Suggesting mode (see companion doc).
- `Ctrl+K` — insert link (we don't need this).
- Version history (`File → Version history`) — named and timestamped
  snapshots of the document.

### 2.3 Vim (ideas, not motions)

Stripping out the motion language, the transferable Vim ideas are:

- **Explicit modes.** Normal/insert/visual are a coherent mental model;
  pressing wrong keys in the wrong mode is feedback, not an error. Our page
  already has `view` vs `edit` mode per segment. Making the mode *visible*
  (e.g., a status chip) reduces surprise.
- **Repeatable actions (`.`).** "Do the last thing again" is powerful during
  repetitive correction (the same speech disfluency across 40 segments).
- **Jump list (`<C-o>` / `<C-i>`).** Navigation between recently-visited
  positions. Transcript analogue: jump between recent edits.
- **Marks.** Tagging positions to return to later. Transcript analogue:
  "flag" a segment for follow-up review.
- **Visible modeline.** Status bar at the bottom showing mode, position,
  status. Removes guesswork about what's about to happen.

### 2.4 Descript

- Transcript editing feels like editing a Word document; cuts through the
  transcript cut the audio too.
- Extensive keyboard shortcuts for playback (play/pause, skip, speed).
- Auto-save with toast notifications.
- Word-level audio highlight during playback.

### 2.5 Sonix

- In-browser editor with a dedicated keyboard-shortcut reference; space to
  play/pause, `Tab`/`Shift-Tab` to jump between speakers.
- Edit history ("see edit history") visible to collaborators.
- Global `Ctrl+F` search across the transcript.

### 2.6 Otter

- Real-time collaboration and comments on spans of transcript.
- Speaker attribution editable inline.
- Less aggressive on keyboard shortcuts than Descript/Sonix.

---

## 3. Features we're adopting

Scoring on two axes — *impact on a reviewer's session* and *implementation
cost in this codebase* — these are the features with the best ratio:

| Feature                       | Source                          | Why it matters here                                                                                 |
|-------------------------------|---------------------------------|-----------------------------------------------------------------------------------------------------|
| Undo / Redo                   | Word, Docs, Vim                 | Typos in corrections happen; no editor feels trustworthy without this.                              |
| Save status indicator         | Docs                            | Removes the "did my edit persist?" anxiety. Free with our existing `saveEdits` flow.                |
| Find (`Cmd/Ctrl+F`)           | Word, Docs, Sonix               | Reviewers hunt for recurring wrong words (e.g., "their" → "there"); scanning by eye wastes minutes. |
| Jump to next/prev edit        | Vim jump list, Docs             | On a 300-segment file you can't scroll to find where you edited 20 minutes ago.                     |
| Revert segment                | Word Track Changes              | Sometimes an edit turns out worse than the original; surfacing this per-segment saves retyping.     |
| `Space` = play/pause          | Descript, Sonix                 | Zero-cost playback control without moving the hand from the keyboard.                               |
| `?` keyboard shortcut help    | Vim, VS Code, GitHub            | Discovery. Power users will look, everyone else can ignore.                                         |

Keybindings:

| Action                           | Shortcut                          |
|----------------------------------|-----------------------------------|
| Undo                             | `Cmd/Ctrl+Z`                      |
| Redo                             | `Cmd/Ctrl+Shift+Z`                |
| Find                             | `Cmd/Ctrl+F`                      |
| Close find                       | `Esc`                             |
| Next match                       | `Enter` (in find bar)             |
| Previous match                   | `Shift+Enter` (in find bar)       |
| Jump to next edit                | `Alt+↓`                           |
| Jump to previous edit            | `Alt+↑`                           |
| Play / Pause                     | `Space` (outside edit mode)       |
| Enter edit mode on a segment     | Double-click the segment          |
| Leave edit mode                  | `Esc` or blur                     |
| Show keyboard shortcut help      | `?`                               |
| Dismiss help                     | `Esc`                             |

---

## 4. Features deliberately skipped

- **Find & Replace.** "Find" alone captures the 80% — reviewers can jump to
  each match and decide. Replace introduces regex-vs-literal confusion, the
  question of "replace only unchanged text or also my edits", and a second
  input surface that has to live somewhere. Easy to add later.
- **Word count / character count.** Rarely load-bearing for transcript review.
  Could be added to the existing right sidebar if asked.
- **Comments on a span.** Implies a conversation; we're single-reviewer today.
  Lift from Google Docs / Otter when multi-reviewer workflows land.
- **Version history.** The `edits` array is effectively a (coarse) version
  log; named snapshots are overkill before we have multiple reviewers or an
  approval step.
- **Spellcheck / grammar suggestions.** Duplicates what the ASR model is
  already doing. A style linter for disfluencies ("uh", "um") could be a
  follow-up but isn't table-stakes.
- **Vim motions.** Explicitly excluded per the task; *ideas* (modes, jumps,
  marks, repeat-last) are what we're borrowing, not `h/j/k/l`.

---

## 5. Accessibility & interaction notes

- **Keyboard shortcuts must not fire while typing.** Find, undo, etc. listen
  on `document`, but we check `target.isContentEditable || target.tagName ===
  'INPUT' || target.tagName === 'TEXTAREA'` before treating a key as a
  shortcut. Exception: `Cmd/Ctrl+Z` still fires inside edit mode so undo
  works where the user expects.
- **Space = play/pause** is intentionally suppressed when the active element
  is editable, otherwise the reviewer's real space characters would pause
  the audio.
- **Help overlay** is a modal with a close button and `Esc`-to-close —
  standard dialog accessibility.

---

## 6. Implementation summary

| File                                            | Change                                                                                                       |
|-------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| `src/app/(dashboard)/files/[id]/page.jsx`       | State for undo/redo stacks, save status, find query, help overlay. Keyboard handler. Toolbar restructured.   |
| `src/lib/transcriptEdits.js`                    | No change — the data model already supports everything needed (edits are immutable snapshots, trivially diffable for undo). |

Undo/redo is implemented as two stacks of `edits` arrays. Because `edits` is
a plain array of plain objects, comparison and snapshotting are cheap. Each
commit (on segment blur, on revert) pushes the *previous* edits to the undo
stack and clears the redo stack; `Cmd+Z` pops from undo, pushes current to
redo; `Cmd+Shift+Z` does the reverse.

Save status tracks equality between `edits` and the last-saved snapshot. We
could debounce-autosave, but the explicit `SAVE EDITS` button is preserved
so reviewers who don't trust autosave can still see a confirmation.

Find highlights matching words (case-insensitive substring at word
granularity) in yellow. Integrates with the existing diff renderer by
adding a third style layer under the unchanged/deleted/inserted colour
system — matches win on background colour, the diff colour wins on foreground
and decoration, so a deleted word that also matches the search looks
correctly red-strikethrough on yellow.

---

## 7. Non-goals worth naming

This page is a *reviewer's workbench*, not a document editor. Rich text
formatting (bold, italic, lists, headings, tables, images) is deliberately
absent and should stay absent; if reviewers need to add commentary beyond
word-level corrections, that belongs in a comments layer, not in the
transcript body. Keeping the editing surface narrow keeps the cognitive load
low for the repetitive listen-fix loop this page is optimised for.
