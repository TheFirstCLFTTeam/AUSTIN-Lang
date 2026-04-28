# File-Viewing Pipeline

_Last updated: 2026-04-27 (branch `ui_enhancement`)_

How a user goes from a file row in the browser to a fully-rendered transcript page. Covers the click-handling layer, the data-fetch path, the loading/busy states, and the mock-vs-real divergence points.

Sibling reading: `backend_integration_status.md` for the broader audit of which features are wired vs. stubbed.

---

## Pipeline at a glance

```
┌──────────────────┐  click/dblclick   ┌──────────────────────┐
│ FilesPage row    │ ─────────────────▶│ openFile(file)       │
│ (list or card)   │                   │ — perm gate          │
└──────────────────┘                   │ — setNavigatingId    │
                                       │ — router.push        │
                                       └────────┬─────────────┘
                                                │
                          Next.js App Router    ▼
                          (loading.jsx fallback during chunk/data resolve)
                                                │
                                                ▼
                                       ┌──────────────────────┐
                                       │ files/[id]/page.jsx  │
                                       │ useEffect on mount:  │
                                       │   fetchFileDetail()  │
                                       └────────┬─────────────┘
                                                │
                       MOCK_MODE? ───┬──────────┴──────────┐ no
                                     │ yes                 ▼
                                     ▼            http.get('/api/audio-files/{id}')
                            MOCK_FILE_STORE                │
                            (300 ms simulated)             ▼
                                     │            app/api/audio-files/[id]/route.js
                                     │                     │
                                     │                     ▼
                                     │            getAudioFileDetail(id) (server/audio-files.js)
                                     │            ── reads platform.db
                                     │            ── joins raw_transcript + segments + edits
                                     │                     │
                                     └──────────┬──────────┘
                                                │ data
                                                ▼
                                       setFileData → applyEdits → render
                                       (audio player, transcript, parties card)
```

---

## 1. The click — `src/app/(dashboard)/files/page.jsx`

