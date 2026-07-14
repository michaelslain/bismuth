# Google Calendar Two-Way Sync

This document covers Bismuth's **two-way Google Calendar sync** — a subsystem that reconciles the events in a Bismuth calendar base (a `type: base` note with a `view: calendar`) against a Google calendar in both directions, so an edit made in the app's calendar lands in Google and an edit made in Google flows back into the vault. It connects via Google's OAuth 2.0 "Authorization Code + PKCE" flow over a loopback redirect, requesting the single `calendar.events` scope (events read+write only — no Gmail, Drive, contacts, or calendar-ACL access). All secrets and sync bookkeeping live **outside the vault** under `~/.bismuth/gcal/` so nothing sensitive is ever committed to git, and the vault's `.settings` carries only non-secret operational config. Reconciliation runs on demand ("Sync now") and on a background ticker; both serialize through an in-process chain and a cross-process file lock so two syncs can never race the shared manifest.

---

## What It Is

The subsystem is the `core/src/gcal/` module set plus a handful of `/gcal/*` HTTP routes and a connect modal:

- **`index.ts`** — in-process orchestration (one instance per core process, like `relay.ts`). Holds the short-lived pending-PKCE map (keyed by the OAuth `state`), an access-token cache, the public surface (`setCredentials` / `startAuth` / `completeAuth` / `status` / `getAccessToken` / `sync` / `disconnect`), and the serialization chain that queues every sync.
- **`pkce.ts` / `oauth.ts`** — the OAuth 2.0 + PKCE flow.
- **`client.ts`** — minimal Google Calendar API v3 calls (list/insert/patch/get/delete + `primaryInfo`).
- **`map.ts` / `recurrence.ts` / `colors.ts`** — pure translation between a Bismuth calendar-base row and a Google event (fields, RRULE, event color).
- **`sync.ts`** — the three-phase reconciliation engine.
- **`state.ts` / `manifest.ts` / `lock.ts`** — external storage under `~/.bismuth/gcal/`.

The Bismuth side of an event is a **row in a calendar base**: `sync.ts` reads the base file with `readNote`, parses it via `parseBaseFile`, mutates row `note` objects, and reassembles + writes it back with `reassemble` + `writeNote`. The synced field set mirrors the calendar view's `eventToRow` keys — `id`, `title`, `date`, `startTime`, `endTime`, `location`, `link`, `description`, `category`, `recurrence`, `localUpdated` (see `buildNote` in `map.ts`).

Headless edits via the **`bismuth calendar …` CLI group** (see `docs/cli/reference.md`) are sync-safe by construction: they preserve event `id`s, stamp `localUpdated` on every create/edit exactly like the app, and never touch the manifest (which lives outside the vault) — the sync engine sees them as ordinary local edits. The flip side: a CLI `calendar delete` propagates to Google on the next sync (Phase C), just like an in-app delete.

---

## OAuth 2.0 + PKCE Loopback Flow

`oauth.ts` implements Google's "Authorization Code + PKCE" flow for a desktop/installed client (RFC 8252). The three Google endpoints are fixed:

- `AUTH_ENDPOINT` — `https://accounts.google.com/o/oauth2/v2/auth`
- `TOKEN_ENDPOINT` — `https://oauth2.googleapis.com/token`
- `REVOKE_ENDPOINT` — `https://oauth2.googleapis.com/revoke`

The single requested scope is `CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"` — read + write to calendar **events only**. Google enforces this server-side: the token grants no access to Gmail, Drive, contacts, or calendar sharing/ACLs.

### PKCE helpers (`pkce.ts`)

Pure + unit-tested, sourcing randomness from the platform CSPRNG (`crypto.getRandomValues`):

- **`createVerifier()`** — a 43-char base64url `code_verifier` (32 random bytes), inside RFC 7636's 43–128 range. Generated per attempt, never persisted.
- **`createState()`** — an opaque CSRF `state` (16 random bytes, base64url); also keys the pending verifier on Bismuth's side.
- **`challengeFromVerifier(verifier)`** — the S256 `code_challenge` = `base64url(SHA-256(verifier))`.

### The flow, step by step

