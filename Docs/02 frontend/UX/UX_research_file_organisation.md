# UX Research: File Organisation System

## Definitions

- **File**: A single row representing one audio recording + transcript pair.
- **File Organisation group**: A region-scoped, role-aligned group from `USER_GROUP_CATALOGUE` (see `src/services/mock_data-users.js`) that defines (a) which recordings the member can see and (b) the shared folder tree the group works in. The four canonical IDs today are `hk-user-file-organisation`, `hk-engineer-file-organisation`, `hk-reviewer-file-organisation`, `hk-admin-file-organisation`.
- **Control member**: The persona assigned to a File Organisation group. Has full authority over the folder structure that every member of that group sees. Since there is exactly one persona per role, that persona is automatically the control member.
- **Normal member**: Any other member of the group. Can move files into existing folders and request new folders, but cannot create folders or modify rules.

> **Note — two-axis group model.** Every persona is assigned **two** groups in the new access model: one **File Organisation** group (the data-scope + folder-tree bundle described here) and one **Access Permissions** group (the action bundle — what the persona can DO once they can see the data, e.g. `MLE-generic-access-perms`, `reviewer-generic-access-perms`). This document only covers the File Organisation axis. For the Access Permissions axis and the full persona → groups mapping see `INITIAL_USER_GROUP_ASSIGNMENTS` in `src/services/mock_data-users.js` and the role-permission columns in `Project_Requirements_Document.md` (FR-U*, FR-A*, FR-M*, NFR-S02).

---

## Capabilities Matrix

| Capability | Control Member | Normal Member |
|---|---|---|
| View folder structure | Yes | Yes |
| Move files into folders | Yes | Yes |
| Create new folders | Yes | No |
| Delete / rename folders | Yes | No |
| Set / edit folder rules | Yes | No |
| Request a new folder | N/A (can just create) | Yes |
| Approve / deny folder requests | Yes | N/A |

---

## Current State (as-is)

The existing files page uses a flat list with **hardcoded dataset folders** (sampled-datasets from Hugging Face). There is no concept of user-created folders, folder rules, or folder requests. Folders are just dataset source filters (`dataset === folderId`). The role system (generic, engineer, reviewer, admin) currently controls **data visibility and actions** (who can view/edit/approve transcripts), but does not control folder structure.

Key gap: the current "folders" are global and static. The new system needs **per-group, dynamic folders** governed by control members.

---

## Comparable UX Patterns

### Smart Folders / Rule-Based Folders

**Pattern**: Apple Finder Smart Folders, Gmail Filters + Labels, Notion Database Views.

These systems let a privileged user define a **saved query** that auto-populates with items matching certain metadata criteria. The folder itself has no "contents" in the traditional sense; instead it defines **inclusion rules** and any matching file appears inside it.

**Applicability**: This is the closest match to "folder rules based on metadata". Control members would build rules like:
- `status == "completed" AND language == "Cantonese"`
- `WER < 15%`
- `duration > 5min AND owner IN [list]`

**Key UX insight**: The rule builder should feel like a filter panel (which users already understand from the existing column filters), not like writing code. Use the same filter vocabulary the files page already exposes: status, date, duration, language, WER.

### Manual + Rule Hybrid

**Pattern**: Outlook folders with rules, Trello lists with automation.

Some folders are purely manual (drag files in), some are purely rule-based (auto-populate), and some are hybrid (rule-based baseline + manual overrides). This flexibility is important because not all organisational needs map to metadata queries.

**Recommendation**: Support three folder types:
1. **Manual folder** - control member creates it, members drag/move files in.
2. **Smart folder** - control member defines metadata rules, files auto-populate.
3. **Hybrid folder** - smart baseline + ability to manually include/exclude files.

### Folder Request Workflow

**Pattern**: Slack channel request, Jira project request, IT service desk ticketing.

