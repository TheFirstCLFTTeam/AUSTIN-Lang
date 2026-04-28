● Suspicions confirmed. Here's the audit — clashes and unapplied bits I'd flag, organised by severity.

  Serious clashes

  - Two parallel "file-org" taxonomies with nearly identical names.
  Two different concepts now share a near-identical suffix.

- folders.js still uses user-file-org, engineer-file-org, reviewer-file-org, admin-file-org — these are the folder-control groups from UX_research_file_organisation.md (who can create/rename/delete folders).
- The new USER_GROUP_CATALOGUE uses hk-user-file-organisation, hk-engineer-file-organisation, … — these are data-visibility scopes (which files a persona sees in the HK region).
  The two are independent but named close enough to be confused. mock_data-users.js still carries fileOrgGroup: 'engineer-file-org' on user records — that's the folder group, not the new group catalogue. A
  reader seeing both keys side-by-side has no way to know they're different systems. Pick one spelling, or give one of them a disambiguating prefix.

  1. UX_research_file_organisation.md role→group mapping is stale.
  The doc's table still says engineer → engineer-file-org with the engineer persona as control member. That's only true for the folder service. The new access model attaches two groups to every persona (one
  file-org, one access-perms). The doc doesn't acknowledge the access-perms axis at all, so anyone reading it will think a persona belongs to exactly one group.

  2. transcript_edit SQL schema conflicts with the in-UI edit model.

- UX_research_editing.md §3 says edits are word-level with three ops: insert | delete | replace. WER is computed at word resolution.
- The new SQL table transcript_edit(start_char, content, operation) stores character-level with two ops (add, delete). No replace — it'd have to be modelled as delete+add.
  Either the UI's word-level model needs a decomposition step when persisting (word → char offsets), or the schema needs op_type extended to include replace and widened to word indices. Right now an edit
  round-trip through the DB would lose information.

  1. Leaderboard "scoped to your user group" is copy-only.
  leaderboard_research.md §5.6 spells out "The leaderboard is scoped to the current user's group (getGroupIdForRole)", and the page footer says "Scoped to your engineering group". But leaderboard/page.jsx never
  calls getGroupIdForRole or filters on group membership — every row for the selected dataset shows regardless of the viewer's group. Also now that each persona belongs to two groups, it's ambiguous which one
  should scope the leaderboard (the access-perms group MLE-generic-access-perms is the natural answer, not the file-org group).

  2. NFR-S02 role-based guards not applied.
  The auth pilot enforces authentication (Depends(get_current_user)) on every endpoint, but NFR-S02 mandates "role-appropriate guards". Today an engineer's cookie would pass every transcript mutation endpoint;
  there's no require_role("admin") analogue yet.

  Outdated docs vs. recent design calls

  1. leaderboard_research.md recommends trajectory sparkline + delta arrow + crown for rank 1.
  You later asked me to drop the trajectory column and the Δ column. The doc still lists them as §5.4 "Patterns to Adopt" and in the ASCII mock-up. It also doesn't mention the newly added Competition Baseline
  row. If anyone returns to the doc as a source of truth they'll re-add what you rejected.

  2. FamilyBadge + getBaseFamilyMeta get a baseline family now.
  The mock data adds baseFamily: 'baseline' for the Competition Baseline row, and mock_data-leaderboard.js defines the baseline entry in BASE_FAMILIES. The leaderboard page renders this correctly, but the family
   filter chips (in familyOptions) will now include a baseline chip alongside whisper/meralion/wav2vec2. Filtering by baseline would leave only the baseline row — probably not useful UX. Consider either
  excluding the baseline from familyOptions or making it non-filterable.

  PRD features documented but not implemented

  | Clause   | What's missing                                                                                                                                                                                       |
  | :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | FR-U01   | "Minimum 2 minutes" audio-length check. No validation anywhere on upload.                                                                                                                            |
  | FR-U04   | Drag-and-drop upload into the file browser; right-click context menu. Not implemented.                                                                                                               |
  | FR-A02   | is_cid_stripped flag on recordings. No column in schema, no UI.                                                                                                                                      |
  | FR-A02   | DELETION_LOG with recording_id, deleted_at, deleted_by. Only half-modelled (the trash entries in sampled-datasets.js set deleted_at / deleted_by on the file itself, but no audit log table exists). |
  | FR-A03   | COMMERCIAL_USER_ACCESS_LEVEL with max_uploads_per_day / max_storage_mb. Not in schema.                                                                                                               |
  | FR-A04   | FINANCIAL_TERM_DICTIONARY referenced across docs and metrics_dashboard.md (F-NER, SMR). No table, no admin surface.                                                                                  |
  | FR-A05   | CALL_TYPE_CATEGORY / CALL_TYPE_VALUE lookup tables. Not modelled.                                                                                                                                    |
  | FR-M05   | data_zone (green/red) tag per model version. training_job table has no data_zone.                                                                                                                    |
  | NFR-P01  | 7-day auto-delete is UI-mocked via TRASH_ENTRIES only; no backend job, no DELETION_LOG.                                                                                                              |
  | NFR-P02  | Red/green zone segregation not represented anywhere (no zone column on recordings, no filter in the ML surface).                                                                                     |
  | NFR-UX03 | User-role sidebar is supposed to be "My Transcripts, Shared, Starred, Recent, Trash, Upload"; current sidebar also shows "Processing" to all roles. Minor deviation but worth confirming intent.     |

  Minor / cosmetic

  1. TRASH_ENTRIES deletion behaviour lives inside sampled-datasets.js transform logic, not in a structured store. If we later persist trash via DB, this will need to move.

  2. Recording statuses were recently narrowed to transcribing | transcribed | queued | failed, but sampled-datasets.js still assigns a statusPool of ['needs action', 'in review', 'transcribed', 'transcribing',
  'completed', ...] to each generated file — so MOCK_FILE_STORE files still show "completed" and "needs action" statuses that the processing-page subset doesn't recognise. Intended (since those are
  My-Transcripts statuses, not recording statuses) but worth being explicit about in the doc, because right now "transcribed" exists in both contexts with the same name and it's easy to confuse them.

  3. leaderboard_research.md §6.3 wiring says engineer identities come from mock_data-users.js via getCurrentUser(), but the leaderboard mock rows use made-up IDs like eng-priya, eng-andreas, eng-james that
  don't exist in users. Only u2 (Engineer User) matches a real user. Means the "You" badge only ever lights up for u2; Priya/Andreas/James rows look like users but don't exist in users.db.

  Want me to pick any of these up now, or shall we log them and continue with Phase 2 of the DB migration? I'd argue (1), (3), (4) are worth fixing before Phase 2 because they will become DB-shaped problems
  rather than copy-tweaks.
