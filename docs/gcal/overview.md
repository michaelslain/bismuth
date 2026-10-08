# Google Calendar sync

Bismuth syncs a calendar base with a Google calendar in both directions: an event you edit in the app lands in Google, and an event you edit in Google flows back into the vault. Sync is per calendar, so one vault can hold several calendar bases, each linked to a different Google calendar. Sync needs a Google account connection and one switch on each calendar base; the events and recurrence rules being synced are described in [calendar events](../calendar/overview.md).

Two frontmatter keys on the calendar base switch sync on and pick the Google calendar:

```yaml
---
type: base
view: calendar
googleCalendarSync: true
googleCalendarId: primary
---
```

`primary` is your main Google calendar. The account connection is shared by the whole machine; only these two keys are per calendar.

## What do I need before I connect?

You need a Google OAuth client of type Desktop app, which you create in Google Cloud Console with the Google Calendar API enabled for its project. Bismuth does not ship a client of its own, so the connect dialog asks for the client ID and client secret. It requests one permission, the `calendar.events` scope: read and write events only, with no access to Gmail, Drive, contacts or calendar sharing.

Sync runs in the installed Bismuth app. A development build, a test run or a headless core refuses to connect, sync or disconnect (HTTP `403`) unless it starts with `BISMUTH_GCAL_AUTOSYNC=1`. The refusal exists because the Google connection belongs to the machine, and a core running on a copy of your vault could otherwise delete real events; see [Why do some cores refuse to sync?](#why-do-some-cores-refuse-to-sync).

## How do I connect and turn on sync?

Connect from the calendar you want to sync.

1. Open the calendar base and open its settings with the gear in the view bar.
2. In the **google calendar sync** section, choose **connect google calendar**.
3. Paste the client ID and client secret and choose **sign in with google**. Bismuth opens Google's consent page in your system browser.
4. Approve access. The browser shows "Connected as <account>. You can close this tab and return to Bismuth."
5. Return to Bismuth. The connect dialog notices the connection and turns sync on for the calendar you opened it from.

Afterwards the same section shows the connected account and these controls.

| Control | Effect |
|---|---|
| sync this calendar with google | sets `googleCalendarSync` on the base |
| google calendar | sets `googleCalendarId`; empty means `primary` |
| on a conflict | picks the conflict policy (see below) |
| sync now | runs one sync for this calendar and shows a toast like `Synced — 3 in, 1 out, 2 removed, 1 conflict` |

To sync a calendar other than your main one, paste its ID into **google calendar**. Find the ID in Google Calendar under Settings, Integrate calendar, Calendar ID. Changing the ID points the calendar at a different Google calendar: Bismuth drops its stored links to the old one, leaves the old calendar's events untouched, and does a full sync against the new one.

To disconnect, use **disconnect** in the same section or the Disconnect Google Calendar command. Disconnecting revokes the token and erases the stored client credentials and every sync link; reconnecting asks for the client ID and secret again.

## When does a sync run?

A sync runs when you press **sync now** and automatically in the background while the app is open and connected. The background cadence is `googleCalendar.syncIntervalMinutes` (default 15 minutes), and it syncs every calendar base that has `googleCalendarSync: true`. Syncs never overlap: a manual sync waits behind a running one.

## What happens when both sides changed the same event?

Bismuth compares each event with its state at the last sync. If only one side changed, that change wins. If both changed, `googleCalendar.conflictPolicy` decides.

| Policy | Label in the panel | Winner |
|---|---|---|
| `lastWriteWins` (default) | most recent edit wins | the newer of the row's `localUpdated` and Google's `updated`; a row with no `localUpdated` keeps the local version |
| `googleWins` | google wins | Google |
| `bismuthWins` | this calendar wins | the base |

The policy is global to the connection and applies to every synced calendar.

## What syncs and what is skipped?

An event syncs through these fields.

| Bismuth field | Google field |
|---|---|
| `title` | summary |
| `date`, `startTime`, `endTime` | start and end; no `startTime` means all-day |
| `location`, `description` | location, description |
| `recurrence` | a single `RRULE` |
| `category` | the event colour (nearest of Google's 11 event colours) |

The `link` field and a multi-category `categories` list do not sync. A pulled event arrives with no category, because Google carries none, and a later pull never blanks a category you set. Times are wall-clock times with no conversion; `googleCalendar.timeZone` is only the zone sent with a pushed timed event. A timed event with no `endTime` is pushed with its end equal to its start.

A Google event is skipped on pull, silently except for the `skipped` count, when it is:

- cancelled, or a modified single instance of a repeating series;
- a repeating series Bismuth cannot represent (below);
- missing a start date;
- an all-day event that spans several days;
- a timed event that ends on a later day.

An event you cannot find in Bismuth after a sync is usually one of these.

Repeating events map to a subset of iCalendar rules. A series syncs only if it uses `FREQ=DAILY`, `FREQ=WEEKLY` or `FREQ=MONTHLY`, an `INTERVAL` of 1 (or 2 with weekly, which is a biweekly series), and optionally `BYDAY` and `UNTIL`. A series with `COUNT`, `YEARLY`, `RDATE`, `EXDATE`, another interval or several rules is skipped entirely.

## What can go wrong?

- **Deleting a row deletes the event in Google.** A synced event removed from the base file, by you, by the CLI, or by replacing the file with one that lacks it, is deleted from Google on the next sync. Delete in either place on purpose.
- **A deleted event in Google deletes the row.** A cancelled Google event removes the linked row on the next pull.
- **The Sync Google Calendar palette command names no calendar.** It only works when `googleCalendar.basePath` names a base; otherwise it fails with "no calendar base to sync". Use **sync now** in the calendar's settings, or `bismuth gcal sync <basePath>`.
- **A revoked or expired Google grant needs a reconnect.** Bismuth reports "Google access was revoked or expired — reconnect Google Calendar", clears the dead token and keeps your client credentials, so reconnecting needs only consent.
- **One bad event does not stop a sync.** An event Google rejects, such as a malformed recurrence, is counted as `failed` and logged, and the rest still sync.
- **An unchanged calendar is not rewritten.** The base file is written only when a pull changed rows, so an idle sync does not touch the file.
- **Another process holds the sync lock.** Two cores never sync at once. A sync that finds a fresh lock fails; a lock older than 15 minutes is taken over.

## Why do some cores refuse to sync?

Connecting, syncing and disconnecting answer `403` outside the installed app. The Google refresh token, the client credentials and the sync links live once per machine under `~/.bismuth/gcal/`, and a sync deletes from Google every linked event missing from the base it reads. A development or agent core pointed at a copy of the vault could therefore delete real events, or revoke the real token on disconnect.

Setting `BISMUTH_GCAL_AUTOSYNC=1` on a core opts it in to connect, sync, disconnect and the background ticker together. Set `BISMUTH_GCAL_DIR` as well to point it at a different state directory, so an opted-in test core does not touch your real connection. `GET /gcal/status` always works.

## How do I use Google sync from the shell?

The `bismuth gcal` commands wrap the same routes; the first four need a running core.

| Command | Does |
|---|---|
| `gcal status` | reports `connected`, `needsCredentials`, `account`, `timeZone`, `connectedAt` |
| `gcal connect [--client-id I --client-secret S]` | stores credentials if given and prints the consent URL; a person must finish sign-in in a browser |
| `gcal sync <basePath>` | syncs one calendar now and prints the counts |
| `gcal disconnect` | revokes the token and wipes local sync state |
| `gcal targets` | lists calendar bases with sync enabled; reads the vault directly |
| `gcal health --vault <dir> [<basePath>]` | reports last sync time, linked-event count and calendar ID per base; read-only |

`gcal sync` returns these counts: `total`, `pulledNew`, `pulledUpdate`, `pushedNew`, `pushedUpdate`, `deletedLocal`, `deletedRemote`, `conflicts`, `skipped`, `failed`, `relinked`. `gcal health` omits conflicts because they are not stored, and without a `<basePath>` it lists only the entries for the vault you name. Flags for every command are in the [CLI reference](../cli/reference.md).

Edits made with `bismuth calendar` are safe on a synced calendar: they keep event ids and stamp `localUpdated`, so the next sync sees them as ordinary local edits. See [calendar events](../calendar/overview.md#how-do-i-edit-a-calendar-from-the-shell).

## Which settings control sync?

Per calendar, on the base's frontmatter:

| Key | Type | Default | Effect |
|---|---|---|---|
| `googleCalendarSync` | boolean | off | turns two-way sync on for this base |
| `googleCalendarId` | string | `primary` | the Google calendar to sync with |

Connection-wide, under `googleCalendar` in `.settings`:

| Key | Type | Default | Effect |
|---|---|---|---|
| `conflictPolicy` | `lastWriteWins`, `googleWins`, `bismuthWins` | `lastWriteWins` | winner when both sides changed |
| `syncIntervalMinutes` | number, 1 to 1440 | 15 | background sync cadence |
| `timeZone` | IANA zone string | empty | zone sent with pushed timed events; empty uses the zone captured at connect, then the system zone, then UTC |
| `enabled`, `calendarId`, `basePath` | boolean, string, string | `false`, `primary`, empty | a single-calendar fallback: the base named by `basePath` syncs with these values when it has no `googleCalendarSync` key of its own |

The full list of `.settings` keys is in the [settings reference](../settings/reference.md).

## How it works

The sync code is `core/src/gcal/`, a few `/gcal/*` routes, and the connect dialog and sync panel in the app.

### OAuth

`oauth.ts` runs Authorization Code with PKCE over a loopback redirect, as RFC 8252 describes for installed apps. `startAuth` creates a code verifier, a state value and an S256 challenge, remembers them for 10 minutes keyed by the state, and returns Google's consent URL with `access_type=offline` and `prompt=consent` so Google issues a refresh token. The redirect URI is `http://127.0.0.1:<core port>/gcal/callback`.

`GET /gcal/callback` calls `completeAuth`, which exchanges the code, refuses a response with no refresh token, reads the account name and time zone from a one-item event list on the primary calendar (keeping to the `calendar.events` scope), and stores the result. `getAccessToken` caches the access token until 60 seconds before expiry and refreshes it with the refresh token; an `invalid_grant` reply drops the token and asks for a reconnect.

### Where state lives

Everything durable sits outside the vault in `~/.bismuth/gcal/`, or the directory named by `BISMUTH_GCAL_DIR`. The directory is mode `0700`.

| File | Contents |
|---|---|
| `state.json` (mode `0600`) | client ID and secret, refresh token, account, time zone, connect time |
| `sync.json` (mode `0600`) | per calendar: last sync time, Google calendar ID, sync token, and links from a Google event ID to `{bismuthId, etag, updated, sig}` |
| `sync.lock` | a cross-process advisory lock taken with an exclusive create |

The manifest key is `<realpath of the vault>::<base path>`, so a copy of a vault gets its own empty entry and never shares links with the original. An entry written before keys were namespaced is claimed, by moving it to the namespaced key, only when `BISMUTH_APP_PATH` is set, which the installed app's sidecar does. The links are kept out of the base file because the calendar serializer re-emits only known event fields and would drop extra columns on the next in-app edit.

### The sync engine

`syncEvents` in `sync.ts` reconciles one calendar base in three phases over one Google event listing. With a stored sync token it asks for changes only; if Google answers `410` it drops the token and does a full listing of the window from 90 days back to 365 days ahead, with deleted events included and repeating series left unexpanded. Pages are 250 events.

| Phase | Does |
|---|---|
| A, pull | cancelled linked events delete their rows; unmappable events count as skipped; unlinked events carrying a known `bismuthId` re-link; new events become rows with a fresh UUID; linked events apply the remote change, or the conflict policy if both sides changed |
| B, push | rows with no link are inserted with a deterministic Google ID; rows whose content signature changed are patched with the stored etag, and a `412` re-reads the event and applies the policy |
| C, delete | links whose row is missing from the base delete the Google event; a `404` or `410` counts as success |

Change detection is timestamp-free where possible: a remote change is `updated` differing from the stored value, and a local change is the row's content signature differing from the stored `sig`. The signature covers title, date, times, location, description, recurrence without its `seriesId`, and category.

Inserts use `googleEventId(bismuthId)`, a base32hex ID derived from the row ID, so a repeated insert hits Google's `409 duplicate` and re-links instead of duplicating. Every event also carries a private `bismuthId` extended property, so a lost manifest self-heals by re-attaching events in phase A.

A push error on one event is caught per event, counted in `failed`, and the batch continues. `buildRRule` and `parseRRule` in `recurrence.ts` translate recurrence; an `UNTIL` for a timed series is 23:59:59 local on the end date, expressed in UTC. `colors.ts` snaps a category colour (a palette token resolved against the active theme, or a hex) to the nearest of Google's 11 event colours by squared RGB distance.

### Serialization and the ticker

Within a process, `index.ts` queues every `sync` behind the previous one, and each run takes the cross-process lock `withSyncLock`. The background ticker in `server.ts` runs every 60 seconds (override with `BISMUTH_GCAL_TICK_MS`), and only when `gcalAutoSyncEnabled()` is true, meaning `BISMUTH_APP_PATH` is set or `BISMUTH_GCAL_AUTOSYNC` is `1`. On each tick, if connected and `syncIntervalMinutes` has passed, it lists targets with `listGcalSyncTargets` and syncs each in turn, logging per-calendar failures. The interval handle is cleared by the server's `stop()` and `Symbol.dispose`.

### Routes

| Route | Effect |
|---|---|
| `GET /gcal/status` | `{connected, needsCredentials, account?, timeZone?, connectedAt?}`; always open |
| `POST /gcal/credentials` | stores `{clientId, clientSecret}` outside the vault |
| `POST /gcal/auth/start` | returns the consent URL as `{url}` |
| `GET /gcal/callback` | completes sign-in and renders a small HTML page |
| `POST /gcal/disconnect` | revokes the token and wipes state and manifest |
| `POST /gcal/sync` | syncs the base named by `basePath` in the body; a vault mutation that invalidates caches for that file |

All but status answer `403` through `onlyWhenGcalEnabled` when the core is not allowed to use Google. `POST /gcal/sync` returns `404` for a missing base and `400` when no base is named or the sync fails. Shapes are in the [HTTP API reference](../api/http-reference.md). In the app, `GcalConnectModal.tsx` polls `GET /gcal/status` every 1.5 seconds for up to 3 minutes while sign-in completes, and `GcalSyncPanel.tsx` writes the per-calendar keys through `POST /set-property`.

Source: `core/src/gcal/index.ts`, `core/src/gcal/oauth.ts`, `core/src/gcal/pkce.ts`, `core/src/gcal/sync.ts`, `core/src/gcal/client.ts`, `core/src/gcal/map.ts`, `core/src/gcal/recurrence.ts`, `core/src/gcal/colors.ts`, `core/src/gcal/config.ts`, `core/src/gcal/discover.ts`, `core/src/gcal/state.ts`, `core/src/gcal/manifest.ts`, `core/src/gcal/lock.ts`, `core/src/routes/gcal.ts`, `core/src/server.ts`, `core/src/schema/settingsSchema.ts`, `app/src/GcalConnectModal.tsx`, `app/src/calendar/components/GcalSyncPanel.tsx`, `cli/src/commands/gcal.ts`