Normal members who identify a need for a new folder should be able to submit a lightweight request. The request should capture:
- Suggested folder name
- Reason / description
- Optional: suggested rule criteria (pre-fill from the user's current active filters)

The control member sees these requests in a management panel and can approve (creating the folder), deny (with optional reason), or modify-and-approve.

**Key UX insight**: The request flow should be **low-friction** - ideally a single modal with 2-3 fields, not a multi-step form. The request can be triggered from:
- A "Request Folder" button in the folder sidebar
- A contextual action when a user is looking at files that don't fit any existing folder

### Shared Folder Views

**Pattern**: Google Drive Shared Drives, Dropbox Team Folders.

All members of a File Organisation group see the **same folder tree**, maintained by the control member. This is not a personal folder system; it is a shared organisational view. Changes by the control member propagate to all group members immediately.

---

## Proposed UI Components

### Folder Sidebar (All Members)

Replaces the current 4-column dataset grid with a collapsible sidebar or left-panel folder tree.

```
FOLDERS (hk-engineer-file-organisation)   [+ Request] (normal) / [+ New Folder] (control)
---------------------------------------------
All Files                          (142)
Starred                            (12)
---------------------------------------------
Completed - Cantonese              (38)   smart
Low WER (<10%)                     (22)   smart
Pending Review                     (17)   smart
Training Data                      (45)   manual
Uncategorised                      (8)
---------------------------------------------
Trash                              (3)
```

- Folder icons should differentiate manual vs smart folders (e.g., a small funnel/filter icon on smart folders).
- File counts shown in parentheses, updating live as files change metadata.
- Clicking a folder filters the main file list to show only matching files.
- "All Files" and "Starred" are permanent, non-deletable system folders.

### Folder Creation Modal (Control Members Only)

Triggered by the "+ New Folder" button. Fields:

| Field | Type | Required |
|---|---|---|
| Folder name | Text input | Yes |
| Folder type | Radio: Manual / Smart / Hybrid | Yes |
| Rules (if Smart or Hybrid) | Rule builder (see below) | Conditional |
| Description | Textarea | No |

### Rule Builder (Control Members Only)

Appears inside the folder creation/edit modal when folder type is Smart or Hybrid.

The rule builder uses the same metadata fields already exposed as column filters on the files page:

```
IF  [Status]      [is]           [completed]         [x]
AND [Language]     [is]           [Cantonese]         [x]
AND [WER]          [is less than] [15] %              [x]
                                          [+ Add condition]
```

- Each row = one condition: `field` + `operator` + `value`
- Operators vary by field type:
  - Text/enum: `is`, `is not`, `contains`, `is any of`
  - Numeric (WER, duration): `is`, `is greater than`, `is less than`, `is between`
  - Date: `is before`, `is after`, `is between`, `in the last N days`
- Conditions are combined with AND (all must match). A future iteration could add OR groups if needed.
- The preview at the bottom of the modal shows a live count: "**38 files** currently match these rules".

### Folder Request Modal (Normal Members Only)

Triggered by the "+ Request" button in the sidebar. Minimal fields:

| Field | Type | Required |
|---|---|---|
| Suggested folder name | Text input | Yes |
| Reason | Textarea (short) | Yes |
| Suggested filters | Optional: snapshot of current active filters | No |

On submission, a notification is sent to the control member of the group.

### Folder Request Management Panel (Control Members Only)

A section accessible from a "Manage Folders" button (gear icon) in the sidebar header. Shows:

```
FOLDER REQUESTS                                    (2 pending)
-------------------------------------------------------------------
"High WER Files"         requested by Alice      2 days ago
  Reason: "Need to isolate files with WER > 30% for retraining"
  Suggested rules: WER > 30%
  [Approve]  [Modify & Create]  [Deny]

"Client Meeting Recordings"   requested by Bob   5 days ago
  Reason: "Want to separate client-facing recordings"
  [Approve]  [Modify & Create]  [Deny]
```

- **Approve**: Creates the folder exactly as requested.
- **Modify & Create**: Opens the folder creation modal pre-filled with the request details, allowing the control member to adjust before creating.
- **Deny**: Dismisses the request with an optional reason sent back to the requester.

### Move-to-Folder Action (All Members)

For manual and hybrid folders, members need to move files. See detailed Google Drive reference research below.

---

## Data Model Considerations

### Folder Object

```
Folder {
  id: string
  name: string
  groupId: string              // e.g. "hk-engineer-file-organisation"
  type: "manual" | "smart" | "hybrid"
  rules: Rule[] | null         // null for manual folders
  description: string | null
  createdBy: string            // control member userId
  createdAt: ISO timestamp
  updatedAt: ISO timestamp
  isSystem: boolean            // true for "All Files", "Starred", "Trash"
}
```

### Rule Object

```
Rule {
  field: "status" | "language" | "wer" | "duration" | "date" | "owner" | "compliance"
  operator: "is" | "is_not" | "contains" | "gt" | "lt" | "between" | "in"
  value: string | number | string[] | [number, number]
}
```

### Folder Membership (for manual/hybrid folders)

```
FolderFile {
  folderId: string
  fileId: string
  addedBy: string              // userId who moved it
  addedAt: ISO timestamp
  isManualOverride: boolean    // true if added to hybrid folder despite not matching rules
}
```

### Folder Request Object

```
FolderRequest {
  id: string
  groupId: string
  requestedBy: string
  suggestedName: string
  reason: string
  suggestedRules: Rule[] | null
  status: "pending" | "approved" | "denied"
  respondedBy: string | null
  respondedAt: ISO timestamp | null
  denyReason: string | null
  createdAt: ISO timestamp
}
```

---

## Integration with Existing UI

### Files Page Changes

- **Replace** the current 4-column dataset grid at the top with the folder sidebar.
- The main file list continues to work as-is but now responds to folder selection as a filter.
- Existing column filters (status, date, duration, language, WER) remain and **stack** with the folder filter. E.g., selecting "Low WER" folder + filtering by "Cantonese" language = intersection.
- Breadcrumb updates: `HOME / MY TRANSCRIPTS / [Folder Name]`.

### Role Mapping to File Organisation Groups

| Existing Role | File Organisation Group | Access Permissions Group | Default Control Member |
|---|---|---|---|
| `generic` (user) | `hk-user-file-organisation` | `user-generic-access-perms` | The `generic` persona |
| `engineer` | `hk-engineer-file-organisation` | `MLE-generic-access-perms` | The `engineer` persona |
| `reviewer` | `hk-reviewer-file-organisation` | `reviewer-generic-access-perms` | The `reviewer` persona |
| `admin` | `hk-admin-file-organisation` | `hk-admin-access-perms` | The `admin` persona |

Each File Organisation group has its own independent folder tree. An engineer and a reviewer looking at the same files will see them organised into different folders per their group's structure. The Access Permissions column is shown for completeness — it controls actions, not folder structure, and is not in the scope of this document.

### Notification Integration

Folder requests should integrate with the existing notification service (`/src/services/notifications.js`):
- Normal member submits request -> notification to control member
- Control member approves/denies -> notification to requester
- Control member creates/renames/deletes a folder -> notification to all group members

---

## MVP Scope vs. Future Iterations

### MVP (Phase 1)
- Folder sidebar with manual folders only
- Control member can create, rename, delete folders
- Normal members can move files into folders
- Folder request modal + management panel
- Breadcrumb + folder filtering integration

### Phase 2
- Smart folders with rule builder
- Hybrid folders
- Live file count previews
- "Suggested filters" attachment on folder requests

### Phase 3
- Drag-and-drop file movement
- Bulk move operations
- Folder nesting (subfolders)
- Cross-group folder visibility (read-only views of another group's structure)

---

## Open Questions

1. **Should files exist in multiple folders?** Current design assumes a file can be in multiple manual folders (like tags/labels) rather than exactly one folder (like a filesystem). Which model fits better?
2. **What happens to existing dataset folders?** Are the current Hugging Face dataset groupings migrated into the new system as pre-created smart folders, or deprecated entirely?
3. **Admin override**: Can the `hk-admin-file-organisation` control member see or modify other groups' folder structures? This could be useful for org-wide consistency but may violate the mutual-exclusivity principle.
4. **Folder ordering**: Can control members reorder folders in the sidebar, or are they always alphabetical?

---
---

# UX Research: File Move Feature (Google Drive Reference)

## Overview

This document captures the UX patterns from Google Drive's "Move to" file organisation feature, adapted to AUSTIN-Lang's file management context. The goal is to implement a multi-select file-move workflow that feels familiar to users who have used Google Drive.

**Reference platform:** Google Drive Web (Material Design 3 / M3 Expressive, 2025-2026)

---

## 1. Entry Points

Google Drive provides multiple ways to initiate a file move. For AUSTIN-Lang, we adopt the **three-dot context menu** as the primary entry point.

### Google Drive's entry points (for reference)
| Method | Description |
|---|---|
| **Right-click context menu** | `Right-click > Organize > Move` — nested under an "Organize" parent item |
| **Toolbar action bar** | When files are selected, a contextual toolbar appears with a Move icon button (folder with arrow) |
| **Three-dot overflow menu** | Click the three-dot icon on a file row > "Move to" |
| **Keyboard shortcut** | `Ctrl+Alt+M` (Win) / `Cmd+Option+M` (Mac) opens the Move dialog |
| **Drag-and-drop** | Drag files onto visible folders in the file list or sidebar |

### AUSTIN-Lang adaptation
- **Primary entry:** Three-dot menu on each file row > **"Move"** menu item
- Clicking "Move" transitions the file list into **multi-select mode** (see Section 2)
- The file that triggered the three-dot menu is **automatically pre-selected**

---

## 2. Multi-Select Flow

### Google Drive's selection model
- **Single click** selects one file, deselecting others
- **Ctrl+Click** (Cmd+Click) adds/removes individual files from selection
- **Shift+Click** selects a contiguous range
- **Ctrl+A** selects all visible items
- **Esc** clears selection

### Visual changes on selection (Google Drive)
- **Checkboxes** appear to the left of each file's icon on hover; selected files show a filled blue checkmark
- **Row highlight** in light blue tint (`~#e8f0fe`) for selected rows
- **Selection count** shown in toolbar (e.g., "3 selected")
- **Toolbar transforms** from passive navigation to contextual action bar with: Share, Download, Rename, Star, Move, Delete, More

### AUSTIN-Lang adaptation

When the user clicks "Move" from the three-dot menu:

1. **Star icons are replaced with checkboxes** across all file rows
2. The file that was right-clicked is **already checked**
3. Users can click additional checkboxes to include more files in the move
4. A **floating action bar** appears at the bottom or top of the file list:
   - Shows count: "**N file(s) selected**"
   - **"Move selected"** primary button (red gradient, matching app theme)
   - **"Cancel"** secondary button to exit multi-select mode and restore star icons
5. Clicking **"Move selected"** opens the folder picker dialog (Section 3)

**Checkbox styling (matching M3 / app design language):**
- Unchecked: outlined square border in `#7a7574` (grey)
- Checked: filled with `#b20100` (app primary red), white checkmark inside
- No border-radius (matching app's 0px radius design language)

---

## 3. Move Dialog (Folder Picker)

### Google Drive's location picker

Google Drive's redesigned location picker (April 2023+) is a **large modal dialog** with:

**Header area:**
- Displays the filename(s) being moved and their current location
- Provides clear context about what is being moved and from where

**Tab navigation (top level):**
| Tab | Contents |
|---|---|
| **Suggested** | AI-powered folder recommendations based on usage patterns; dismissible |
| **Starred** | All starred/bookmarked folders for quick access |
| **All locations** | Full browsable hierarchy — My Drive, Shared Drives, Shared with Me |

**Folder tree / navigation:**
- Folders displayed as a **vertical list** inside the dialog body (folder icon + name)
- **Click to enter** a folder — navigates into it, showing subfolders
- **Back arrow + folder name** replaces the tabs when navigated into a subfolder (acts as breadcrumb)
- **Full folder path** displayed at the bottom of the list once a destination is selected (e.g., `My Drive > Projects > 2025 > Assets`)
- **Empty folder state:** illustration + text indicating no subfolders exist
- **Horizontal slide transition** when navigating in/out of folders

**Bottom bar:**
- **"+ New folder"** button (bottom-left) — creates a folder inline at the current level
- **"Move"** button (bottom-right) — primary filled button in Google Blue, enabled only when a valid destination is selected

**Close/cancel:**
- Close via X button (top-right), clicking the scrim, or pressing Escape
- No explicit "Cancel" text button in the redesigned picker

### AUSTIN-Lang adaptation

The folder picker dialog should:

1. **Dialog title:** "Move N file(s)" with a subtitle showing the file names (truncated if many)
2. **Folder tree:** Show the user's existing dataset folders (from `SAMPLED_DATASET_FOLDERS`) plus a "Root" option for top-level placement
   - Each folder row: folder icon + folder name + file count badge
   - Click a folder to navigate into it (if it has subfolders)
   - Back arrow to go up a level
   - Current path displayed as breadcrumb trail
3. **Highlight the current location** of the selected files (if all from the same folder) with a subtle indicator — files can't be "moved" to their current location
4. **"Create folder"** button at the bottom-left for creating a new destination on the fly
5. **"Move here"** primary button (bottom-right) — uses app's red gradient styling, disabled until a valid destination is selected
6. **"Cancel"** secondary button (bottom-right, left of Move here)

**Dialog dimensions:** ~480px wide, ~500px tall (matching Google Drive proportions)

---

## 4. States, Edge Cases, and Feedback

### Google Drive's handling

**Invalid destinations:**
- View-only folders show "View only" label; Move button stays disabled
- Moving a folder into itself: the folder is hidden or greyed out in the picker
- Insufficient permissions: lock/restriction indicator on folder, Move button disabled

**Permission warnings:**
- Moving between folders with different sharing settings triggers a **warning dialog**: "Some people could lose or gain access"
- Files inherit the sharing permissions of the new parent folder

**Constraints:**
- Max 100,000 items per move operation
- Folders with >25 unmovable items or >10% unmovable items cannot be moved

**Success feedback:**
- **Snackbar/toast** at bottom-left: "N file(s) moved to [Folder Name]"
- Includes **"Undo"** action button — auto-dismisses after ~5-8 seconds
- Files fade out / animate removal from the current view

**Loading states:**
- Circular spinner inside dialog while loading folder contents
- Move button shows loading spinner or becomes disabled during execution

### AUSTIN-Lang adaptation

**States to implement:**
- **Moving to current location:** Disable the "Move here" button if the destination is the same as the source
- **Empty folder:** Show a message "No subfolders" with an option to create one
- **Loading:** Spinner while folder tree loads (brief, since mock data is local)

**Post-move feedback:**
- Toast notification: "**N file(s) moved to [Folder Name]**" with an **Undo** action
- Toast auto-dismisses after 5 seconds
- Files disappear from the current view with a brief fade animation
- If the user clicks Undo, files reappear in place

**Error handling:**
- If a file is already in the target folder, skip it silently and show count of actually moved files
- If all selected files are already in the target, show: "Files are already in this folder"

---

## 5. Visual Design Reference

### Google Drive's design tokens (M3, 2025-2026)
| Element | Value |
|---|---|
| Primary action color | Google Blue `#1a73e8` |
| Selected row background | `#e8f0fe` (light blue tint) |
| Hover row background | `#f1f3f4` (light gray) |
| Primary text | `#202124` (near-black) |
| Secondary text | `#5f6368` (gray) |
| Dialog background | `#ffffff` (white) |
| Checkbox checked | Primary blue fill + white checkmark |
| Folder item row height | 40-48px |
| Dialog internal padding | 24px |
| Button height | 36-40px |
| Button border-radius | 20px (M3 pill shape) |
| Typography | Google Sans, 14px for labels |

### AUSTIN-Lang mapping
| Google Drive | AUSTIN-Lang equivalent |
|---|---|
| Google Blue `#1a73e8` | Primary red `#b20100` / gradient `linear-gradient(135deg, #b20100, #e10000)` |
| Selected row `#e8f0fe` | `rgba(178, 1, 0, 0.06)` (red tint) |
| Hover row `#f1f3f4` | `#f6f3f2` |
| Primary text `#202124` | `#1c1b1b` |
| Secondary text `#5f6368` | `#7a7574` |
| Dialog background | `#ffffff` |
| Checkbox checked | `#b20100` fill + white checkmark |
| Border-radius on buttons | `0px` (app design language) |
| Border-radius on dialog | `0px` (app design language) |
| Typography | System font stack (matching app) |

---

## 6. Interaction Flow Summary

```
User clicks three-dot menu on a file row
            |
    Selects "Move" from dropdown
            |
    File list enters MULTI-SELECT MODE
    - Star icons replaced with checkboxes
    - Clicked file is pre-checked
    - Floating action bar appears: "[N] selected | Cancel | Move selected"
            |
    User optionally checks more files
            |
    Clicks "Move selected"
            |
    FOLDER PICKER DIALOG opens
    - Shows folder tree (dataset folders + root)
    - User browses/navigates folders
    - Current path shown as breadcrumb
    - "Create folder" available at bottom-left
            |
    User selects destination folder
            |
    Clicks "Move here"
            |
    Files are moved (dataset field updated on each file)
    Dialog closes
    Multi-select mode exits (checkboxes revert to stars)
            |
    TOAST: "N file(s) moved to [Folder Name]" [Undo]
    Files fade out of current view
```

---

## Sources
- [Google Workspace Blog: Streamlined file organization with the new Google Drive location picker (April 2023)](https://workspaceupdates.googleblog.com/2023/04/streamlined-file-organization-google-drive-location-picker.html)
- [9to5Google: Google Drive rolling out redesigned 'Move to' picker](https://9to5google.com/2023/04/12/google-drive-move-to/)
- [Google Support: Keyboard shortcuts for Google Drive](https://support.google.com/drive/answer/2563044?hl=en)
- [Google Support: Organize your files in Google Drive](https://support.google.com/drive/answer/2375091?hl=en)
- [Google Support: Move files & folders into shared drives](https://support.google.com/drive/answer/13045066?hl=en)
- [UX Design (Medium): Rethinking Google Drive's Move to feature](https://uxdesign.cc/rethinking-google-drives-move-to-feature-ux-challenge-bcc2d738c20e)
- [9to5Google: Google Drive M3 Expressive redesign (2025-2026)](https://9to5google.com/2025/08/27/google-drive-material-3-expressive-redesign/)