A two-tap activation pattern (mirrors React Aria's `selectionBehavior="replace"` + `onAction` and the Stripe Dashboard / Finder model). Single source of truth lives in two helpers:

- **`openFile(file)`** — permission-gates (`file.isOwned || userRole === 'admin'`), refuses to fire while another navigation is in flight, sets `navigatingId`, then `router.push('/files/{id}')`.
- **`handleRowTap(file)`** — if the row is already `selected`, calls `openFile`; otherwise sets selection and triggers the brief inset-ring tap pulse.

Activation paths (all converge on `openFile`):

| Gesture | Outcome |
| --- | --- |
| Click unselected row/card | Selects (right-hand preview updates) |
| Click already-selected row/card | Opens detail page |
| Double-click any row/card | Opens immediately (power-user shortcut) |
| `Enter` on a focused row/card | Opens |
| "OPEN TRANSCRIPT" button on preview pane | Calls `openFile(selected)` |

A11y attributes set on each row/card: `role="button"`, `tabIndex={0}`, `aria-selected={isSelected}`, `aria-busy={isNavigating}`.

Visual feedback while navigating:
- Star slot swaps for an inline `RowSpinner` (CSS keyframe).
- Row dims to ~70 % opacity, cursor → `progress`, `pointer-events: none` (blocks accidental re-clicks).
- Grid cards get a translucent-blur overlay with a centered spinner.
- An "OPEN HINT" chip ("Click to open →") slides in on the selected row/card so the second-click affordance is discoverable.

---

## 2. The route transition

Next.js App Router matches `src/app/(dashboard)/files/[id]/page.jsx`. While the chunk + dependent data resolve, `src/app/(dashboard)/loading.jsx` shows the global Lottie fallback (`flex items-center justify-center py-20`). This fallback is shared across all dashboard pages, so the file-list spinner hands off to a route-level spinner, then to a page-level one — three coordinated stages, no blank flash.

`navigatingId` lives on the `FilesPage` component, so it auto-clears when that component unmounts at the route boundary.

---

## 3. The data fetch — `src/app/(dashboard)/files/[id]/page.jsx`

Client component (`'use client'`). On mount:

```js
useEffect(() => {
    fetchFileDetail(id).then((data) => {
        if (!data) return;
        if (userRole === 'engineer' && data.ownerId && data.ownerId !== user?.id) {
            setAccessDenied(true);
            return;
        }
        setFileData(data);
        setEdits(data.edits || []);
        setSavedEdits(data.edits || []);
        setFileStatus(data.status || 'needs action');
        ...
        recordAccess(user?.id || 'anon', id);
    });
}, [id, userRole, user?.id]);
```

Until `fileData` is populated the component returns a Lottie spinner with the copy "Loading transcript…" — same animation as `loading.jsx` so the transition is seamless.

Engineer-role files are gated client-side: an engineer hitting `/files/{id}` for a non-owned file lands on the access-denied screen even though the API will return the row. (The owner check is duplicated server-side in `getAudioFileDetail` / `/api/audio-files/[id]`.)

---

## 4. The data layer — `src/services/api.js` → `fetchFileDetail`

Two-mode dispatch on `process.env.NEXT_PUBLIC_MOCK_API`:

### Mock mode (`NEXT_PUBLIC_MOCK_API=true`, default for `npm run dev`)

```js
await new Promise((resolve) => setTimeout(resolve, 300));
return MOCK_FILE_STORE.find((f) => f.id === String(id)) || null;
```

`MOCK_FILE_STORE` lives in `src/services/mock-data.js` and is the single in-memory source of truth for all mock files (uploads append to it, edits mutate `f.edits`, etc.). The 300 ms simulated latency is intentional so loading states are exercised in dev.

### Real mode (`NEXT_PUBLIC_MOCK_API=false`)

```js
return await http.get(`/api/audio-files/${encodeURIComponent(id)}`);
```

`http.get` is the wrapper in `src/services/http.js` — sets `credentials: 'include'`, parses JSON, raises a tagged error on non-2xx (`err.status`, `err.body`, `err.body.detail`).

A 404 is swallowed silently (`return null`); the page then renders nothing while the user gets the access-denied / loading branch — call sites tolerate `null` returns.

---

## 5. The route handler — `src/app/api/audio-files/[id]/route.js`

Thin shim:

```js
export async function GET(_req, { params }) {
    const { id } = await params;
    const data = await getAudioFileDetail(id);
    if (!data) return NextResponse.json({ detail: 'Not found' }, { status: 404 });
    return NextResponse.json(data);
}
```

All shape/auth logic lives in the server module so the route stays trivial.

---

## 6. The server module — `src/server/audio-files.js`

`getAudioFileDetail(id)` reads from `platform.db` (SQLite, via `better-sqlite3`):

1. `audio_file` row by primary key.
2. `raw_transcript` joined on `audio_file_id`.
3. `transcript_segments` belonging to that raw transcript, ordered by start time.
4. `transcript_edit` rows for the same audio file.
5. Re-shapes the result into the **same structure the mock store uses**, so the client component renders identically in both modes:

```ts
{
  id, name, audioUrl, ownerId, ownerName, uploaded_at,
  status, reviewerId, submittedForReviewAt,
  rawTranscript: { id, audio_file_id, transcript_segments: [...] },
  edits: [...],
  // optional fixture-only hydration:
  verifier?, speakerMap?,
  // workflow extras:
  pseudonymisationApplied?, pseudonymisationWarning?
}
```

The shape parity is the contract — adding a new top-level field requires updating both `MOCK_FILE_STORE` fixtures and `getAudioFileDetail`.

---

## 7. The render — back in `files/[id]/page.jsx`

Once `fileData` arrives:

- `applyEdits(rawSegments, edits)` (from `src/lib/transcriptEdits.js`) produces `appliedSegments` — the post-edit text used by edit mode.
- The `<audio>` element gets `selected.audioUrl`. Play/pause/duration are tracked via DOM events because they're not observable through React props.
- Active segment highlighting follows `currentTime` (`activeId = rawSegments.find(s => currentTime >= s.start && currentTime < s.end)?.id`).
- Recording Parties card hydrates from `fileData.verifier` / `fileData.speakerMap` if the fixture pre-assigned them.

---

## Where things break, and where to look

| Symptom | Likely cause | First place to check |
| --- | --- | --- |
| Click does nothing | Select-mode active, or user lacks ownership/admin | `openFile` early-returns silently — see `files/page.jsx` |
| Spinner on the row sticks forever | `router.push` ran but the detail page errored or 404'd | Browser console + `/api/audio-files/{id}` response |
| "Loading transcript…" never resolves | `fetchFileDetail` is hanging | Dev-server terminal for `[api/audio-files]` errors; in real mode, also `metrics-service` / `pseudonymisation` calls fired by submit/approve |
| Access-denied flashes briefly | Engineer fetched a non-owned file; client-side gate fired after server returned | Expected; consider hiding the row at list level instead |
| File appears in mock mode, missing in real mode | Row exists in `MOCK_FILE_STORE` but not in `platform.db` | Re-seed: `python "database(FE)/seed/seed_platform_db.py"` |
| Upload completes but click→open shows a 404 | `/api/upload` mirror to `platform.db` failed mid-flight | Server logs; the upload may have written to `poc.db` (backend) but not the platform DB |

---

## Files referenced

- `src/app/(dashboard)/files/page.jsx` — list + grid, click handlers, busy state, `RowSpinner`, `OpenHint`
- `src/app/(dashboard)/files/[id]/page.jsx` — detail page, `useEffect` fetch, render
- `src/app/(dashboard)/loading.jsx` — global dashboard route fallback
- `src/services/api.js` — `fetchFileDetail`, mock/real branching
- `src/services/http.js` — fetch wrapper, error tagging
- `src/services/mock-data.js` — `MOCK_FILE_STORE`
- `src/app/api/audio-files/[id]/route.js` — route handler
- `src/server/audio-files.js` — `getAudioFileDetail`
- `src/lib/transcriptEdits.js` — `applyEdits`
- `database(FE)/platform.db` — SQLite source of truth in real mode
