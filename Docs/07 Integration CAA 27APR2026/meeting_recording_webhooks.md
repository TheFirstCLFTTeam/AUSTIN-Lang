# Ingesting Teams & Zoom recordings via webhooks

_Last updated: 2026-04-27_

Design notes for a backend service that subscribes to "recording finished" events from Zoom and Microsoft Teams, downloads the media, and hands it off to our existing transcription pipeline (`transcription-orchestrator:8001`) the same way `frontend/src/app/api/upload/route.js` does for human-uploaded audio.

Sibling reading:
- `backend_integration_status.md` — current state of the broader integration surface.
- `file_viewing_pipeline.md` — what happens after a file lands in `platform.db`.

---

## 1. The integration shape (what we build)

Webhooks must hit a **public HTTPS endpoint** — the Next.js frontend container is internal and not the right home for this. Add a new backend service alongside the orchestrator:

```
[Zoom / Microsoft Graph]
   │  signed POST
   ▼
meeting-webhook-receiver   ← NEW service, public HTTPS, FastAPI or Express
   1. verify signature / clientState / validationToken
   2. respond 200 (Zoom) / 202 (Teams) within 3 s
   3. enqueue (provider, recording_id, raw_payload) to Redis / SQS
                │
                ▼
   meeting-recording-worker
   4. dedupe on (provider, recording_id)
   5. mint provider access token
   6. stream-download recording bytes
   7. POST multipart/form-data to transcription-orchestrator:8001/transcribe/
      — same contract /api/upload uses today
   8. mirror row into platform.db via the existing registerUploadedFile path
```

**Why split receiver and worker:** Zoom retries non-2xx responses 3× with a 3-second timeout, then drops the event. Microsoft Graph's tolerance is more forgiving (exponential backoff up to 4 h), but a 10 s p95 receiver is still throttled. We can't run a multi-MB media download inside the receiver.

**Why not put this on the Next.js frontend:**
- Tenant admins want a single, stable HTTPS URL (e.g. `hooks.austin-lang.example/teams/recording`) — this should not move with frontend deploys.
- Webhook handlers must reject anonymous traffic on the basis of cryptographic signatures, not session cookies. The Next middleware is built for the latter.
- Long-running media downloads belong in a worker tier, not a Next route handler.

---

## 2. Zoom

### 2.1 The event we subscribe to

`recording.completed` on a Meeting webhook subscription. There is also `recording.transcript_completed` for Zoom's own captions, fired separately (sometimes hours later) — ignore unless we ever decide to consume Zoom's transcripts directly.

**Don't confuse it with** `phone.recording_completed` (Zoom Phone — a separate product) or `meeting.ended` (no media URL on the payload).

### 2.2 Payload shape (what we receive)

```json
{
  "event": "recording.completed",
  "event_ts": 1748419800000,
  "payload": {
    "account_id": "AbCdEfG12345",
    "object": {
      "id": 87654321098,
      "uuid": "abc/XYZdef==",
      "host_id": "u_abcdef",
      "topic": "Customer call - 2026-04-27",
      "type": 2,
      "start_time": "2026-04-27T02:00:00Z",
      "timezone": "Asia/Singapore",
      "duration": 47,
      "total_size": 153120832,
      "recording_count": 4,
      "recording_files": [
        {
          "id": "rec_file_1",
          "meeting_id": "abc/XYZdef==",
          "recording_start": "2026-04-27T02:00:11Z",
          "recording_end":   "2026-04-27T02:47:03Z",
          "file_type": "M4A",
          "file_size": 11200000,
          "download_url": "https://zoom.us/rec/download/...",
          "status": "completed",
          "recording_type": "audio_only"
        },
        { "file_type": "MP4", "...": "..." },
        { "file_type": "TRANSCRIPT", "...": "..." },
        { "file_type": "CC", "...": "..." }
      ]
    }
  },
  "download_token": "eyJhbGciOi..."
}
```

**Fields we use:**
- `payload.object.uuid` — canonical recording-set ID. Double-URL-encode if used in REST paths.
- `payload.object.recording_files[].id` — per-asset ID. **This is our dedupe key.**
- Filter `recording_files[]` to `file_type === "M4A"` (audio-only) for transcription. We don't currently need MP4.
- `download_url` — short-lived URL.
- `download_token` (top-level on the envelope) — short-lived bearer; preferred auth for `download_url`.
- `status === "completed"` — required precondition; partial uploads will arrive with other states.