1. **`startAuth(redirectUri)`** (`index.ts`) — reads stored state, throws if no `clientId`, prunes expired pendings, mints a verifier + state + challenge, records `pending.set(state, { verifier, redirectUri, createdAt })`, and returns the consent URL. Pendings expire after `PENDING_TTL_MS` (10 minutes); a flow that never returns simply ages out.
2. **`buildAuthUrl({ clientId, redirectUri, challenge, state })`** (`oauth.ts`) — assembles the consent URL with `response_type=code`, `scope=calendar.events`, `code_challenge` + `code_challenge_method=S256`, `state`, and — crucially — `access_type=offline` + `prompt=consent` so a refresh token is (re-)issued.
3. The frontend opens that URL in the **system browser** (`openExternalUrl`). The `redirect_uri` is a loopback `http://127.0.0.1:<port>/gcal/callback` targeting this backend's own port (Google desktop clients accept any 127.0.0.1 port).
4. Google redirects the browser back to `GET /gcal/callback?code=…&state=…` (a top-level navigation, not a fetch → no CORS).
5. **`completeAuth(code, state)`** — looks up + deletes the pending by `state` (throws "unknown or expired auth state" if absent), then **`exchangeCode({ clientId, clientSecret, code, verifier, redirectUri })`** posts `grant_type=authorization_code` + the PKCE `code_verifier` to the token endpoint. If Google returns **no** `refresh_token`, it throws ("re-consent required"). It caches the access token (`expiresAt = now + expires_in*1000`), then best-effort fetches identity via `primaryInfo` (a 1-item `events.list` on the primary calendar yielding the calendar `summary` ≈ account email + `timeZone` — staying strictly within `calendar.events`, no userinfo scope). Finally it persists `{ refreshToken, account, timeZone, connectedAt }`.

### Token refresh + revoke

- **`getAccessToken()`** returns the cached token while it's more than 60 s from expiry; otherwise it calls **`refreshAccessToken({ clientId, clientSecret, refreshToken })`** (`grant_type=refresh_token`). If Google answers `invalid_grant` (a revoked/expired refresh token never recovers), it clears the cache, calls `clearGcalToken()` to drop the dead token (so `status()` flips to disconnected and the UI prompts a reconnect) and throws a friendly "reconnect Google Calendar" error rather than looping forever on the same opaque failure.
- **`revokeToken(token)`** posts to the revoke endpoint; it is **best effort and never throws**.
- **`disconnect()`** revokes the refresh token (if any), clears the access cache, and wipes both the state file (`clearGcalState`) and the manifest (`clearManifest`).

Both the client secret and refresh token are sent on the token requests, but the PKCE protection means the flow does not rely on the secret for a public native client — the secret is "not truly secret" for an installed client (RFC 8252) but is still treated as a credential and kept outside the vault.

---

## The Three-Phase Sync Engine (`sync.ts`)

`syncEvents(opts)` runs one reconciliation pass in three phases over a single Google `events.list` result.

### Listing: incremental vs. full

If the manifest holds a `syncToken`, the engine asks for **incremental** changes only (changed + deleted events since the token). If the token has expired, `listEvents` throws `SyncTokenExpired` (HTTP 410) → the engine drops the token and does a **full** sync. A full sync uses a window of `now − 90 days` to `now + 365 days`, `showDeleted: true`, and `singleEvents=false` (so recurring **masters** come through, not expanded instances). `listEvents` pages through `nextPageToken` to the end and returns the final `nextSyncToken`, which is persisted to enable the next incremental sync. The page size is 250.

Before reconciling, the engine **binds the manifest to this base**: if `manifest.basePath` was built for a *different* base (the synced calendar was retargeted), it resets `links = {}` and drops the `syncToken` and starts fresh — it must **never** reconcile (and thereby mass-delete via Phase C) one calendar's events against a different base.

### Phase A — Pull (remote → local)

For each remote event:

- **Cancelled** (`status === "cancelled"`): if it's linked, mark the local row for deletion (`deletedLocal++`) and drop the link; otherwise ignore.
- **Unmappable** (`fromGoogle` returns null — see Mapping): `skipped++`.
- **Self-heal**: an *unlinked* event that still carries a `bismuthId` extended property matching an existing local row is a recovered link (manifest lost / crashed mid-sync). It is re-attached at the current state rather than pulled back as a duplicate (`relinked++`).
- **New** (no link, no recoverable `bismuthId`): a fresh local row is created with a `randomUUID()` id (`pulledNew++`); the event is queued to be **stamped** with that id on Google (`toStamp`), so the self-heal can re-link it after a lost manifest.
- **Existing link**: change is detected timestamp-free where possible — `remoteChanged = ev.updated !== link.updated`, `localChanged = sigOfNote(note) !== link.sig`. Only a *genuine conflict* (both changed) consults the policy (`conflicts++`); pure remote changes apply via `applyRemoteToNote` (`pulledUpdate++`); pure local changes are left to Phase B.

`applyRemoteToNote` writes **all** signature-covered fields (title/date/times/location/description/recurrence) and stamps `localUpdated = ev.updated`. `category` is intentionally preserved — Google carries no Bismuth category, so a pull must not blank it — and the stored sig is recomputed from the *written* note so the next sync doesn't mis-read the preserved category or applied recurrence as a fresh local edit.

### Phase B — Push (local → remote)

For each local row (skipping rows already marked for deletion in Phase A):

- **No link** → `insertEvent` with a **deterministic** Google event id (`googleEventId(bid)`) and a `bismuthId` stamp. If the event already exists on Google (lost link / crash), Google answers `409` → `DuplicateId`, which the engine turns into a re-link (`getEvent` + relink, `relinked++`) instead of a duplicate. Otherwise `pushedNew++`.
- **Linked + unchanged** (`sigOfNote === entry.sig`) → skip.
- **Linked + changed** → `patchEvent` guarded by the stored etag (`If-Match`). On `412` (`PreconditionFailed`, remote moved under us) it re-reads with `getEvent`, runs the conflict policy, and either re-patches (local wins → `pushedUpdate++`) or applies the remote (`applyRemoteToNote` → `pulledUpdate++`).

Per-event push errors are caught individually: one malformed event (e.g. a bad recurrence Google rejects) is counted (`failed++`, logged) and the batch continues — the base file and the remaining events still sync.

### Phase C — Delete (local-only → remote)

After collecting the set of currently-present local bismuthIds (existing rows minus Phase-A deletions, plus new rows), the engine walks every manifest link: a link whose `bismuthId` is **no longer present locally** was deleted in Bismuth → `deleteEvent` (etag-guarded) on Google and drop the link (`deletedRemote++`). A `PreconditionFailed` (remote changed) is left for the next sync; any other delete error is counted (`failed++`) without aborting the batch. `deleteEvent` treats `404`/`410` as success (idempotent — already gone).

### Stamping pulled events + persisting

Pulled (Google-created) events queued in `toStamp` are patched with their `bismuthId` extended property (best effort) so the lost-manifest self-heal can re-link them too. Finally the base file is rewritten **only when rows actually changed** (`newRows.length || deleteBids.size || res.pulledUpdate`) — an idle steady-state sync must not rewrite a byte-identical file, which would trip the vault watcher (SSE re-render + git churn) every interval and widen the window to clobber a concurrent in-app edit. The `nextSyncToken` and a `lastSyncAt` ISO stamp are written to the manifest.

`SyncResult` returns the full count set: `total`, `pulledNew`, `pulledUpdate`, `pushedNew`, `pushedUpdate`, `deletedLocal`, `deletedRemote`, `conflicts`, `skipped`, `failed`, `relinked`. The frontend's `summarizeSync` condenses these into a toast like `Synced — 3 in, 1 out, 2 removed, 1 conflict`.

### Conflict policies

`resolveConflict(policy, localUpdated, remoteUpdated)` in `sync.ts` (type `ConflictPolicy = "lastWriteWins" | "googleWins" | "bismuthWins"`):

- **`googleWins`** → always `"remote"`.
- **`bismuthWins`** → always `"local"`.
- **`lastWriteWins`** (default) → compares the row's `localUpdated` ISO stamp against the remote `updated` time; the **newer** wins (ISO/UTC strings sort chronologically). If the local row has no `localUpdated` stamp, it keeps **local** rather than silently discarding it.

---

