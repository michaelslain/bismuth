# Calendar Subsystem Overview

The calendar in Bismuth is not a standalone page or feature — it is a **Bases view kind** rendered when a `type: base` markdown file declares `views: [{ type: calendar }]`. This document covers the full calendar subsystem: the event and category data model, how events are stored and serialized, the recurrence rule engine, the category-to-color mapping, reactive global state, view components, and user-facing settings. For how to configure a calendar base file and wire up column mappings, see [bases/views/calendar.md](../bases/views/calendar.md) (to be created).

There are **two write paths** to the same on-disk calendar file:

1. **The app UI** — `CalendarView.tsx` → `EventStore` → `BaseBackend`, documented in the bulk of this page. This is the interactive, in-app path.
2. **A headless CLI/API path** — `core/src/calendar.ts` (a pure module) driven by the `bismuth calendar …` CLI group, so the **daemon, agents, and scripts can edit a calendar by API instead of hand-editing raw YAML**. Hand-editing is fragile: the app rewrites the file (strips quotes, adds `localUpdated`) and can't remove a single recurring occurrence. Headless writes land on disk and the app's vault watcher picks them up live. See [Headless Write Path](#headless-write-path-coresrccalendarts) below.

> **Google Calendar two-way sync.** A calendar base — the same `type: base` markdown file whose event rows this page describes — can be **two-way-synced with Google Calendar**. Sync is **per-calendar**: each base declares its own `googleCalendarSync` + `googleCalendarId` in its frontmatter, so a vault can sync several calendars each with a different Google calendar. A single sync pass (`syncEvents` in `core/src/gcal/sync.ts`) pulls remote events into the base's rows, pushes new/changed local rows back to Google, and propagates deletions in both directions, with a configurable conflict policy (`lastWriteWins` / `googleWins` / `bismuthWins`). The base file stays clean — all sync state (per-event links, signatures, sync token) lives in an external, per-base-keyed manifest outside the vault, and a category's `categories:` frontmatter color is mapped to a Google `colorId`. The full OAuth flow, the manifest/link model, change detection, and the HTTP/CLI surface are documented in [gcal/overview.md](../gcal/overview.md) — that is the source of truth; this page does not duplicate it.

---

## Architecture at a Glance

```
CalendarView.tsx (app/src/bases/)
  └── EventStore  ←  CalendarStorage backend
        ├── BaseBackend (app/src/bases/calendarBase.ts)  ← base .md file on disk
        └── MemoryBackend                                ← ephemeral / test only
  └── calendar/state.ts  — Solid signals for current view, date, events, categories
  └── calendar/refresh.ts — derives the visible date-range and refills signals
  └── components/
        ├── Toolbar.tsx
        ├── EventModal.tsx
        ├── RecurrenceDialog.tsx
        ├── CategoryPanel.tsx
        ├── CalendarSettings.tsx
        └── views/  MonthView, WeekView, ThreeDayView, DayView (via TimeGrid)
```

---

## Data Model

### `CalendarEvent`

Defined in `app/src/calendar/types.ts`:

```typescript
interface CalendarEvent {
  id: string            // UUID, assigned by EventStore.addEvent
  title: string
  date: string          // "YYYY-MM-DD" — the canonical day for non-recurring events
                        // and the base anchor date for recurring series masters
  startTime?: string    // "HH:MM" — omit for all-day events
  endTime?: string      // "HH:MM" — omit = no explicit end; TimeGrid adds 1h visually
  location?: string
  link?: string
  description?: string  // markdown-enabled (rendered in EventModal on blur)
  category?: string     // name of a Category; absent = no tint (ghost chip)
  recurrence?: Recurrence
  localUpdated?: string // ISO timestamp stamped on every local create/edit (EventStore);
                        // Google Calendar sync's last-write-wins tiebreaker vs. remote `updated`
}
```

All date/time fields are plain strings (`"YYYY-MM-DD"` / `"HH:MM"`). There is no `Date` object in the serialized model.

**All-day events**: `startTime` is absent (or empty). The `EventModal` binds a toggle labelled "All day"; if turned on, `startTime`/`endTime` are stripped from the saved event. `TimeGrid` renders all-day events in a dedicated sticky row above the time columns.

### `Category`

```typescript
interface Category { name: string; color: string }
```

`color` is either a **theme token** (one of `"accent" | "teal" | "blue" | "violet" | "green" | "gold" | "rose"`) or any CSS color string (typically a hex from the color picker, e.g. `"#4a90e2"`). Storing the bare token — not the resolved hex — means the category recolors automatically when the theme changes.

### `Recurrence`

```typescript
type RecurrenceType = 'daily' | 'weekly' | 'biweekly' | 'monthly'

interface Recurrence {
  type: RecurrenceType
  daysOfWeek?: number[]  // 0–6, Sunday = 0; used by weekly + biweekly only
  startDate: string      // "YYYY-MM-DD" — first possible occurrence
  endDate?: string       // "YYYY-MM-DD" — inclusive last day; absent = open-ended (runs to 2100-01-01)
  seriesId: string       // UUID shared across all master segments of the same logical series
}
```

A recurring event is stored as one or more **master segments** in `data.events`, each with its own `Recurrence`. The `seriesId` ties segments together so "edit/delete all" and "edit/delete following" operations can target the right set.

### `EventsFile`

The container serialized to and from disk:

```typescript
interface EventsFile { events: CalendarEvent[]; categories: Category[] }
```

---

## Persistence: `EventStore` and Storage Backends

`EventStore` (`app/src/calendar/EventStore.ts`) is the single write path for all calendar mutations. It holds the live in-memory `EventsFile` and delegates to a `CalendarStorage` backend for load/save.

### `CalendarStorage` interface

```typescript
interface CalendarStorage {
  load(): EventsFile | null
  save(data: EventsFile): void
}
```

### `MemoryBackend`

Ephemeral in-process store. Used in tests and as the fallback when `CalendarView` has no `basePath`. `save` performs a `structuredClone` so the store's internal reference is never aliased.

### `BaseBackend` (`app/src/bases/calendarBase.ts`)

Backs the calendar with a `type: base` markdown file on disk. Lifecycle:

1. **`init()`** — called once on mount; reads the file via `api.read`, passes the text through `parseCalendarFile`, and captures the full frontmatter object so subsequent saves can preserve all non-calendar frontmatter keys (e.g. `views:`, `source:`, custom fields).
2. **`load()`** — returns the last-parsed snapshot synchronously (always available after `init`).
3. **`save(data)`** — updates the snapshot, merges categories back into the frontmatter under `categories:`, then fires-and-forgets `api.write` with the re-serialized file. The version poll or SSE event will reflect the disk change on the next read.

`BaseBackend` never throws; `init()` catches file-not-found and seeds an empty store.

### File format: `calendarSerialize.ts`

`app/src/bases/calendarSerialize.ts` handles the round-trip between the markdown file and `CalendarEvent[]`.

**On-disk structure:**

```markdown
---
type: base
view: calendar
categories:
  - name: Work
    color: teal
  - name: Personal
    color: "#e06c75"
---

| id | title | date | startTime | endTime | category | recurrence | ... |
| --- | --- | --- | --- | --- | --- | --- | --- |
| uuid | Stand-up | 2026-05-04 | 09:00 | 09:30 | Work | {"type":"weekly",...} | |
```

- The event table in the body is parsed by `parseRows` (the same row-table parser used by all Bases sources).
- The `recurrence` column stores the full `Recurrence` object as a JSON string (`JSON.stringify`/`JSON.parse`); the parser falls back to `undefined` on malformed JSON.
- `categories` in frontmatter is a YAML list of `{name, color}` objects, read by `categoriesOf(frontmatter)`.
- Re-serialization uses `stringifyYaml` on the full frontmatter (original keys preserved) plus `serializeRows` on the event list; `categories` is only written if non-empty.

---

## Headless Write Path (`core/src/calendar.ts`)

`core/src/calendar.ts` is a **pure, headless module** — the API surface the daemon/agents/CLI drive instead of hand-editing raw YAML. It is ported from the app's `calendarSerialize.ts` + `calendar/{dates,EventStore}.ts`, but has no Solid, no `EventStore` class, and no I/O: every function is a plain array/string transform, and the caller (the CLI) does the read/parse/mutate/serialize/write. A calendar is the same `type: base` + `view: calendar` markdown file — events are the base's row table, categories are a frontmatter key — and **every write preserves the WHOLE frontmatter, touching only events + categories** (matching `BaseBackend`).

### Types

The module re-declares the calendar model independently of the app (`app/src/calendar/types.ts`), so backend code has no frontend dependency:

```typescript
type RecurrenceType = "daily" | "weekly" | "biweekly" | "monthly"

interface Recurrence {
  type: RecurrenceType
  daysOfWeek?: number[]   // 0–6, Sunday = 0
  startDate: string       // "YYYY-MM-DD"
  endDate?: string        // "YYYY-MM-DD"
  seriesId: string
}

interface Category { name: string; color: string }

interface CalendarEvent {
  id: string
  title: string
  date: string            // "YYYY-MM-DD"
  startTime?: string      // "HH:MM" — undefined = all-day
  endTime?: string
  location?: string
  link?: string
  description?: string
  category?: string
  categories?: string[]   // multi-category form (JSON-encoded in the row)
  recurrence?: Recurrence
  localUpdated?: string    // ISO timestamp stamped on every local create/edit
}

interface ParsedCalendar {
  frontmatter: Record<string, unknown>
  events: CalendarEvent[]
}
```

`newId()` is exported (`crypto.randomUUID()`); `now()` (internal) stamps `localUpdated` on every create/edit via the internal `stamp()` helper.

### Parse / serialize

| Function | Signature | Notes |
|----------|-----------|-------|
| `parseCalendarFile` | `(text: string) => ParsedCalendar` | Splits frontmatter (regex `FM_RE`) from body; `parseYaml` the frontmatter (falls back to `{}` on malformed), `parseRows` the body event table, `rowToEvent` each row |
| `serializeCalendarFile` | `(frontmatter, events) => string` | `stringifyYaml` on the FULL frontmatter (all original keys preserved) + `serializeRows` on the events; emits `---\n<fm>\n---\n\n<body>\n`, or a bare frontmatter block when there are no events |
| `categoriesOf` | `(frontmatter) => Category[]` | Reads the `categories` frontmatter key (array of `{name, color}`), else `[]` |
| `rowToEvent` | `(row: Row, i: number) => CalendarEvent` | Row→event mapping mirroring `calendarSerialize.ts`; `recurrence`/`categories` are JSON-decoded from their string cells (malformed → `undefined`/single-element); missing `id` → `row-<i>` |
| `isCalendarBase` | `(frontmatter) => boolean` | Is this frontmatter a calendar base? Mirrors `parseBaseFile`: an explicit `views:` array wins (calendar iff some view object has `type: calendar`); the `view: calendar` shorthand applies only when no `views:` array is present. Drives `bismuth calendar bases` discovery |
| `emptyCalendarFile` | `(opts?: {title?, categories?}) => string` | A fresh, empty calendar base file (`type: base` + `view: calendar` frontmatter, no events). Drives `bismuth calendar create` |

The row↔event mapping is JSON-string-based for the compound fields: `recurrence` is `JSON.stringify`d into its column, and `categories` (when non-empty) is likewise JSON-encoded; the single-valued `category` field stays a plain string.

### Queries (recurrences expanded)

| Function | Signature | Notes |
|----------|-----------|-------|
| `expandRecurrence` | `(recurrence, rangeStart, rangeEnd) => string[]` | Iterates one day at a time from `startDate` to `min(endDate ?? 2100-01-01, rangeEnd)`, `matchesRecurrence` per day. Same rule semantics as the app's `dates.ts` (see [Recurrence Engine](#recurrence-engine-datests)) |
| `eventsForRange` | `(events, rangeStart, rangeEnd) => CalendarEvent[]` | Concrete instances in `[rangeStart, rangeEnd]`; each recurring master is expanded to one `{...event, date}` per matching date; sorted by `date` then `startTime` |
| `eventsForDay` | `(events, date) => CalendarEvent[]` | `eventsForRange(events, date, date)` |
| `detectOverlaps` | `(dayEvents) => OverlapPair[]` | Pairs of timed events (`startTime` + `endTime` both set) whose half-open `[start, end)` intervals intersect; all-day events don't participate; `"HH:MM"` strings compare lexicographically. `OverlapPair = { a: CalendarEvent; b: CalendarEvent }` |
| `eventsInWindow` | `(events, from?, to?) => CalendarEvent[]` | RAW stored events (masters **not** expanded — real ids, so a caller can pick an id to edit) intersecting `[from, to]`: singles by `date`, masters by series-window `[startDate, endDate ?? ∞]` intersection. Both bounds optional (missing = open-ended) |
| `searchEvents` | `(events, query) => CalendarEvent[]` | Case-insensitive substring search over `title` / `description` / `location` / `category` / `categories`. Works on raw events or expanded instances (the caller picks the input) |

The date helpers (`toDateStr`, `addDays`, internal `parseLocalDate`/`dayBefore`/`dayAfter`/`daysInMonth`/`matchesRecurrence`) use the same local-midnight convention as the app's `dates.ts` — `parseLocalDate(iso)` appends `"T00:00:00"` so nothing is UTC.

### Mutations (pure transforms; caller re-serializes + writes)

Each mutation returns a NEW `CalendarEvent[]` (or `{events, event}`); none touch disk. `findEvent(events, id)` is the shared lookup.

| Function | Signature | Behavior |
|----------|-----------|----------|
| `findEvent` | `(events, id) => CalendarEvent \| undefined` | Lookup by `id` |
| `addEvent` | `(events, event) => { events, event }` | `stamp()`s the input (fills `id` via `newId()` if absent, sets `localUpdated`), appends; returns both the new array and the created event |
| `moveEvent` | `(events, id, updates) => CalendarEvent[]` | Merges `updates` (minus `id`) into the matching event + re-stamps `localUpdated`. Throws `CALENDAR_EVENT_NOT_FOUND` if the id is absent |
| `deleteEvent` | `(events, id) => CalendarEvent[]` | Filters out the id. Throws `CALENDAR_EVENT_NOT_FOUND` if absent |
| `overrideOccurrence` | `(events, masterId, occurrenceDate, updates) => CalendarEvent[]` | Splits a recurring master around `occurrenceDate` (truncate the head to the day before; re-add the tail as its own segment keeping the same `seriesId`) and inserts a standalone single event for that date carrying `updates` (its `recurrence`/`id` stripped). Editing the FIRST occurrence drops the master head entirely. Throws `CALENDAR_NOT_RECURRING` if the id isn't recurring. Ported from `EventStore.editOccurrence` |
| `deleteOccurrence` | `(events, masterId, occurrenceDate) => CalendarEvent[]` | Same series split as `overrideOccurrence`, but with NO replacement single event. Throws `CALENDAR_NOT_RECURRING`. Ported from `EventStore.deleteOccurrence` |
| `recurrenceFromRRule` | `(rrule, startDate) => Recurrence` | Parses an iCal/Google RRULE string (the same subset the gcal sync supports: `FREQ=DAILY\|WEEKLY\|MONTHLY`, `INTERVAL=2` only as weekly→biweekly, `BYDAY`, `UNTIL` — no `COUNT`/`YEARLY`/`RDATE`/`EXDATE`) into a `Recurrence` with a fresh `seriesId`. The `RRULE:` prefix is optional; `startDate` is normalized to the first VALID occurrence (Google DTSTART semantics — a weekly `BYDAY` rule never starts on an off-day). Throws `CALENDAR_RRULE_FORMAT_ERROR` on unsupported rules. Reuses `core/src/gcal/recurrence.ts` — one RRULE implementation |

**Category mutations** mirror `EventStore` semantics but as pure transforms returning `CalendarPatch = { frontmatter, events }`:

| Function | Signature | Behavior |
|----------|-----------|----------|
| `addCategory` | `(frontmatter, category) => frontmatter` | Appends `{name, color}` to the `categories` frontmatter key. Throws `CALENDAR_CATEGORY_EXISTS` on a duplicate name, `CALENDAR_CATEGORY_FORMAT_ERROR` on a blank one |
| `updateCategory` | `(frontmatter, events, name, updates) => CalendarPatch` | Rename and/or recolor. A rename **cascades** into every event's `category`/`categories`; each event actually changed gets a fresh `localUpdated` stamp (category is part of the gcal sync signature — see below). Throws `CALENDAR_CATEGORY_NOT_FOUND` / `CALENDAR_CATEGORY_EXISTS` (rename collision) |
| `removeCategory` | `(frontmatter, events, name, reassignTo?) => CalendarPatch` | Removes the category and clears it from events (or reassigns them to `reassignTo`, which must be another existing category). Changed events get a fresh `localUpdated` stamp |

The error codes (`CALENDAR_EVENT_NOT_FOUND`, `CALENDAR_NOT_RECURRING`, `CALENDAR_CATEGORY_*`, `CALENDAR_RRULE_FORMAT_ERROR`) go through `createError` (`core/src/error.ts`); each maps to an `AppError` when surfaced.

---

## The `bismuth calendar` CLI Group (`cli/src/commands/calendar.ts`)

The `bismuth calendar …` command group is the headless driver over `core/src/calendar.ts`. Every command follows the same shape: **read the vault file → `parseCalendarFile` → mutate → `serializeCalendarFile` → `writeNote`**, and the app's vault watcher picks up the write live. All commands are headless (no running server). The group is bridged to the MCP as `bismuth_cli` (no new MCP tool), so `bismuth_cli_help` lists these — this is how the daemon/agents author calendar edits.

Two internal helpers wrap the round-trip: `readCalendar(vault, path)` → `readNote` + `parseCalendarFile`, and `writeCalendar(vault, path, frontmatter, events)` → `serializeCalendarFile` + `writeNote`. Event fields are assembled by `eventFieldsFromArgs`: `--json '{...}'` provides a base object, then convenience flags overlay it (flags win) — `--title`, `--date`, `--start` (`startTime`), `--end` (`endTime`), `--location`, `--link`, `--description`, `--category`, and `--recurrence '{...}'` (a JSON `Recurrence`; a missing `seriesId` is auto-filled with a fresh UUID). Malformed `--json`/`--recurrence` `fail`s the command. `calendar add` additionally accepts `--rrule 'FREQ=WEEKLY;BYDAY=MO'` (an iCal RRULE, translated via `recurrenceFromRRule`; an explicit `--recurrence` wins).

**Discovery & creation**

| Command | Usage | Behavior |
|---------|-------|----------|
| `calendar bases` | *(none)* | Walks the vault's markdown, filters by `isCalendarBase`, prints `[{path, title, events, categories}]` — how an agent finds (or verifies) the calendar file to target |
| `calendar create` | `<basePath> [--title '…']` | Writes `emptyCalendarFile` at `<basePath>` (`.md` appended if missing); fails with `EEXIST` if the path exists |

**Reading & searching**

| Command | Usage | Behavior |
|---------|-------|----------|
| `calendar list` | `<basePath> [--from … --to …]` | RAW stored events via `eventsInWindow` — masters unexpanded, real ids (use this to find an id to edit) |
| `calendar range` | `<basePath> <from> <to>` | Concrete instances via `eventsForRange` (recurrences expanded) |
| `calendar day` | `<basePath> <date>` | Prints the day's events (recurrences expanded to concrete instances) via `eventsForDay` — read-only |
| `calendar get` | `<basePath> <id>` | One event by id, as stored |
| `calendar search` | `<basePath> <text> [--from … --to …]` | `searchEvents` over raw events; with BOTH `--from` and `--to` it searches expanded instances in that window instead |
| `calendar overlaps` | `<basePath> <date>` | `detectOverlaps(eventsForDay(...))` for the day; prints `{ date, overlaps }` — read-only |

**Event mutations**

| Command | Usage | Behavior |
|---------|-------|----------|
| `calendar add` | `<basePath> --date YYYY-MM-DD --title '…' [--start HH:MM --end HH:MM] [--rrule '…']` | `addEvent` with fields from `eventFieldsFromArgs`; `--date` required; prints `{ ok, event }`. With `--rrule`, the event date is normalized to the recurrence's first valid occurrence |
| `calendar move` | `<basePath> <id> [--date … --start … --end …]` | `moveEvent(events, id, updates)`; fails if nothing to update; prints `{ ok, event }` |
| `calendar delete` | `<basePath> <id>` | `deleteEvent(events, id)`; prints `{ ok }` |
| `calendar override` | `<basePath> <id> <date> [--title/--start/--end/--json …]` | `overrideOccurrence(events, id, date, updates)` — the occurrence `<date>` is the positional, so any `--date` flag is dropped as ambiguous; prints `{ ok }` |
| `calendar delete-occurrence` | `<basePath> <id> <date>` | `deleteOccurrence(events, id, date)`; prints `{ ok }` |

**Category mutations**

| Command | Usage | Behavior |
|---------|-------|----------|
| `calendar categories` | `<basePath>` | Prints the `[{name, color}]` list |
| `calendar category add` | `<basePath> <name> [--color '#b00020']` | `addCategory`; `--color` is any CSS color or a theme token (`accent`/`teal`/…); defaults to `accent` |
| `calendar category update` | `<basePath> <name> [--rename <new>] [--color <c>]` | `updateCategory`; a rename cascades into events |
| `calendar category remove` | `<basePath> <name> [--reassign <other>]` | `removeCategory`; clears (or reassigns) the category on events |

Vault is resolved by `requireVault` (`--vault` / `BISMUTH_VAULT`); output honors `--pretty` (via `out`).

**Google-Calendar sync safety.** Headless edits are safe on a gcal-synced calendar: the sync bookkeeping (the Google-id → Bismuth-id manifest) lives OUTSIDE the vault in `~/.bismuth/gcal/sync.json`, so rewriting the base file can't corrupt it. The sync identifies events by their `id` column and detects local edits by a content signature + the `localUpdated` stamp — and every CLI mutation preserves ids and stamps `localUpdated` exactly like the app does. Consequences to be aware of: a locally deleted event **will be deleted from Google** on the next sync (by design), and edits win/lose conflicts per the configured policy (see [gcal overview](../gcal/overview.md)).

---

## Recurrence Engine (`dates.ts`)

`expandRecurrence(recurrence, rangeStart, rangeEnd): string[]`

Given a `Recurrence` and a query window (ISO date strings, inclusive on both ends), returns every date in `[rangeStart, rangeEnd]` that matches the rule. The function iterates one day at a time from `max(recurrence.startDate, ...)` to `min(recurrence.endDate ?? "2100-01-01", rangeEnd)`, calling `matchesRecurrence` on each.

### Rule semantics

| `type` | Match condition |
|--------|----------------|
| `daily` | Every day unconditionally |
| `weekly` | Days in `daysOfWeek[]`; if `daysOfWeek` is absent, defaults to the day-of-week of `startDate` |
| `biweekly` | Same day-of-week check as `weekly`, plus the week must be an even number of weeks from `startDate` |
| `monthly` | The day-of-month of `startDate`, clamped to the last day of shorter months |

**Monthly edge case**: a series starting on `2026-01-31` fires on `2026-02-28` (non-leap) and `2026-04-30` (30-day month) rather than skipping those months entirely. This is tested in `dates.test.ts`.

**Biweekly detail**: the "even week" check computes `Math.floor(diffDays / 7) % 2 === 0` where `diffDays` is the integer number of days from `startDate`.

### Date helpers

| Function | Signature | Notes |
|----------|-----------|-------|
| `toDateStr` | `(d: Date) => string` | Produces `"YYYY-MM-DD"` in **local** time (not UTC) |
| `addDays` | `(d: Date, n: number) => Date` | Returns a new `Date`; `n` may be negative |
| `startOfWeek` | `(d: Date, mondayFirst: boolean) => Date` | Returns Monday (ISO) or Sunday (US) of the containing week |
| `weekRange` | `(d: Date, mondayFirst: boolean) => [string, string]` | `[weekStart, weekStart+6]` as ISO strings |
| `formatTime` | `(time: string, military: boolean) => string` | `"13:05"` → `"1:05"` (12h) or `"13:05"` (24h); no AM/PM suffix on times |
| `formatGutterHour` | `(h: number, military: boolean) => string` | Hour `0` returns `""` (midnight label suppressed in gutter); otherwise `"9 AM"` / `"13:00"` |

`toDateStr` constructs via `getFullYear`/`getMonth`/`getDate` — always local, never UTC. Avoid passing `new Date("2026-05-10")` (UTC midnight) without a time zone suffix; prefer `new Date("2026-05-10T00:00:00")` to stay in local time.

---

## Recurrence Split Operations (`EventStore`)

All mutating methods are `async` and call `this.save()` after every change.

### Single-occurrence operations

**`deleteOccurrence(masterId, occurrenceDate)`**

Removes exactly one occurrence. Implementation: truncates the master's `endDate` to the day before the target, then inserts a new continuation segment starting the day after — preserving the same `seriesId`. If the master already ended at or before the target, the continuation is omitted.

```
Before: [daily 2026-05-01 → ∞]
deleteOccurrence(id, '2026-05-03')
After:  [daily 2026-05-01 → 2026-05-02] + [daily 2026-05-04 → ∞]
```

Verified in `EventStore.test.ts`:
```typescript
const days = store.getEventsForRange('2026-05-01', '2026-05-05').map(e => e.date).sort()
// → ['2026-05-01', '2026-05-02', '2026-05-04', '2026-05-05']  (03 is gone)
```

**`editOccurrence(masterId, occurrenceDate, updates)`**

Same segment split as `deleteOccurrence` to carve out the target day; inserts a fresh non-recurring event for that single date with the merged `updates`. The `recurrence` field is stripped from the single-occurrence event.

### Series-wide operations

**`editSeries(seriesId, updates)`**

Finds every master segment whose `recurrence.seriesId` matches and applies `updates` to each via `updateEvent`. Use this for changing the title, category, or time of an entire series.

**`deleteSeries(seriesId)`**

Removes all events whose `recurrence.seriesId` matches in one in-memory filter + save. No split needed.

### "This and following" operations

**`editFollowing(masterId, occurrenceDate, updates)`**

Truncates the master at `occurrenceDate - 1`, then adds a new segment starting at `occurrenceDate` with a **fresh `seriesId`** (so the new tail is an independent series). The `updates.recurrence` is merged over the master's recurrence rule, which lets you change the rule type for the tail (e.g. daily → weekly-on-Mondays).

```typescript
// From 2026-05-04 onward, switch from daily to weekly-Mondays
await store.editFollowing(masterId, '2026-05-04', {
  recurrence: { type: 'weekly', daysOfWeek: [1], startDate: '2026-05-04', seriesId: 'ignored' }
})
// Before 05-04: still daily (3 days: 01, 02, 03)
// From 05-04: only Mondays (04, 11, 18, 25)
```

**`deleteFollowing(masterId, occurrenceDate)`**

Truncates the master's `endDate` to `occurrenceDate - 1`. No new segment created. The master's range simply ends.

---

## `RecurrenceDialog`

When the user edits or deletes a recurring event chip, the action is not executed immediately. Instead, the component sets `recurrenceAction.value` (a Solid signal from `state.ts`) with the pending operation details:

```typescript
{ type: 'edit' | 'delete'; masterId: string; occurrenceDate: string; updates?: Partial<CalendarEvent> }
```

`RecurrenceDialog` reads this signal and renders a modal with three choices: **JUST THIS ONE**, **THIS AND FOLLOWING**, **ALL**. On selection, it calls the appropriate `EventStore` method, reloads the store, calls `refreshEvents`, and clears `recurrenceAction.value`.

This is the exclusive gate for recurring-event mutations — the `EventModal` and `EventChip` both set `recurrenceAction.value` and close themselves rather than calling `EventStore` directly for recurring events.

---

## Category Color (`categoryColor.ts`)

### Theme swatches

```typescript
const THEME_SWATCHES = ["accent", "teal", "blue", "violet", "green", "gold", "rose"] as const
type ThemeSwatch = typeof THEME_SWATCHES[number]
```

Stored as bare token strings (e.g. `"teal"`), not as `var(--teal)`. This is the canonical form in `Category.color`.

### `resolveCategoryColor(color)`

Converts a stored color to a CSS value usable in `background` / `color` inline styles:

- Theme token → `"var(--teal)"` (tracks the active theme automatically)
- Any other string (hex, `rgb()`, named color) → passed through unchanged
- `undefined` → `"var(--accent)"`

Used by `EventChip` to tint chips:
```typescript
// chip background: category color at 85% opacity, blended with transparent
`color-mix(in srgb, ${resolveCategoryColor(cat.color)} 85%, transparent)`
```

Events with no matching category get class `ghost` (outline-only, no fill).

### `categoryColorHex(color)`

Used by the native `<input type="color">` element, which cannot display `var(...)`. For theme tokens, reads the live computed value off `:root` via `getComputedStyle`; falls back to `"#888888"`. Non-theme hex colors pass through unchanged.

### `isThemeToken(color)`

Type guard returning `true` iff `color` is a member of `THEME_SWATCHES`.

---

## Reactive State (`state.ts`)

All state is module-level Solid signals wrapped in a `createBox` helper (`{ get value(), set value(v) }`). There is no context provider — any component that imports from `state.ts` is reactive.

| Export | Type | Purpose |
|--------|------|---------|
| `currentView` | `ViewType` | Active view: `'month' \| 'week' \| '3day' \| 'day'` |
| `currentDate` | `Date` | The "anchor" date for navigation (not a range endpoint) |
| `events` | `CalendarEvent[]` | The current visible window of events (filled by `refreshEvents`) |
| `categories` | `Category[]` | All categories from the store — always a fresh array (required for Solid reactivity) |
| `showEventModal` | `{...} \| null` | Non-null opens `EventModal`; payload seeds the form |
| `showCategoryPanel` | `boolean` | Opens `CategoryPanel` |
| `showCalendarSettings` | `boolean` | Opens `CalendarSettings` |
| `dragState` | `DragState \| null` | Live drag state for create-by-drag or move-by-drag |
| `recurrenceAction` | `{...} \| null` | Pending recurrence edit/delete, opens `RecurrenceDialog` |
| `settings` | proxy | Thin adapter over the unified `appSettings.calendar` section (see Settings) |

### `currentView` write-tracking

Writing to `currentView.value` sets `userSwitchedView = true` (a module-level `let`). `CalendarView` uses `reconcileDefaultView` + `applyDefaultView` to sync the asynchronously-hydrated `defaultView` setting on first mount without overriding a manual user switch:

```typescript
// Pure decision: return new view to apply, or null for "leave it alone"
reconcileDefaultView(savedDefault, current, switched): ViewType | null
// Apply the saved default WITHOUT setting userSwitchedView
applyDefaultView(v: ViewType): void
```

### `showEventModal` payload

```typescript
{
  date?: string          // Pre-fill the date field when creating from a day click
  event?: CalendarEvent  // Edit mode when present
  masterId?: string      // Set alongside `event` for recurring occurrences
  occurrenceDate?: string // The specific occurrence date (for recurring edits)
  startTime?: string     // Pre-fill when created by a time-grid drag
  endTime?: string       // Pre-fill when created by a time-grid drag ≥15 min
}
```

### `DragState`

```typescript
type DragState =
  | { type: 'create'; date: string; startMinutes: number; currentMinutes: number }
  | { type: 'move'; event: CalendarEvent; masterId?: string; date: string;
      startMinutes: number; currentMinutes: number; offsetMinutes: number }
```

`TimeGrid` manages this: mousedown on an empty cell → `'create'` drag with ghost preview; mousedown on an event chip → `'move'` drag showing the chip at 30% opacity. On mouseup, `'create'` opens `EventModal` (with `startTime`/`endTime` pre-filled if the drag spans ≥15 min); `'move'` calls `store.updateEvent` directly. Snaps to 30-minute intervals (`SNAP_INTERVAL = 30`); grid height is fixed at `GRID_PX = 1200`.

---

## `refreshEvents`

`refresh.ts` derives the visible date range from the current view mode + `currentDate` and calls `store.getEventsForRange(start, end)` to populate the `events` signal. Also refreshes `categories`.

| View | Range |
|------|-------|
| `'month'` | First to last day of the calendar month |
| `'week'` | Week containing `currentDate` (7 days, respects `weekStartsOnMonday`) |
| `'3day'` | `currentDate` through `currentDate + 2` |
| `'day'` | `currentDate` only |

`CalendarView` calls `refreshEvents` on mount and in a `createEffect` that tracks `currentView.value`, `currentDate.value`, and `settings.value.weekStartsOnMonday` so any change re-derives the window automatically.

---

## View Components

### `CalendarView.tsx` (entry point)

Located in `app/src/bases/CalendarView.tsx`. Receives `basePath?: string` and `onChange?: () => void`. Instantiates `EventStore` with a `BaseBackend` (when `basePath` is set) or `MemoryBackend` (fallback). Mounts all four view sub-components under a `<Switch>` and renders the modal/dialog overlays outside the switch so they are always available.

All four view variants share the same global `events` / `categories` signals; there is no per-view refetch.

### `Toolbar.tsx`

Renders the `ViewBar` across the top of the calendar. Controls:

- **Today** button — sets `currentDate.value = new Date()`
- **← / →** chevrons — call `navigate(-1 | 1)`, advancing by 1 month / 1 week / 3 days / 1 day depending on `currentView.value`
- **Date breadcrumb** — `headerLabel()` formats differently per view:
  - `month`: `"May 2026"` (via `toLocaleString`)
  - `week`: `"2026-05-25 — 2026-05-31"`
  - `3day`: `"2026-05-27 — 2026-05-29"`
  - `day`: `"2026-05-27"`
- **View toggle** — `SegmentedToggle` over `[Month, Week, 3 Day, Day]`
- **Categories** — opens `CategoryPanel`
- **Settings** — opens `CalendarSettings`
- **+ Event** button — opens `EventModal` with the current anchor date

### `MonthView.tsx`

Renders a CSS grid of day cells. The grid always starts at the Monday or Sunday (per `weekStartsOnMonday`) of the week containing the 1st of the month, and extends to cover complete rows. Leading/trailing cells from adjacent months are shown dimmed (class `out`). Today's cell gets class `today`. Clicking a cell opens `EventModal` to create an event on that date. Each day's events are rendered as `EventChip` components.

### `WeekView.tsx` / `ThreeDayView.tsx` / `DayView.tsx`

All three delegate to `TimeGrid`, passing the appropriate array of `Date` objects (7 / 3 / 1 day(s)). The only difference is the date array passed as `props.dates`.

### `TimeGrid.tsx`

The shared time-column renderer used by week, 3-day, and day views.

- **Grid height**: `GRID_PX = 1200` px for the full 24-hour span.
- **Snapping**: all dragged times snap to 30-minute intervals.
- **Max minutes**: `MAX_MINUTES = 23 * 60 + 45` (23:45) to prevent overflow.
- **Sticky header**: day headers + all-day row are position-sticky so they stay visible while scrolling.
- **All-day row**: events with no `startTime` are rendered in the sticky all-day row via `EventChip`.
- **Timed events**: positioned absolutely by `(startMin / 1440) * GRID_PX` px from top. Duration ≤30 min gets 15 px of visual padding added (`visualDuration = duration + 15`) to remain legible.
- **Create drag**: mousedown on empty column area → ghost preview div with accent color; mouseup ≥15 min opens `EventModal` with pre-filled `startTime`/`endTime`; mouseup <15 min opens `EventModal` with only `startTime`.
- **Move drag**: mousedown on an event chip (threshold 4 px of movement to distinguish from a click) → chip fades to 30% opacity, ghost follows mouse; mouseup calls `store.updateEvent` directly (no recurrence dialog for moves).
- **Recurring event chips in TimeGrid**: `masterId` and `occurrenceDate` props are passed so `EventChip` can delegate to `RecurrenceDialog` on edit/delete.

### `EventChip.tsx`

The leaf component rendered in both month cells and time-grid columns.

- Background: `color-mix(in srgb, <categoryColor> 85%, transparent)`. No category → class `ghost` (outline only, no fill).
- Time display: `formatTime(startTime, military)`, optionally `— formatTime(endTime, military)`.
- Location and link metadata: hidden via `ResizeObserver` if the chip is too short to fit them without overflow.
- Right-click → `ContextMenu` portal (portaled to `document.body` to escape `overflow: hidden` on the chip).
- Click → `showEventModal.value = { event, masterId, occurrenceDate }`.

### `EventModal.tsx`

Full create/edit form. Fields: title, date, all-day toggle, start/end time, location, link, description (markdown — rendered as HTML preview on blur, editable on click), category picker, recurrence rule.

**Recurrence UI in EventModal:**

- `SegmentedToggle` for `[None, Daily, Weekly, Biweekly, Monthly]`
- When `weekly` or `biweekly`: day-of-week checkboxes `[Mon, Tue, Wed, Thu, Fri, Sat, Sun]` (Sunday = `0`). Defaults to the weekday of the event's date.
- Optional end-date field (shown for any non-None type).
- `seriesId` is preserved from the existing event when editing; a fresh UUID is generated when creating.

**Keyboard shortcuts**: `Enter` (when not in textarea/select) → save; `Backspace` (when not in input/textarea/select) → delete; `Escape` → close (handled by `<Modal>`).

**Saving a recurring occurrence**: if `modal.masterId` and `modal.occurrenceDate` are set, saving sets `recurrenceAction.value` instead of calling `store.updateEvent` directly, so `RecurrenceDialog` can ask the user for scope.

### `CategoryPanel.tsx`

Modal for managing the category list. Supports:

- **Rename**: double-click a category name → inline `<input>` (Escape cancels, Enter/blur commits). Rename propagates to all events referencing the old name via `store.updateCategory`.
- **Recolor**: click the color chip → palette popover with 7 theme swatches + a custom `<input type="color">` well. Clicking outside the chip/popover closes it.
- **Delete**: `×` button; tries to reassign events to a category named `"Uncategorized"` or `"Default"` if one exists (the `CategoryPanel` passes this as `reassignTo`); otherwise clears the category field on affected events.
- **Add**: text input + color chip for the new category; Enter key triggers add (when not renaming).

Default new-category color seeded from `settings.calendar.defaultCategoryColor` (the `appSettings` unified store, not a local signal).

### `CalendarSettings.tsx`

Modal for mapping base note columns to calendar event fields. Reads the base config via `api.base(basePath)` and writes each mapping back via `api.setProperty(basePath, key, value)`. Column options are the union of the standard columns (`date`, `startTime`, `endTime`, `recurrence`, `category`, `title`, `location`, `link`) and any columns actually found in the base's rows.

| Field key | Role | Required | Default column |
|-----------|------|----------|----------------|
| `dateField` | Date | Yes | `date` |
| `startTimeField` | Start-time | No | `startTime` |
| `endTimeField` | End-time | No | `endTime` |
| `recurrenceField` | Recurrence | No | `recurrence` |
| `categoryField` | Category | No | `category` |

---

## Settings

Calendar settings live in `.settings` (the single hidden vault-root settings file) under the `calendar:` section. They are read via the unified `appSettings` store (`app/src/settings.ts`) and proxied through the `settings` adapter in `calendar/state.ts` so existing calendar code retains the `settings.value.X` access shape.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `calendar.defaultView` | `"month" \| "week" \| "3day" \| "day"` | `"week"` | View shown on first open |
| `calendar.weekStartsOnMonday` | boolean | `true` | Week grid starts Monday (ISO) vs Sunday |
| `calendar.militaryTime` | boolean | `false` | 24-hour clock in time labels |
| `calendar.monthCellMinHeight` | number (px) | `80` | Min height of a day cell in month view |
| `calendar.timeGutterWidth` | number (px) | `50` | Width of the hour-label gutter in week/day views |
| `calendar.defaultCategoryColor` | string (hex) | `"#4a90e2"` | Default color pre-filled for new categories |

Settings are **not** stored in `localStorage` — they persist in `.settings` via `POST /set-setting` (the backend is the single writer).

---

## Testing

Tests use Bun's native test runner:

```bash
bun test core -- calendar   # run calendar tests
```

Key test files:

- `app/src/calendar/EventStore.test.ts` — covers add/delete/edit for non-recurring events, daily recurrence expansion, `deleteOccurrence`, `editSeries`, `editFollowing` (including rule-type changes), and category delete reassignment.
- `app/src/calendar/dates.test.ts` — covers `toDateStr`, `addDays`, `formatTime`, `expandRecurrence` for all four rule types, `endDate` truncation, monthly edge cases (31st → Feb 28/29, 30-day months), `startOfWeek` (both Sunday-first and Monday-first, including "on the boundary day" cases), and `weekRange`.
- `app/src/calendar/state.defaultView.test.ts` — covers `reconcileDefaultView` pure logic.
- `app/src/calendar/state.settings.test.ts` — covers the unified-settings adapter.

---

## Gotchas and Edge Cases

- **Global signals, one calendar at a time**: `currentView`, `currentDate`, `events`, `categories`, and `showEventModal` are module-level singletons. Opening two calendar panes simultaneously would race on shared state. In practice the UI routes one calendar at a time.
- **`toDateStr` is local time**: always suffix `"T00:00:00"` when constructing `new Date` from ISO strings to avoid UTC-midnight/timezone-offset mismatches. The internal `EventStore.ts` and `dates.ts` do this consistently.
- **Recurring events are expanded at read time**: `getEventsForRange` iterates the master segments and calls `expandRecurrence`. There is no pre-expanded table. Each `EventChip` for a recurring occurrence carries its master's `id` as `masterId` and the specific occurrence date as `occurrenceDate`.
- **`getCategories()` always returns a new array**: required because Solid signals skip updates when the reference is unchanged. The `categories.value = store.getCategories()` assignment after every mutation propagates reactivity.
- **`save()` in `BaseBackend` is fire-and-forget**: a slow or failed write will not surface an error to the user. The next server version poll will show the last successfully-written state.
- **`biweekly` week-parity**: the even/odd week is counted from `startDate`, not from any calendar epoch. Two series that start on different weeks will fire on alternating weeks relative to each other even if they share the same `daysOfWeek`.
- **Category deletion with no `reassignTo`**: calling `store.deleteCategory(name)` (without a second argument) sets `category: undefined` on affected events (verified in test). In `CategoryPanel`, the code tries to find a `"Uncategorized"` or `"Default"` category as a stable reassignment target before passing it; there is no fallback beyond that.

Source: core/src/calendar.ts, cli/src/commands/calendar.ts, app/src/calendar/EventStore.ts, app/src/calendar/dates.ts, app/src/calendar/categoryColor.ts, app/src/calendar/components/RecurrenceDialog.tsx, app/src/calendar/types.ts, app/src/calendar/state.ts, app/src/calendar/refresh.ts, app/src/calendar/components/EventModal.tsx, app/src/calendar/components/EventChip.tsx, app/src/calendar/components/CategoryPanel.tsx, app/src/calendar/components/Toolbar.tsx, app/src/calendar/components/CalendarSettings.tsx, app/src/calendar/components/views/MonthView.tsx, app/src/calendar/components/views/TimeGrid.tsx, app/src/bases/CalendarView.tsx, app/src/bases/calendarBase.ts, app/src/bases/calendarSerialize.ts, app/src/calendar/EventStore.test.ts, app/src/calendar/dates.test.ts, core/src/schema/settingsSchema.ts, core/src/gcal/sync.ts, core/src/settings.ts