### 2.3 URL validation handshake (`endpoint.url_validation`)

Whenever we click "Validate" in the Zoom Marketplace event subscription page (and any time Zoom rotates verification), Zoom POSTs:

```json
{ "event": "endpoint.url_validation",
  "payload": { "plainToken": "..." } }
```

Respond within **3 seconds** with HMAC-SHA256(plainToken) hex-encoded, keyed by the **Webhook Secret Token** (a separate secret from the Server-to-Server OAuth client secret — they're configured in different places in the Zoom app).

```js
if (req.body.event === 'endpoint.url_validation') {
  const hashForValidate = crypto
    .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(req.body.payload.plainToken)
    .digest('hex');
  return res.status(200).json({
    plainToken: req.body.payload.plainToken,
    encryptedToken: hashForValidate,
  });
}
```

### 2.4 Per-event signature verification

Headers: `x-zm-request-timestamp`, `x-zm-signature`. Canonical message: `v0:{timestamp}:{rawBody}`.

```js
const message  = `v0:${req.headers['x-zm-request-timestamp']}:${rawBody}`;
const expected = 'v0=' + crypto
  .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
  .update(message)
  .digest('hex');
const ok = crypto.timingSafeEqual(
  Buffer.from(expected),
  Buffer.from(req.headers['x-zm-signature']),
);
```

`rawBody` must be the byte-exact request body, not a re-serialised JSON object — preserve raw body in the framework (Express: `express.raw({ type: '*/*' })`; FastAPI: `await request.body()`).

Also reject if `Math.abs(now - timestamp) > 5 minutes` to prevent replay.

### 2.5 Authenticating the media download

Two valid approaches on `download_url`:

1. **Preferred** — pass the per-event `download_token` as `Authorization: Bearer {download_token}`. Token is scoped to that recording set and expires in **24 hours**.
2. **Fallback** — Server-to-Server OAuth `access_token` as `Authorization: Bearer` (or query string `?access_token=…`). Works only if our OAuth app has the recording scope and the host is on the same Zoom account.

The Server-to-Server OAuth dance:

```
POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id={ACCOUNT_ID}
Authorization: Basic base64(client_id:client_secret)
```

Returns `access_token` (Bearer, ~1 h TTL). Required scope: `cloud_recording:read:list_user_recordings:admin` (newer granular scope) **or** the legacy `recording:read:admin`. Add `webhook:read:admin` only if we manage subscriptions via API rather than the Marketplace UI.

> Legacy JWT apps were sunset in 2023. Do **not** build on them.

### 2.6 Streaming the download

`download_url` 302-redirects to a CDN host. Set `Accept: video/mp4` (or audio/m4a), follow redirects, stream — meeting M4As run 5–50 MB, MP4s 100 MB–2 GB. Don't `await response.buffer()`.

### 2.7 Operational notes for Zoom

| Concern | Detail |
| --- | --- |
| Retries | 3× with 3 s timeout, then dropped. **No DLQ.** Always 200 < 3 s. |
| Rate limit | REST is tiered Light/Medium/Heavy. `recordings/list` is Medium (~40 req/s/account, Pro/Business). Webhook delivery itself isn't rate-limited at receiver. |
| Dedupe key | `(provider="zoom", recording_files[].id)`. Optionally also `payload.object.uuid`. |
| Region/data residency | Cloud recordings live in the host account's data-centre region. For HK/SG tenants, the Zoom account must be provisioned in APAC; otherwise media egresses from US-East. |
| Token TTL | `download_token`: 24 h. S2S `access_token`: ~1 h. |

---

## 3. Microsoft Teams (Graph change notifications)

### 3.1 The right primitive

Two valid choices, and they answer different questions:

| Use case | Subscribe to |
| --- | --- |
| "A recording finished and is downloadable" | **`callRecording`** (or `callTranscript` for text only) |
| "A meeting/call ended; CDR/QoS data" | `callRecord` (note the missing 'ing' — different resource) |

For our pipeline, **`callRecording`**. `callRecord` does not contain a recording URL; it's the diagnostic call-detail record.

The Communications Recording bot (calling-bot media access) is the alternative primitive — heavyweight, requires Microsoft-issued ISV certification, and is overkill. Don't go there.

### 3.2 Creating the subscription

For tenant-wide ingestion (admin-installed app):

```
POST https://graph.microsoft.com/v1.0/subscriptions
Content-Type: application/json
Authorization: Bearer {app-only-token}

{
  "changeType": "created",
  "notificationUrl":          "https://hooks.austin-lang.example/teams/recording",
  "lifecycleNotificationUrl": "https://hooks.austin-lang.example/teams/lifecycle",
  "resource": "communications/onlineMeetings/getAllRecordings",
  "includeResourceData": true,
  "encryptionCertificate":   "{base64 X.509 public key}",
  "encryptionCertificateId": "austin-cert-2026-04",
  "expirationDateTime": "2026-04-30T11:00:00Z",
  "clientState": "{32+ char shared secret}"
}
```

Other valid `resource` values:

- `users/{id}/onlineMeetings/getAllRecordings` — per-organiser (max 10 subs/user).
- `communications/onlineMeetings/{onlineMeetingId}/recordings` — per-meeting.
- `appCatalogs/teamsApps/{id}/installedToOnlineMeetings/getAllRecordings` — RSC-friendly, for ISV-style Teams apps.

### 3.3 Permissions (Entra ID app registration)

Application permissions only — delegated isn't supported for `getAllRecordings`. Tenant admin consent required.

| Capability | Permission |
| --- | --- |
| Subscribe to recordings tenant-wide | `OnlineMeetingRecording.Read.All` |
| Subscribe to transcripts tenant-wide | `OnlineMeetingTranscript.Read.All` |
| Subscribe to callRecord (CDR) | `CallRecords.Read.All` |
| Read OnlineMeeting metadata for context | `OnlineMeetings.Read.All` |

Token endpoint (client_credentials):

```
POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
grant_type=client_credentials&client_id=…&client_secret=…&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default
```

### 3.4 Endpoint validation handshake

On subscription **create and renewal**, Graph POSTs:

```
POST {notificationUrl}?validationToken=<opaque>
Content-Type: text/plain; charset=utf-8
```

Respond within **10 seconds**: HTTP 200, `Content-Type: text/plain`, body = the URL-decoded validation token. Don't HTML-escape, don't JSON-encode. Both `notificationUrl` and `lifecycleNotificationUrl` are validated independently.

### 3.5 Notification verification

Two layers:

1. Each delivered batch contains a top-level `validationTokens` array — JWTs signed by Graph. Validate against `https://login.microsoftonline.com/common/discovery/v2.0/keys`, check `aud` = our app ID and `tid` = expected tenant.
2. Always verify the top-level `clientState` equals the secret we supplied at create-time.

If `includeResourceData: true`, the `encryptedContent` block is AES-encrypted resource data plus a per-message AES key wrapped to our X.509 public key. We decrypt the data key with our private key, then AES-decrypt the payload. Cert requirements: 2048-bit RSA, base64-encoded DER, no chain.

### 3.6 Notification payload (with resource data)

```json
{
  "value": [{
    "subscriptionId": "7a62d59e-...",
    "changeType": "created",
    "clientState": "{shared secret}",
    "subscriptionExpirationDateTime": "2026-04-30T11:00:00Z",
    "resource": "users/{organizer-id}/onlineMeetings('Mso...')/recordings('VjI...')",
    "resourceData": {
      "id": "VjI...",
      "@odata.type": "#Microsoft.Graph.callRecording",
      "@odata.id":   "users/{organizer-id}/onlineMeetings('Mso...')/recordings('VjI...')"
    },
    "encryptedContent": {
      "data": "...", "dataKey": "...",
      "encryptionCertificateId": "austin-cert-2026-04",
      "encryptionCertificateThumbprint": "..."
    },
    "tenantId": "..."
  }],
  "validationTokens": ["<jwt>"]
}
```

Decrypted `callRecording` resource:

```json
{
  "id": "VjI...",
  "meetingId": "MSo...",
  "callId": "af630fe0-04d3-4559-8cf9-91fe45e36296",
  "createdDateTime": "2026-04-27T02:47:25Z",
  "endDateTime":     "2026-04-27T02:47:03Z",
  "contentCorrelationId": "bc842d7a-...",
  "recordingContentUrl": "users/{organizer-id}/onlineMeetings/MSo.../recordings/VjI.../content",
  "meetingOrganizer": { "user": { "id": "...", "tenantId": "..." } }
}
```

### 3.7 Streaming the media

```
GET https://graph.microsoft.com/v1.0/{recordingContentUrl}
Authorization: Bearer {app-only-token}
```

Response is the raw MP4 stream. The same `OnlineMeetingRecording.Read.All` we used for the subscription is sufficient for `/content` — no separate SharePoint permissions needed even though recordings physically live in the organiser's OneDrive for Business. Graph proxies through.

### 3.8 Subscription lifecycle (renewal is mandatory)

Maximum `expirationDateTime`:

| Resource | Max lifetime |
| --- | --- |
| `callRecording`  | **4,320 min (3 days)** |
| `callTranscript` | **4,320 min (3 days)** |
| `callRecord`     | **4,230 min (≈3 days)** |

Run a renewal cron at half-life (~36 h):

```
PATCH /v1.0/subscriptions/{id}
{ "expirationDateTime": "2026-05-03T11:00:00Z" }
```

If `expirationDateTime > 1 hour` we **must** also supply `lifecycleNotificationUrl` — Graph rejects the subscription otherwise.

Lifecycle events arrive on `lifecycleNotificationUrl` and require our handler to act:

| `lifecycleEvent` | Action |
| --- | --- |
| `reauthorizationRequired` | `POST /v1.0/subscriptions/{id}/reauthorize` |
| `subscriptionRemoved` | Recreate from scratch |
| `missed` | Backfill with `GET /communications/callRecords?$filter=…` |

Don't issue both reauthorize and PATCH within 10 minutes of each other.

### 3.9 Operational notes for Teams

| Concern | Detail |
| --- | --- |
| Delivery timeout | 3 s default; persistently slow endpoints (>10% slow over 10 min) get throttled, >15% get 10-minute drops. Receiver must respond fast. |
| Latency | `callRecording` average <10 s, max 60 min. `callRecord` is much slower — average <30 min, max 150 min — not a fit for real-time UX. |
| Quotas | 10,000 active Teams subscriptions per tenant, *shared* across recordings + transcripts + chat. `callRecord` is capped at 100/tenant. |
| Region/data residency | Graph honours the tenant's geo (ANZ, APAC, EUR, …). For SG/HK customers on a Microsoft 365 APAC tenant, `recordingContentUrl` resolves to the regional Graph endpoint automatically. |
| Cert rotation | Plan a quarterly rotation. Update `encryptionCertificate` + `encryptionCertificateId` via PATCH; old cert must remain valid until all in-flight notifications drain. |

---

## 4. Handing off to our existing pipeline

Once the worker has the recording bytes, the rest of the flow is unchanged from the human-upload path:

```python
# meeting-recording-worker (FastAPI/httpx pseudocode)
files = {'file': (filename, audio_stream, 'audio/m4a')}
data  = {'domain': 'base', 'language': 'en'}
r = await httpx_client.post(
    f"{TRANSCRIPTION_ORCHESTRATOR_URL}/transcribe/",
    files=files, data=data, timeout=None,
)
r.raise_for_status()
transcript = r.json()
```

Then call the same `registerUploadedFile` server helper that `frontend/src/app/api/upload/route.js` uses to mirror the row into `platform.db` (and stash backend transcript IDs so later edits can co-write to `poc.db`).

Provider context to persist alongside the audio_file row (so the UI can attribute the source):

```sql
ALTER TABLE audio_file ADD COLUMN source_provider   TEXT;   -- 'manual' | 'zoom' | 'teams'
ALTER TABLE audio_file ADD COLUMN source_recording_id TEXT; -- provider-side ID for dedupe
ALTER TABLE audio_file ADD COLUMN source_meeting_id   TEXT; -- for grouping recordings of one meeting
ALTER TABLE audio_file ADD COLUMN source_organiser    TEXT; -- email or AAD id, for ownership mapping
CREATE UNIQUE INDEX ux_audio_file_provider_rec ON audio_file(source_provider, source_recording_id);
```

The unique index doubles as the dedupe gate in step 4 of the worker flow.

---

## 5. Mapping recordings to internal users

Both providers identify the meeting organiser, not necessarily our internal user record:

- **Zoom**: `payload.object.host_id` — Zoom user UUID, plus `host_email` if present.
- **Teams**: `meetingOrganizer.user.id` (AAD object ID) + `tenantId`.

Our `users.db` has `email` as a unique key; map provider-side identity → our `user.id` via:

1. Zoom: look up `host_email` in `users.db.user.email` (low effort, supports BYO Zoom accounts).
2. Teams: optionally also store `azure_object_id` on `user_profile` for direct lookup; fall back to email match.

If the lookup fails, assign to a system "external/unmapped" user and surface in the file list under a "Source: Zoom (unmapped)" badge so admins can re-attribute.

---

## 6. Gotchas to flag in the runbook

1. Zoom's `endpoint.url_validation` handshake reuses the **Webhook Secret Token**, *not* the OAuth client secret. Two different secrets in the Zoom app config; mixing them up is the most common first-day bug.
2. Zoom webhooks are not durable: 3 retries, 3-second timeout each, then dropped. The handler must enqueue and 200 immediately.
3. Teams `callRecord` ≠ recording. Subscribing to `callRecord` only gives call-quality CDRs. Use `callRecording`.
4. Teams subscriptions for `callRecording` max out at **3 days**. A renewal job is mandatory infrastructure, not optional.
5. Teams notifications with resource data require an X.509 cert. To skip cert plumbing in v1, omit `includeResourceData` and do a follow-up GET on `resource` for the metadata + GET `/content` for bytes — costs an extra Graph call per recording but simplifies onboarding.
6. Zoom `download_token` is short-lived (~24 h). If our worker queue backs up beyond that, fall back to S2S OAuth + `recording:read:admin`.
7. Both providers require strict `clientState` / signature checks. Skipping them turns the endpoint into an open relay for forged transcription jobs.
8. Meeting audio is PII — names, internal financial conversations. Persist downloaded media on an encrypted volume; KMS-wrap with per-tenant keys if we keep media post-transcription.

---

## 7. Suggested rollout

1. **Phase 0 — service skeleton**: stand up `meeting-webhook-receiver` with `/zoom/recording` and `/teams/recording` endpoints that only validate signatures and 200. Smoke-test with the Marketplace "Validate" buttons.
2. **Phase 1 — Zoom only**: implement the worker end-to-end against a Zoom dev tenant. Easiest of the two; no cert handling, single secret.
3. **Phase 2 — Teams subscription bootstrap**: app registration in Entra ID, admin consent, subscription create + renewal cron + lifecycle handler. Skip `includeResourceData` (use the resource path follow-up GET pattern).
4. **Phase 3 — Teams resource-data encryption**: add the X.509 cert path, switch to `includeResourceData: true` for lower latency.
5. **Phase 4 — Source attribution UI**: file list badges, organiser → internal user mapping, "unmapped recordings" admin view.

---

## 8. References

**Zoom**

- [Using webhooks](https://developers.zoom.us/docs/api/webhooks/)
- [Meetings event reference](https://developers.zoom.us/docs/api/meetings/events/)
- [Server-to-Server OAuth](https://developers.zoom.us/docs/internal-apps/s2s-oauth/)
- [Webhook sample (canonical signature code)](https://github.com/zoom/webhook-sample)
- [Recording-download blog](https://developers.zoom.us/blog/meeting-api-querying-tips-part4/)

**Microsoft Teams / Graph**

- [Recordings & transcripts change notifications](https://learn.microsoft.com/en-us/graph/teams-changenotifications-callrecording-and-calltranscript)
- [callRecord change notifications](https://learn.microsoft.com/en-us/graph/changenotifications-for-callrecords)
- [Webhook delivery (validation, retries, throttling)](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)
- [Lifecycle events (reauth / missed / removed)](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events)
- [Subscription lifetime + resource table](https://learn.microsoft.com/en-us/graph/change-notifications-overview)
- [callRecording resource schema](https://learn.microsoft.com/en-us/graph/api/resources/callrecording)
- [Rich notifications / payload encryption](https://learn.microsoft.com/en-us/graph/change-notifications-with-resource-data)