## Mapping a Google Event ↔ a Bismuth Row (`map.ts`)

`fromGoogle(ev)` maps a Google event to row fields or returns **null to skip**. It skips: cancelled events; modified per-instance exceptions of a series (`recurringEventId` set — only clean masters are kept); recurring masters whose RRULE can't be represented; undated events; multi-day all-day events (exclusive `end.date` beyond the day after start, which Bismuth's single-`date` model can't hold); and overnight timed events (end on a later calendar day). There is **no timezone math** on a timed event — the `dateTime` string already carries the wall-clock time Google displays, so the date + `HH:MM` parts are taken verbatim, matching Bismuth's naive-local model.

`toGoogle(fields, timeZone, colorMap)` builds the insert/patch body (`summary`, `location`, `description`, `start`/`end`, optional `recurrence`, optional `colorId`). For a recurring event the start is anchored on `firstOccurrence` (the first valid weekday on/after the start) so Google's DTSTART can't surface the event on the wrong weekday. All-day events use `start.date` + an **exclusive** `end.date` of `nextDay()`.

`googleEventId(bismuthId)` derives a **deterministic, valid** Google event id (base32hex: `a`–`v` + `0`–`9`, length 5–1024) from a row id — making inserts idempotent (a re-insert hits Google's 409 instead of duplicating). UUIDs are already hex (a subset of base32hex) once hyphens are stripped; anything else falls back to a SHA-1 hex digest.

`signature(m)` is the stable content signature (title, date, start/end, location, description, recurrence-sans-seriesId, category) used for local-change detection.

---

## Recurrence (`recurrence.ts`)

The model is `BismuthRecurrence = { type, daysOfWeek?, startDate, endDate?, seriesId }` where `type` is `"daily" | "weekly" | "biweekly" | "monthly"`. `seriesId` is a *local* grouping id, **not** synced content — it's excluded from the change-detection signature (`recurrenceSignature`).

**`buildRRule(rec, allDay, timeZone)`** emits a single `RRULE:`:

- `daily` → `FREQ=DAILY`; `monthly` → `FREQ=MONTHLY`.
- `weekly` → `FREQ=WEEKLY`; `biweekly` → `FREQ=WEEKLY;INTERVAL=2`.
- A weekday set adds `BYDAY=` (e.g. `BYDAY=MO,WE,FR`, sorted; codes `SU MO TU WE TH FR SA`).
- An `endDate` adds `UNTIL=`: the compact `YYYYMMDD` for all-day, or for timed series the instant **23:59:59 local** on `endDate` expressed in UTC (`timedUntil` shifts by the tz's offset so the last occurrence isn't dropped west of UTC).

**`parseRRule(recurrence, startDate, seriesId)`** parses a Google `recurrence` array back to a `BismuthRecurrence`, returning **null (→ skip the event)** for anything unsupported:

- any `RDATE` or `EXDATE` entry → null;
- not exactly one `RRULE:` (multi-rule) → null;
- a `COUNT` field → null;
- `FREQ` other than `DAILY`/`MONTHLY`/`WEEKLY` (e.g. `YEARLY`) → null;
- any `INTERVAL` other than `1`, except `FREQ=WEEKLY;INTERVAL=2` (→ biweekly) → null.

A supported rule reads `BYDAY` into `daysOfWeek` and `UNTIL` (first 8 digits, `YYYYMMDD`) into `endDate`.

---

## Color Mapping (`colors.ts`)

A Bismuth category color is a **theme token** (`accent`/`teal`/`blue`/`violet`/`green`/`gold`/`rose`) or a custom hex. `categoryColorId(color, theme)` resolves it to one of **Google's 11 event colors** (`colorId` 1–11):

- `accent` → the active theme's `--accent` hex (`THEME_ACCENT[theme]`, default `oxide-duotone`), then snap to nearest.
- a fixed swatch token → its hex (`SWATCH_HEX`), then snap.
- a hex → passthrough, then snap.

"Snap" is `nearestGoogleColorId`: parse the hex to RGB and pick the Google event color with the smallest squared-RGB distance. `colorId` is just an event field, so this works entirely within the `calendar.events` scope. In `sync.ts`, the base file's `categories` frontmatter (`{ name, color }` entries) is turned into a `categoryName → colorId` map (`categoryColorMap`) and applied to pushed events via `toGoogle`.

---

## Storage — Everything Outside the Vault (`~/.bismuth/gcal/`)

All durable state lives under `~/.bismuth/gcal/`, created with `0700` perms, so nothing sensitive enters the vault or git:

- **`state.json`** (`state.ts`, file mode **`0600`**, re-asserted with `chmodSync` on overwrite) — `GcalState`: `clientId`, `clientSecret`, `refreshToken`, `account`, `timeZone`, `connectedAt`. Reads never throw (a missing/corrupt file degrades to `{}`). `writeGcalState` merges a patch; `clearGcalState` deletes the file (disconnect); `clearGcalToken` drops only the token + identity but **keeps the client credentials**, so a reconnect only needs re-consent, not re-entering the id/secret.
- **`sync.json`** (`manifest.ts`, mode `0600`) — the `SyncManifest`: `lastSyncAt`, `syncToken`, `basePath` (the base the manifest is bound to — the retarget guard), and `links` keyed by Google event id → `{ bismuthId, etag, updated, sig }`. Kept here, not as columns on the rows, because the frontend calendar serializer only re-emits known event fields and would drop extra sync columns on the next in-app edit. Reads never throw.
- **`sync.lock`** (`lock.ts`) — a cross-process advisory lock so the dev server and the bundled app can never sync the shared manifest concurrently (interleaved syncs could strand links or double-insert). `withSyncLock` acquires it atomically via `openSync(path, "wx")` (O_CREAT|O_EXCL), throwing `SyncLocked` if another process holds a non-stale lock; a lock older than `STALE_MS` (15 minutes — generous so a slow sync is never stolen) is reclaimed.

### The manifest links map + bismuthId self-heal

The manifest's `links` map is the durable bridge between the two systems. Each event is additionally **stamped** on Google with a `bismuthId` private extended property (`BID_PROP = "bismuthId"`). This makes the system self-healing: if the manifest is ever lost or a sync crashes mid-flight, an unlinked Google event whose `bismuthId` matches an existing local row is re-attached rather than re-pulled as a duplicate (Phase A self-heal), and a local insert that 409s on its deterministic id is re-linked rather than duplicated (Phase B). Both Bismuth-pushed events (stamped on insert) and Google-pulled events (stamped via the `toStamp` post-pass) carry the stamp, so the self-heal covers events created on either side.

---

## HTTP Endpoints (`core/src/server.ts`)

Because the OAuth plumbing and secrets live outside the vault, the read-only `/gcal/*` routes are **SYSTEM actions, not vault mutations** — like the `/daemon/*` routes they live in the GET/read table (no cache-invalidate). Only the sync route is a vault mutation.

| Method + path | Behavior |
| --- | --- |
| `GET /gcal/status` | `ok(gcalStatus())` → `{ connected, needsCredentials, account?, timeZone?, connectedAt? }`. `connected = Boolean(refreshToken)`; `needsCredentials = !clientId || !clientSecret`. |
| `POST /gcal/credentials` | `{ clientId, clientSecret }` → `setCredentials` (stored outside the vault). `400` if either is missing. |
| `POST /gcal/auth/start` | Builds `redirectUri = http://127.0.0.1:<server.port>/gcal/callback`, returns `{ url }` (the consent URL). `400` on error (e.g. missing client id). |
| `GET /gcal/callback` | The loopback redirect target. Reads `error` / `code` / `state` from the query; on success calls `completeAuth` and renders a small self-contained **HTML page** (`gcalCallbackHtml`, message escaped) telling the user they can close the tab. |
| `POST /gcal/disconnect` | `await disconnect()` → revoke + wipe state + manifest. |
| `POST /gcal/sync` | A **vault mutation** (`mutatingHandler`): reconciles both directions and returns the `SyncResult`. Its `pathOf` returns `googleCalendar.basePath` → cache-invalidate + SSE re-render of the open calendar. Body may carry an explicit `{ basePath }` (the per-calendar modal does) to target a calendar immediately without waiting for the debounced settings write to round-trip into `appConfig`. `400` if no base path is set or on sync error. |

Sync arguments are derived in one place by `gcalSyncArgs(appConfig, basePathOverride?)`: `basePath` (override or `gc.basePath`), `calendarId` (default `"primary"`), `policy` (default `"lastWriteWins"`), `timeZone` (`gc.timeZone`), and `theme` (`appearance.theme`, for resolving the `accent` category color). The frontend client methods are `gcalStatus`, `gcalSetCredentials`, `gcalAuthStart`, `gcalDisconnect`, and `gcalSync` (`app/src/api.ts`), driven by `GcalConnectModal.tsx` (which after starting auth polls `GET /gcal/status` every 1.5 s for up to 3 minutes until the loopback callback completes on the backend).

---

## `googleCalendar` Settings Keys (`core/src/schema/settingsSchema.ts`)

The vault's `.settings` file holds only **non-secret** operational config (every secret stays in `~/.bismuth/gcal/state.json`):

| Key | Type / default | Meaning |
| --- | --- | --- |
| `enabled` | boolean, `false` | Enable two-way Google Calendar sync (gates the auto-sync ticker). |
| `calendarId` | string, `"primary"` | Which Google calendar to sync with (`primary` = your main calendar). |
| `basePath` | string, `""` | Vault path to the calendar base (a `type: base` note with `view: calendar`) to sync. |
| `conflictPolicy` | enum `lastWriteWins`/`googleWins`/`bismuthWins`, default `lastWriteWins` | How to resolve an event changed on **both** sides since the last sync. |
| `syncIntervalMinutes` | number, `15` (min 1, max 1440) | Auto-sync cadence in minutes (manual "Sync now" is always available). |
| `timeZone` | string, `""` | IANA timezone applied to naive (untimed) events when pushing to Google (blank = system timezone). |

When `timeZone` is blank, `index.ts`'s `sync()` resolves the effective zone as: the `timeZone` setting → the stored `state.timeZone` captured at connect → the system zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) → `"UTC"`.

---

## Serialization & the 60s Auto-Sync Ticker

Two layers of serialization keep syncs from racing:

- **In-process chain** (`index.ts`) — every `sync()` call queues behind the previous one via a `syncChain` promise (`syncChain.then(run, run)`), so a manual "Sync now" and the background ticker never interleave reads/writes of the base file + manifest. A failed sync is caught so it doesn't break the chain.
- **Cross-process lock** (`lock.ts`) — each run executes inside `withSyncLock`, so two backends can't touch the shared manifest at once.

The **auto-sync ticker** is a `setInterval(…, 60_000)` in `server.ts`, **`.unref()`'d** so it never keeps the process alive. Every 60 seconds it checks: is `googleCalendar.enabled` set, is a `basePath` configured, is a sync not already running, and is `gcalStatus().connected`? If so, and at least `max(1, syncIntervalMinutes || 15) × 60_000` ms have elapsed since the last run (`gcalAutoSyncAt`), it fires a sync with the `gcalSyncArgs(appConfig)` derived config. The run is guarded by `gcalAutoSyncRunning` (no overlap), errors are caught and logged (`[gcal] auto-sync failed: …`), and the base-file write it produces is picked up by the vault watcher (cache-invalidate + SSE) so the open calendar refreshes. The ticker is a no-op in tests because `googleCalendar.enabled` defaults to `false`. Note the 60 s tick is the *poll* interval; the *effective* cadence is `syncIntervalMinutes` (the ticker simply checks each minute whether enough time has passed).

---

Source: `core/src/gcal/index.ts`, `core/src/gcal/oauth.ts`, `core/src/gcal/pkce.ts`, `core/src/gcal/sync.ts`, `core/src/gcal/client.ts`, `core/src/gcal/state.ts`, `core/src/gcal/lock.ts`, `core/src/gcal/manifest.ts`, `core/src/gcal/map.ts`, `core/src/gcal/recurrence.ts`, `core/src/gcal/colors.ts`, `core/src/server.ts` (the `/gcal/*` routes + auto-sync ticker), `core/src/schema/settingsSchema.ts` (`googleCalendar`), `core/src/settings.ts` (`.settings` — the live vault settings file), `app/src/GcalConnectModal.tsx`, `app/src/api.ts` (`gcal*` methods).
