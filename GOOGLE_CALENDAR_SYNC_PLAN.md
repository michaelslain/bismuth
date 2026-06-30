# Two‑Way Google Calendar Sync — Implementation Plan & Research

Branch: `google-calendar-sync` · Status: **plan (pre‑implementation)** · Last updated: 2026‑06‑23

This document is the research‑backed plan for syncing Bismuth's calendar with Google
Calendar **both ways**, while requesting **only calendar access** (no Gmail/Drive/contacts).
Every external claim below was verified against Google's primary developer docs / IETF RFCs
by a fan‑out of research agents (5 of 6 make‑or‑break facts **confirmed**, 1 **partly** — see
§9 Verification ledger). Codebase claims are anchored to real files.

---

## 0. TL;DR

- **Auth:** OAuth 2.0 **Authorization Code + PKCE** (S256), Google "Desktop app" client,
  **loopback `http://127.0.0.1:<port>` redirect**. OOB and custom URI schemes are dead for
  Google desktop clients — loopback is the only supported path.
- **Privacy (your core requirement) is fully satisfiable:** request the single scope
  `https://www.googleapis.com/auth/calendar.events` ("View and edit events on all your
  calendars"). It grants **read+write to events only** and **cannot** touch Gmail, Drive,
  contacts, or calendar sharing/ACLs — enforced server‑side by Google, not a promise.
- **Where it runs:** the **Bun core sidecar already runs an HTTP server** → it hosts the
  OAuth loopback callback, does the token exchange, and runs the sync engine. Tauri only
  opens the system browser (`tauri-plugin-opener`, already a dependency).
- **Secrets never touch the vault.** Refresh token → OS keychain (`keyring` crate) or, for
  MVP, an app‑config file with `0600` perms. `settings.yaml` lives in the (git‑committed)
  vault, so it holds only **non‑secret** config.
- **Conflict policy:** **last‑write‑wins** (your choice), implemented with Google's **etag /
  `If-Match`** as the safe‑write primitive and the event `updated` timestamp as the LWW tie‑breaker.
- **Biggest gotcha to decide up front:** while the Google OAuth app is in **"Testing"**
  publishing status, **refresh tokens expire after 7 days** → silent weekly re‑auth. Fix =
  publish the project to **"Production"** (one verification review, ~10 days, **no** security
  assessment for this scope). See §7.

---

## 1. What Bismuth's calendar actually is (codebase reality)

> This was the linchpin question. It is **not** what you'd guess from "calendar."

A calendar is a **Bases view** over a `type: base` markdown file. **Events are YAML rows in the
body of one `.md` file** — *not* one note per event, not ICS, not frontmatter‑per‑event.

```
---                      ← frontmatter: type: base, view config, categories[]
type: base
views: [{ type: calendar, dateField: date, startTimeField: startTime, ... }]
categories: [{ name: Work, color: "#..." }]
---
- id: 9f8c…                ← one event = one row
  title: Standup
  date: "2026-06-24"       ← naive local date (YYYY-MM-DD), NO timezone
  startTime: "09:30"       ← naive local time (HH:MM), omit ⇒ all-day
  endTime: "10:00"
  category: Work
  recurrence: '{"type":"weekly","daysOfWeek":[1,3],"startDate":"…","seriesId":"…"}'
- id: …
  title: …
```

### Event data model (`app/src/calendar/types.ts`, `app/src/bases/calendarSerialize.ts`)
| Field | Type | Notes |
|---|---|---|
| `id` | string | `crypto.randomUUID()` at creation; stable across edits/reloads |
| `title` | string | required |
| `date` | `YYYY-MM-DD` | **local, no tz** (`parseLocalDate` = `date + "T00:00:00"`) |
| `startTime`/`endTime` | `HH:MM` 24h | omit `startTime` ⇒ all‑day |
| `location`, `link`, `description` | string | optional; description is markdown |
| `category` | string | name → color resolved from frontmatter `categories[]` |
| `recurrence` | JSON string | **custom object, not RRULE** (see below) |

**Recurrence** (`Recurrence` type): `{ type: 'daily'|'weekly'|'biweekly'|'monthly',
daysOfWeek?: number[] (0=Sun), startDate, endDate?, seriesId }`. Recurring events are stored as
a **single master row**; the UI **expands them day‑by‑day on read** (`app/src/calendar/dates.ts`
`expandRecurrence`/`matchesRecurrence`). Editing "this / following / all" occurrences **splits
the series into segments** that share a `seriesId` (`RecurrenceDialog.tsx` →
`EventStore.editOccurrence/editFollowing/editSeries`).

### CRUD & persistence paths
- **Frontend store:** `app/src/calendar/EventStore.ts` (`addEvent`/`updateEvent`/`deleteEvent`
  + recurrence split logic) → `app/src/bases/calendarBase.ts` `save()` →
  `api.write(path, text)` → **`PUT /file`** (rewrites the **whole** base file).
- **Read:** `CalendarView.tsx` onMount → `api.read(path)` (**`GET /file`**) → parse YAML rows →
  `store.getEventsForRange()` filters + expands recurrence → render.
- **Backend row layer (alt. path, used by other base views):** `core/src/bases/rowOps.ts`
  `upsertRow`/`deleteRow` (frontmatter‑preserving) behind **`POST /row/update`** /
  **`POST /row/delete`** (both `mutatingHandler` → cache‑invalidate + SSE). `POST /rows`
  resolves a `SourceSpec` → `Row[]` (read).

### Two facts that drive the whole sync design
1. **No timezone anywhere.** Bismuth events are naive local; Google events are tz‑aware. The
   sync **must** introduce a timezone (the user's IANA zone) at the boundary. See §4.2.
2. **No external‑id fields exist yet** (no `gcalId`/`etag`/`lastSynced`). YAML rows are open
   objects → we **add columns freely** without touching existing behavior. See §3.

**Key files:** `app/src/calendar/{EventStore,types,dates,state,refresh}.ts`,
`app/src/calendar/components/{EventModal,RecurrenceDialog}.tsx`,
`app/src/bases/{calendarSerialize,calendarBase,CalendarView}.tsx`,
`core/src/bases/{rowOps,rows,types,parse,source}.ts`, `core/src/{basesData,frontmatter,files}.ts`.

---

## 2. Where the code lives (backend / settings / Tauri)

### Backend (`core/`, Bun)
- **New module `core/src/gcal/`** is the home for the integration:
  - `oauth.ts` — PKCE (verifier/challenge S256 via Bun `crypto`), auth‑URL builder, code↔token
    exchange, refresh, state validation.
  - `client.ts` — thin Google Calendar API v3 client (`events.list/insert/patch/delete`,
    sync‑token handling, etag/`If-Match`, backoff).
  - `map.ts` — pure `CalendarEvent ⇆ Google Event` mapping (tz, all‑day, recurrence↔RRULE).
  - `sync.ts` — the two‑way LWW engine (pull/push/reconcile/deletions).
  - `state.ts` — non‑vault persistence of tokens + `syncToken` + `lastSyncAt` + the known‑id
    manifest (see §5.4).
- **New endpoints in `core/src/server.ts`** (recipe verified against the route tables):
  | Method+path | Table | Purpose |
  |---|---|---|
  | `POST /gcal/auth/start` | read | build PKCE + state, return Google consent URL |
  | `GET /gcal/callback` | read | **loopback redirect target**; exchange code→tokens; store |
  | `GET /gcal/status` | read | `{connected, account, calendarId, lastSyncAt, error}` |
  | `POST /gcal/sync` | mutating | run a sync now; `pathOf` returns the base file(s) touched ⇒ SSE refresh |
  | `POST /gcal/disconnect` | read | revoke + wipe tokens/state |

  Mutating routes go through `mutatingHandler(run, pathOf)` (auto invalidate + SSE — don't bump
  version manually). Read‑table routes (like `/relay/*`, `PUT /file`) don't invalidate.

### Settings (`core/src/schema/settingsSchema.ts` + `app/src/settings.ts`)
Add a **non‑secret** `googleCalendar` section (schema is the single source of truth; DEFAULTS
must equal current behavior so it's a no‑op upgrade):
```ts
googleCalendar: object({
  enabled:            { type: 'boolean', default: false, doc: 'Enable Google Calendar sync' },
  clientId:           { type: 'string',  default: '',    doc: 'Google OAuth Desktop client ID' },
  basePath:           { type: 'string',  default: '',    doc: 'Path to the calendar base to sync' },
  calendarId:         { type: 'string',  default: 'primary', doc: 'Google calendar to sync with' },
  conflictPolicy:     { type: 'string',  default: 'lastWriteWins', enum: ['lastWriteWins','googleWins','bismuthWins'] },
  syncIntervalMinutes:{ type: 'number',  default: 15, min: 1, max: 1440, doc: 'Auto‑sync cadence (0 = manual only)' },
  timeZone:           { type: 'string',  default: '',    doc: 'IANA tz for naive events (blank = system tz)' },
})
```
Then mirror the fields into the `Settings` interface (`settings.parity.test.ts` enforces the
match) and the `core/test/schema/settingsSchema.test.ts` key lists. Persisted leaf‑by‑leaf via
`POST /set-setting`.

**Secrets do NOT go here** — `settings.yaml` is committed to the vault's git. Tokens go to the
keychain / app‑config (§6).

### Tauri shell (`app/src-tauri/`, Tauri **v2**)
- Present plugins: `opener`, `fs`, `dialog`, `shell`. **Missing:** http, deep‑link, keyring.
- Bundle id: **`com.bismuth.app`**. Sidecar is spawned on a **free port** and injected as
  `window.__BISMUTH_API__` (`lib.rs` `start_backend`/`build_main_window`).
- **Open the consent URL** with the existing `openExternalUrl()` (`app/src/appWindow.ts` →
  `@tauri-apps/plugin-opener` `openUrl`). `tauri-plugin-shell.open()` is deprecated since 2.1.0.
- **Add one Tauri command** only if we use the keychain: `gcal_store_token` / `gcal_read_token`
  wrapping the `keyring` crate (register in `generate_handler!`). Everything else lives in the
  sidecar.

---

## 3. Sync identity & metadata (new fields)

Add these **row columns** to events (they ride with the event, survive git, and are ignored by
all existing views):
| Column | Meaning |
|---|---|
| `gcalId` | Google event id (mapping key) |
| `gcalEtag` | last‑seen etag (for `If-Match` optimistic concurrency) |
| `gcalUpdated` | Google `updated` RFC3339 at last sync (LWW tie‑breaker) |
| `localUpdated` | bumped on every local edit (LWW tie‑breaker; needs a tiny hook in `EventStore`) |

> We need `localUpdated` because Bismuth has **no per‑event modified timestamp today**. Smallest
> change: stamp `localUpdated = now` inside `EventStore.updateEvent/addEvent`. Without it we
> can't tell which side is newer for LWW.

Non‑event sync state (per synced base) lives **outside the vault** (§6): `syncToken`,
`lastSyncAt`, and a **known‑id manifest** (the set of `gcalId`s present at last sync) used to
detect **local deletions** (a deleted row leaves no trace otherwise — see §5.4).

---

## 4. Google Calendar API model (verified)

### 4.1 Incremental sync — the loop
- **Full sync:** `events.list` with **no** `syncToken`; page via `pageToken` to the **last
  page**, where `nextSyncToken` appears. Persist it **only after the last page** (persisting
  early loses changes).
- **Incremental:** `events.list?syncToken=…` → only **changed + deleted** events.
  - `showDeleted` is forced on; deletions arrive as `status: "cancelled"`.
  - Forbidden with `syncToken`: `timeMin/timeMax/updatedMin/iCalUID/orderBy/q/extendedProperty`
    (sending them breaks incremental sync). Do windowing only on full sync.
- **410 GONE** (`fullSyncRequired`, also fired if ACLs change) ⇒ **wipe the stored `syncToken` +
  manifest and do a fresh full sync.** This is *expected*, not fatal.
- **Push (`watch`) is not viable** — it needs a public HTTPS webhook + CA cert and channels
  expire without auto‑renew. **Poll** on an interval instead.
- **Rate limits:** 403/429 `rateLimitExceeded` ⇒ truncated exponential backoff + jitter
  (`min(2^n·1000 + rand, 32–64s)`); randomize the poll interval ±25%. Quotas ~600/min/user.

### 4.2 Field mapping (`map.ts`, pure + unit‑tested)
| Bismuth | Google | Rule |
|---|---|---|
| all‑day (no `startTime`) | `start.date` / `end.date` | end date is **exclusive** in Google → add 1 day |
| timed | `start.dateTime`+`timeZone` / `end.dateTime`+`timeZone` | apply `settings.googleCalendar.timeZone` (or system IANA tz); `timeZone` is **required for recurring** |
| `title` | `summary` | |
| `location`/`description` | `location`/`description` | |
| `link` | `description` append or `source.url` | Google has no first‑class "link" field |
| `category` | `colorId` (approx) or extended prop | color palette differs; lossy — see §8 |
| `recurrence` (custom JSON) | `recurrence: ["RRULE:…"]` | translate (§4.3) |

### 4.3 Recurrence translation (the hardest part → phased)
Bismuth's custom recurrence ⇄ Google RRULE:
- `daily` → `RRULE:FREQ=DAILY`
- `weekly` + `daysOfWeek` → `RRULE:FREQ=WEEKLY;BYDAY=MO,WE,…`
- `biweekly` → `RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=…`
- `monthly` → `RRULE:FREQ=MONTHLY` (by month‑day of `startDate`)
- `endDate` → `;UNTIL=…`
- **Model mismatch:** Bismuth represents per‑occurrence edits as **split segments sharing a
  `seriesId`**; Google represents them as a master + **exception instances** carrying
  `recurringEventId` + `originalStartTime` and `iCalUID`. Reconciling these is non‑trivial →
  **defer to Phase 3** and treat each Bismuth segment as its own series initially (correct, if
  slightly more rows on Google's side).

### 4.4 Writes & conflicts
- `insert` (POST), `patch` (PATCH, partial — **but arrays overwrite wholesale**, send full
  arrays), `delete` (DELETE → 204).
- **Optimistic concurrency:** send `If-Match: <etag>` on `patch`/`delete`. If the server copy
  changed → **412 Precondition Failed** ⇒ re‑fetch remote, apply LWW (§5), retry.
- `insert` has **no** `If-Match`. Client **may** supply its own `id` (base32hex `a‑v`+`0‑9`,
  5–1024 chars) but Google **recommends random UUIDs** (collisions aren't reliably detected),
  so we let Google mint the id and store it back as `gcalId`.
- `updated` (RFC3339) is the LWW signal — **caveat:** it's read‑only and **ignores
  reminder‑only changes**, so etag stays the real safety primitive (see §9, verdict 6 = *partly*).

---

## 5. The two‑way sync algorithm (last‑write‑wins)

One `sync()` pass for a configured `(basePath ⇄ calendarId)`:

### 5.1 Pull (Google → Bismuth)
```
list = events.list(syncToken?)              // full if no token; handle 410 → full
for ev in list:
  local = rowByGcalId(ev.id)
  if ev.status == 'cancelled':              // remote delete
     if local: deleteLocalRow(local)
  elif !local:                              // new remote
     createLocalRow(map.fromGoogle(ev))     // store gcalId/etag/updated
  else:                                     // remote update
     if newer(ev, local):  applyRemote(local, ev)   // LWW: ev.updated > local.localUpdated
     // else local is newer → leave; push step will reconcile
persist nextSyncToken (only from last page)
```

### 5.2 Push (Bismuth → Google)
```
for row in localRows(base):
  if !row.gcalId:                           // new local
     ev = insert(map.toGoogle(row)); row.gcalId, gcalEtag, gcalUpdated = ev…
  elif row.localUpdated > row.gcalUpdated:  // locally changed since last sync
     try: ev = patch(row.gcalId, map.toGoogle(row), If-Match=row.gcalEtag)
     catch 412: ev = resolveConflict(row)   // re-fetch remote, LWW, then patch/accept
     row.gcalEtag, gcalUpdated = ev…
```

### 5.3 Deletions (both directions)
- **Remote→local:** handled in pull (`status: cancelled`).
- **Local→remote:** a deleted Bismuth row leaves **no trace**, so diff the **known‑id manifest**
  (gcalIds present last sync) against current rows. A `gcalId` in the manifest but **absent**
  from rows ⇒ the user deleted it locally ⇒ `events.delete(gcalId, If-Match)`. (Alternative
  considered: soft‑delete marker rows. Manifest chosen — keeps the calendar file clean.)

### 5.4 Persistence after a pass
Write `syncToken`, `lastSyncAt`, and the refreshed manifest to the non‑vault state file. Local
row mutations go through the existing write path so SSE refreshes the open calendar
(`POST /gcal/sync` is a `mutatingHandler` whose `pathOf` returns the base file).

### 5.5 Conflict resolution detail (`conflictPolicy`)
- `lastWriteWins` (default): compare remote `updated` vs local `localUpdated`; **newer wins**.
- `googleWins` / `bismuthWins`: deterministic override (handy as escape hatches; nearly free).

---

## 6. OAuth flow & token storage (privacy‑critical)

```
 user clicks "Connect Google Calendar"
   → frontend POST /gcal/auth/start
       sidecar: make code_verifier+challenge(S256)+state; remember verifier keyed by state
       returns https://accounts.google.com/o/oauth2/v2/auth?response_type=code
               &client_id=…&redirect_uri=http://127.0.0.1:<sidecarPort>/gcal/callback
               &scope=https://www.googleapis.com/auth/calendar.events
               &code_challenge=…&code_challenge_method=S256&state=…
               &access_type=offline&prompt=consent
   → Tauri opens that URL in the SYSTEM browser (plugin-opener)
   → user consents in their real browser
   → Google redirects to http://127.0.0.1:<sidecarPort>/gcal/callback?code=…&state=…
       sidecar GET /gcal/callback: validate state → POST https://oauth2.googleapis.com/token
         grant_type=authorization_code, code, code_verifier, client_id, redirect_uri
       receives access_token (~1h) + refresh_token
       store refresh_token in OS keychain; keep access_token in sidecar memory
       respond with a tiny "✓ you can close this tab" HTML page
   → frontend polls GET /gcal/status → "Connected as you@gmail.com"
```

- **Loopback works on any port** for Google "Desktop app" clients → the sidecar's dynamic port
  is fine; no fixed redirect URI needed (no Google‑console churn per machine).
- **Token storage ranking:** OS keychain (`keyring` crate: macOS Keychain / Windows Cred Mgr /
  Linux Secret Service) **>** encrypted file **>** plaintext. **MVP fallback** if we don't wire
  keyring on day one: `app_config_dir()/gcal-tokens.json` with `0600` perms (the same dir as
  `config.json`) — still **outside the vault/git**. Production: keyring.
- The desktop **client secret is not actually secret** (RFC 8252 public client); PKCE is the
  protection. We can ship the client_id; we should **not** rely on a secret.

### Privacy guarantees this delivers (directly answering your requirement)
1. **Single scope `calendar.events`** → consent screen literally reads *"View and edit events on
   all your calendars."* Token **cannot** read Gmail/Drive/contacts or change sharing — Google
   enforces it. (Even narrower option: `calendar.events.owned` = only calendars you own.)
2. **No secrets in the vault or git** — refresh token in keychain, access token in memory.
3. **PKCE + loopback** → the auth code never leaves your machine; no client secret to leak.
4. **You can self‑host unverified** — add your own Google account as a test user; only an
   "unverified app" warning, no Google review needed for personal use.

---

## 7. The decisions that change the build (please confirm)

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| **D1** | **Testing vs Production** OAuth app | **Publish to Production** (one ~10‑day Google review, **no** security assessment for `calendar.events`) | In "Testing", **refresh tokens die after 7 days** → silent weekly re‑auth. Acceptable only for a throwaway MVP. |
| **D2** | Scope breadth | `calendar.events` (all your calendars) | `calendar.events.owned` is tighter (owned calendars only) but can't sync calendars shared *to* you. Pick based on whether you sync shared calendars. |
| **D3** | Which calendar ↔ which base | one base ⇄ one Google calendar (`calendarId`, default `primary`) for MVP | Multi‑calendar fan‑out is a later phase. |
| **D4** | Google Cloud project | **You create it** (I cannot create Google accounts/projects) | You'll make an OAuth "Desktop app" client and paste the **client ID** into settings. I'll write a step‑by‑step. |
| **D5** | Recurring events in MVP? | **Defer** — MVP syncs single + all‑day events; recurrence in Phase 3 | The custom‑JSON ⇄ RRULE + exceptions reconciliation is the riskiest surface. |
| **D6** | Auto‑sync cadence | client‑driven `setInterval` (default 15 min) + "Sync now"; daemon‑cron later | Core has **no built‑in scheduler**; client polling is the simplest correct MVP. |

---

## 8. Known hard edges / lossy spots (surfaced, not hidden)
- **Timezone:** introducing tz to naive events is a real semantic change; DST transitions and
  cross‑tz travel can shift times. Mitigation: a single configured IANA tz, all‑day events stay
  date‑only.
- **Recurrence exceptions:** Bismuth's split‑segment model ≠ Google's master+exception model.
  Phase 3; until then each segment is its own simple series.
- **Categories ⇄ colors:** Google has a fixed `colorId` palette; Bismuth has free‑form named
  categories with hex colors → lossy. Option: store category in a Google **extended property**
  to round‑trip losslessly.
- **`updated` ignores reminder‑only edits** → LWW can miss a reminder change; etag/If-Match is
  the real guard (verified, §9 v6).
- **Local‑delete detection** depends on the manifest; if the manifest is lost, a full sync will
  **re‑create** locally‑deleted events from Google until re‑reconciled.
- **Unverified "personal use" path** has a **lifetime cap of 100 users** on the project that
  can't be reset — irrelevant for self‑use, a wall if you ever distribute.

---

## 9. Verification ledger (what the research confirmed)
All verified against Google primary docs / RFC 8252 / RFC 8252‑era OAuth docs.

| # | Claim | Verdict |
|---|---|---|
| 1 | OOB deprecated for desktop; **loopback 127.0.0.1 + PKCE** is the supported flow | **Confirmed** |
| 2 | `calendar.events` = read+write events only; **no** Gmail/Drive/contacts; narrower than `calendar` | **Confirmed** |
| 3 | Incremental sync via `nextSyncToken`; **410 GONE ⇒ full resync** | **Confirmed** |
| 4 | `calendar.events` is **sensitive** (not restricted); usable as test user unverified; **Testing ⇒ refresh token 7‑day expiry** | **Confirmed** |
| 5 | etag + `If-Match` ⇒ **412** on server‑side change (optimistic concurrency) | **Confirmed** |
| 6 | Client may set own event id (base32hex 5–1024); `updated` for LWW | **Partly** — id/format exact; but `updated` is read‑only, ignores reminder‑only edits, and is an app‑level LWW choice (Google's documented primitive is etag/If-Match), and Google recommends random UUIDs over deterministic ids |

---

## 10. Phased delivery plan

> Each phase is independently shippable and visible in the live preview (`:1422`).

- **Phase 0 — OAuth plumbing.** `gcal/oauth.ts`, `/gcal/auth/start`, `/gcal/callback`,
  `/gcal/status`, token storage (app‑config file MVP → keychain), "Connect/Disconnect" UI +
  settings section. **Done = "Connected as you@gmail.com."**
- **Phase 1 — One‑way pull (read‑only), single + all‑day events.** `client.ts` list + `map.ts`
  fromGoogle; create/update/delete local rows from a **full** list; add `gcalId/etag/updated`
  columns. Proves API + mapping end‑to‑end.
- **Phase 2 — Two‑way push + LWW + deletions.** `map.ts` toGoogle, insert/patch/delete with
  `If-Match`/412 handling, `localUpdated` stamp in `EventStore`, manifest‑based local‑delete
  detection, `conflictPolicy`. **Done = edits both ways converge.**
- **Phase 3 — Incremental sync + recurrence.** `syncToken` persistence + 410 recovery; RRULE
  translation; basic exception handling. **Done = fast syncs + repeating events.**
- **Phase 4 — Automation + polish.** client interval auto‑sync (then optional daemon cron),
  rate‑limit backoff, error surfacing (toast + status), multi‑calendar, category↔extended‑prop
  round‑trip. Tests throughout (`core/test/gcal/*` — `map` and `sync` are pure + unit‑testable).

---

## 11. Test strategy
- **Pure units (no network):** `map.ts` (all‑day/timed/tz/recurrence round‑trips),
  `sync.ts` reconcile decisions (LWW table: new/updated/deleted × both sides, 412 path),
  manifest deletion detection. Mirrors the repo's `core/test/**` per‑module convention.
- **OAuth:** unit‑test PKCE challenge + state validation + token‑exchange request shaping
  against a stubbed token endpoint.
- **Manual (live preview):** connect → create on Google → sync → see it in Bismuth; edit in
  Bismuth → sync → see it on Google; conflicting edits → LWW resolves; delete both ways.
```

