# Zoom Auto-Transcription Integration

Plan for automatically pulling Zoom meeting recordings into the platform for
transcription — e.g. host a 7am Zoom meeting, and by the time you're at your
desk the recording is already in the file browser with a transcript queued.

## Recommended architecture

**Zoom Cloud Recording + webhook → platform ingest API.** Primary delivery is
server-to-server via Zoom webhooks; no local agent, no scheduler.

Webhooks are the primary path because the provider already knows when a
recording is ready — polling is guessing, and wastes API quota. But webhook
deliveries *do* fail (provider outages, stale subscriptions, signature
mismatches, endpoint blips). So we pair the webhook with a **~30-minute
polling fallback** that checks the webhook's health and backfills anything
the webhook missed. Webhooks for speed, polling for correctness.

## End-to-end flow (single meeting)

1. Host toggles **Record to Cloud** (or sets it as the default in their Zoom
   profile so every meeting records automatically).
2. Meeting ends. Zoom transcodes the recording — typically a few minutes for a
   1-hour call.
3. Zoom fires a `recording.completed` webhook to our endpoint.
4. Webhook handler on this platform:
   1. Validates the signature against `ZOOM_WEBHOOK_SECRET_TOKEN`.
   2. Looks up the linked Zoom account for the meeting host.
   3. Uses the stored OAuth access token (refreshing if needed) to fetch the
      recording's `download_url`.
   4. Streams the audio into our file store and registers a file record owned
      by the host — same shape as a manual upload, so it appears in the file
      browser with full metadata (title, duration, start time, participants).
   5. Enqueues a transcription job against that file via the existing
      pipeline.
5. When the transcript is ready, the existing **Transcription Ready**
   notification fires for the host.

The time of day ("7am") is not meaningful technically — the trigger is
"recording finished transcoding," not a cron. The only thing that ever has to
fire "on time" is Zoom itself.

## Components to build

### 1. Zoom Marketplace OAuth app
- User-managed OAuth (not JWT — Zoom deprecated JWT apps in 2023).
- Scopes: `meeting:read`, `recording:read`, `user:read`.
- Event subscriptions: `recording.completed`, optionally `meeting.ended` for
  UX niceties.
- Redirect URI points to our OAuth callback route.

### 2. OAuth + token storage
- Per-user row: `zoomUserId`, `accessToken`, `refreshToken`, `expiresAt`,
  `scopes`, `connectedAt`.
- Access tokens expire in 1 hour — refresh lazily on the way into every Zoom
  API call, not on a timer.

### 3. Webhook endpoint
- New Next.js API route: `/api/integrations/zoom/webhook`.
- Handles two event types:
  - `endpoint.url_validation` — the one-time challenge Zoom sends when you
    register the endpoint. Must echo back the plain + hashed token within
    3 seconds.
  - `recording.completed` — the real payload. Verify the
    `x-zm-signature` HMAC before doing anything else.
- Hand off ingest to a background job — don't block the webhook response on a
  file download. Zoom retries aggressively on >3s responses.

### 4. Ingest adapter
- Maps Zoom's recording payload into our file record:
  - `topic` → file name
  - `start_time`, `duration` → timestamps
  - `host_email` → owner
  - `participant_count`, `participant_audio_files[]` → speaker hints, useful
    for diarization
- Downloads the MP4/M4A using the OAuth access token as a bearer, not the
  legacy download token.
- On success, enqueue transcription through the same code path as manual
  uploads — the file doesn't "know" it came from Zoom after this point.

### 5. Polling fallback (webhook health check)
Runs every **~30 minutes** per connected account. Two jobs in one:

1. **Health check** — confirm the webhook subscription still exists on Zoom's
   side and hasn't been revoked, rotated, or silently disabled. Zoom's
   subscription endpoints report last-delivery time and status; if our view
   disagrees with Zoom's (we believe the webhook is healthy but Zoom shows no
   deliveries attempted), flag the integration as degraded in the UI and
   re-register the subscription.
2. **Reconciliation sweep** — call `GET /users/{id}/recordings` scoped to the
   last ~24 hours, diff the returned recording IDs against what we've already
   ingested, and enqueue any we missed. This is the mechanism that rescues
   recordings dropped by webhook delivery failures.

Cadence rationale: 30 minutes is short enough that a dropped webhook doesn't
leave a user staring at an empty file browser for long, but long enough to
stay well under Zoom's per-app rate limits even with many connected accounts.
Per-user jitter the cron start times so all accounts don't poll in lockstep.

Note: colloquially called "long polling" in product conversations — the
actual mechanism is a scheduled interval poll, not the HTTP long-polling
technique.

### 6. Integrations page (frontend)
- New route under the dashboard: `/integrations/zoom`.
- **Connect Zoom** button → OAuth authorization URL.
- Once linked:
  - Show the Zoom account email, scopes granted, and connected-on date.
  - Toggle: **Auto-transcribe new recordings** (default on).
  - Toggle: **Also pull Zoom's speaker-labeled VTT** (use it to seed
    diarization instead of running ours from scratch).
  - **Disconnect** button (revoke the token on Zoom's side too, not just
    locally).
- Recent ingest history table: last N recordings that were pulled, with
  status (pulled / transcribing / ready / failed).

## Alternatives (and when to pick them)

**Local recording + watch-folder agent.** Zoom records to
`~/Documents/Zoom/...` on the host's machine; a small sync agent uploads new
`.mp4` files. Works with free Zoom accounts but depends on the host's laptop
being online and awake when the meeting ends. Fragile — skip unless you have
users on the free tier and absolutely need auto-ingest for them.

**Meeting bot (recall.ai-style).** A bot joins the call and captures audio
independently of whether the host records. Worth it only if you need
recordings from meetings you don't host, or if you want real-time transcript
streaming during the call. Adds vendor dependency and a visible participant
in the call.

**Calendar-driven pre-provisioning.** Read the host's Google/Outlook calendar
to pre-create a "pending recording" row so the UI can show "expected at
7:45am." Nice-to-have layered on top of the webhook architecture — not a
replacement for it.

## Watch-outs

- **Consent & notice.** Some jurisdictions (two-party-consent states in the
  US, most of the EU) require explicit notice before recording. Add a line to
  the meeting invite template and a splash in the recording UI.
- **Retention.** Zoom Cloud Recordings have their own retention policy. Once
  we've pulled the file, we own retention; document this so compliance
  doesn't get surprised.
- **Multi-recording meetings.** A single meeting produces multiple files
  (video MP4, audio-only M4A, chat text, transcript VTT). Decide up front
  which one(s) to ingest — audio-only M4A is usually the right default for
  transcription.
- **Large files.** Long meetings can exceed any per-request body limits.
  Stream the download; don't buffer into memory.
- **Speaker diarization.** Zoom provides speaker-labeled VTT files. Ingesting
  those alongside the audio lets the transcription pipeline skip its own
  diarization step, which is the expensive part.
- **Rate limits.** Zoom throttles per OAuth app, not per user. Queue
  downloads rather than firing them in parallel off the webhook.

## Out of scope (for this phase)

- Real-time / in-call transcription.
- Recording meetings the user doesn't host.
- Teams, Google Meet, or Webex — same pattern, different webhook spec;
  address individually after Zoom ships.