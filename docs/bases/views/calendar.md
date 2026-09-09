# Calendar View

The calendar view is one Bases view kind with **two registers**: the full-featured event calendar (month / week / 3-day / day modes, drag-to-create, drag-to-move, recurrence, and category colors) that runs entirely inside a `type: base` markdown file, and a **tasks register** that draws checkbox tasks on the same grid instead of events. There is no standalone calendar page and no separate file extension: any base can become a calendar by declaring `view: calendar` (shorthand) or `views: [{ type: calendar }]` in its YAML frontmatter. Events are stored as rows in the base file body using the same canonical row format every base uses — a YAML list of row objects (a legacy GFM pipe table is still read back-compat); categories are stored as a YAML list under the `categories` key in frontmatter. All calendar settings (default view, week-start, time format) live in the unified `.settings` under the `calendar` section.

**In this doc:** declaring a calendar base and its on-disk event/recurrence format → the four view modes and navigation → event chips and the event modal → category colors → global calendar settings vs. per-base column mapping → the storage backend and Google Calendar sync → reactive state, range calculation, and keyboard shortcuts → the [tasks register](#tasks-register) (`calendarContent: tasks`) → gotchas.

Everything from here through [Storage Backend](#storage-backend) describes the **events register** (`calendarContent` absent, or explicitly `events` — the default). The tasks register is its own section, [below](#tasks-register).

---

## Making a Base a Calendar

### Minimal frontmatter

```yaml
---
type: base
view: calendar
---
```

`view: calendar` is the shorthand form. It is equivalent to:

```yaml
---
type: base
views:
  - type: calendar
    name: Calendar
---
```

Both forms are handled by `parseBaseFile` in `core/src/bases/parse.ts`. The shorthand `view:` key wins only when no explicit `views:` array is present. The resulting base is routed to `CalendarView` by `BaseView.tsx` whenever `activeType() === "calendar"`.

### With an explicit column schema

```yaml
---
type: base
view: calendar
schema: { title: text, date: date }
---
```

Adding a `schema` key is optional but recommended — it documents the expected types. The serialiser preserves every frontmatter key across saves, so `schema`, `source`, and any other top-level keys are not clobbered.

### With categories pre-declared

```yaml
---
type: base
view: calendar
categories:
  - name: Work
    color: "#b00020"
  - name: Personal
    color: teal
---
```

`categories` is a YAML list of `{name, color}` objects. The `color` field accepts either a CSS hex string (`"#b00020"`) or a theme token (one of `accent`, `teal`, `blue`, `violet`, `green`, `gold`, `rose`) — see [Category Colors](#category-colors) below.

---

## On-Disk Event Format

Events are stored as rows in the base file body using the **same canonical row format every base uses** — there is no calendar-specific serialisation. `parseCalendarFile` (`calendarSerialize.ts`) calls `parseRows(body, meta)` (`core/src/bases/rows.ts`) directly, and `serializeCalendarFile` calls `serializeRows(events.map(eventToRow))` with **no `columnOrder` argument**.

- **Canonical form: a YAML list of row objects**, one per event. `serializeRows` with no `columnOrder` falls back to `Object.entries(r.note)` — i.e. each object's own key **insertion order** — and drops any key whose value is `undefined` (so an absent field never serializes as `key: null`). `eventToRow` always builds the object in the same field order (`id, title, date, startTime, endTime, location, link, description, category, categories, recurrence, localUpdated`), so the emitted key order is stable in practice, but it is a byproduct of that insertion order, not a column schema enforced by the serialiser.
- **Back-compat: a GFM pipe table.** `parseRows` still reads an older-style pipe table (a header line with a pipe followed by a `|---|---|` separator, detected by `looksLikeTable`) via `parseMarkdownTable`, so a calendar base saved before the YAML-list format shipped still loads. `serializeCalendarFile` never writes a table — the next save of any calendar base rewrites its body as the canonical YAML list.

```yaml
---
type: base
view: calendar
categories:
  - name: Work
    color: "#b00020"
---

- id: a1
  title: Standup
  date: 2026-05-30
  startTime: "09:00"
  category: Work
- id: b2
  title: Weekly sync
  date: 2026-05-25
  startTime: "14:00"
  endTime: "15:00"
  category: Work
  recurrence: '{"type":"weekly","daysOfWeek":[1],"startDate":"2026-05-25","seriesId":"s1"}'
```

### Event row fields

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | UUID, auto-generated on create |
| `title` | `string` | Event title |
| `date` | `"YYYY-MM-DD"` | The event's primary date |
| `startTime` | `"HH:MM"` or absent | Omit for all-day events |
| `endTime` | `"HH:MM"` or absent | Sets block height in time-grid views |
| `location` | `string` | Free-text location |
| `link` | `string` | URL opened by the chip link button |
| `description` | `string` | Markdown — rendered with marked in the modal |
| `category` | `string` | Must match a name in `frontmatter.categories`; uncategorised events render as a ghost (outline-only) chip |
| `categories` | JSON array string, or absent | Multiple categories per event. `eventToRow` serialises `event.categories` (a `string[]`) as `JSON.stringify(e.categories)`, and only when it has at least one entry; `rowToEvent` reads it back, tolerating an already-parsed array or a bare single string. |
| `recurrence` | JSON string or absent | A `Recurrence` object serialised as JSON — see [Recurrence](#recurrence) |

All fields except `id`, `title`, and `date` are optional. Absent values are simply omitted from the row object (`serializeRows` drops `undefined` values rather than writing them as `null`).

### Recurrence storage

Recurrence is stored as a JSON string value in the row's `recurrence` field (not as a nested YAML structure):

```json
{"type":"weekly","daysOfWeek":[1],"startDate":"2026-05-25","endDate":"2026-06-30","seriesId":"s1"}
```

It is encoded/decoded by `calendarSerialize.ts` using `JSON.stringify` / `JSON.parse`. Malformed JSON is silently dropped.

---

## The `CalendarEvent` Type

```ts
interface CalendarEvent {
  id: string
  title: string
  date: string          // "YYYY-MM-DD"
  startTime?: string    // "HH:MM" — undefined = all-day
  endTime?: string
  location?: string
  link?: string
  description?: string
  // Single category (legacy + backward-compatible). When an event belongs to multiple
  // categories, `categories` holds the full ordered list and `category` mirrors the first
  // (so single-category events, Google Calendar color mapping, etc. keep round-tripping).
  category?: string
  categories?: string[]
  recurrence?: Recurrence
  localUpdated?: string // ISO timestamp stamped on every local create/edit (EventStore);
                        // the Google Calendar last-write-wins tiebreaker against the remote `updated`
}
```

---

## Recurrence

### `Recurrence` type

```ts
interface Recurrence {
  type: RecurrenceType           // 'daily' | 'weekly' | 'biweekly' | 'monthly'
  daysOfWeek?: number[]          // 0–6, Sunday=0; used for weekly/biweekly
  startDate: string              // "YYYY-MM-DD" — series start
  endDate?: string               // "YYYY-MM-DD" — if absent, runs to year 2100
  seriesId: string               // UUID grouping all master segments of a series
}
```

### Recurrence types

| Type | Behaviour |
|---|---|
| `daily` | Fires every calendar day from `startDate` to `endDate` |
| `weekly` | Fires on days in `daysOfWeek` each week. If `daysOfWeek` is absent, defaults to the weekday of `startDate` |
| `biweekly` | Fires on days in `daysOfWeek` every other week. Week-offset counted from `startDate` |
| `monthly` | Fires on the same day-of-month as `startDate`. If `startDate` is day 29/30/31, clamps to the last day of shorter months (e.g. Jan 31 → Feb 28 in a non-leap year) |

### Recurrence expansion

`expandRecurrence(recurrence, rangeStart, rangeEnd)` (in `calendar/dates.ts`) iterates day-by-day from `max(recurrence.startDate, rangeStart)` to `min(recurrence.endDate ?? '2100-01-01', rangeEnd)` and calls `matchesRecurrence` on each day. Only matching days are returned.

### Editing and deleting recurring events

When the user edits or deletes a recurring event, a `RecurrenceDialog` modal prompts for scope:

| Button | Scope | Behaviour |
|---|---|---|
| "Just this one" | `one` | Splits the series at this date: truncates the master's `endDate` to the day before, creates a one-off event for this occurrence (edit) or no event (delete), and optionally adds a new master segment for the days after |
| "This and following" | `following` | Truncates the master's `endDate` to the day before the occurrence. For edits, creates a new master segment starting at the occurrence with a new `seriesId` |
| "All" | `all` | Edits or deletes every master event sharing the same `seriesId` |

The split strategy is implemented in `EventStore.ts` methods `editOccurrence`, `editFollowing`, `editSeries`, `deleteOccurrence`, `deleteFollowing`, `deleteSeries`.

---

## View Modes

There are four view modes controlled by the Toolbar's segmented toggle. The mode is stored in a reactive Solid signal (`currentView` in `calendar/state.ts`), not in the base file.

| Mode | `ViewType` | Navigation unit | Time grid |
|---|---|---|---|
| Month | `"month"` | 1 month | No — grid of date cells |
| Week | `"week"` | 7 days | Yes — 24-hour vertical columns |
| 3 Day | `"3day"` | 3 days | Yes |
| Day | `"day"` | 1 day | Yes |

### Month view

- Renders a CSS grid of 7-column week rows.
- Leading and trailing days from adjacent months fill incomplete rows (rendered dim with class `out`).
- Each day cell shows its event chips stacked vertically.
- Clicking an empty cell opens the `EventModal` to create an event on that date.
- Week column headers follow the `weekStartsOnMonday` setting (Mon–Sun or Sun–Sat).

### Week / 3-day / Day views (TimeGrid)

All three share the `TimeGrid` component. The grid is 1200px tall (`GRID_PX = 1200`), representing 24 hours. All-day events (no `startTime`) are rendered in a fixed header row above the scrollable time grid.

- **Drag-to-create**: Mouse-down on an empty column area begins a "create" drag, tracking the pointer's **running maximum** displacement from where the press started (not the live or final distance — a press that wanders out past the threshold and back to its origin still counts as a drag). On mouse-up, `computeCreatePayload` (`app/src/calendar/components/views/timeGridDrag.ts`) decides the payload: a press that never exceeded `DRAG_DEADZONE_PX = 4` (exclusive — exactly 4px still counts as a click) opens `EventModal` with only `startTime`; a genuine drag opens it with both `startTime` and `endTime`, flooring the end to a full `SNAP_INTERVAL` (30 min) when the snapped span comes out under that — pulling `start` back instead when the drag is flush against the end of the day, since `endTime` can't be clamped past `MAX_MINUTES`. Distance is measured as `Math.hypot(dx, dy)`, so a diagonal wobble isn't treated as directional. Before this deadzone existed the threshold was zero pixels, so a trackpad wobble during an intended click floored a 30-minute event while a perfectly still click did not.
- **Drag-to-move**: Mouse-down on an existing event chip triggers a "move" drag once the pointer moves **4px or more on either axis** — `TimeGrid.tsx`'s `onChipMouseDown` returns early only while both `|dy|` and `|dx|` are under 4px, with vertical movement retiming the event and horizontal movement moving it to another day. On release, `store.updateEvent` is called with the new `startTime` / `endTime` (and `date`, if the drop landed on a different day).
- Both drags snap to 30-minute intervals (`SNAP_INTERVAL = 30`, in `timeGridDrag.ts`).
- Short events (≤ 30 min duration) are rendered 15px taller than their true duration for legibility.
- If an event ends before it starts (data error), `endMin` is forced to `startMin + 15`.

---

## Toolbar and the View Bar

The calendar contributes its controls to the base pane's ONE `ViewBar` rather than rendering a bar
of its own. `app/src/calendar/components/Toolbar.tsx` exports `calendarSlots(): ViewBarSlots` — a
function returning slots, not a component — and `BaseView.tsx` reads it through a `createMemo`
(`viewSlots`) whenever `activeType() === 'calendar'`, feeding the result into the props of the one
`<ViewBar>` it owns. `CalendarView.tsx` renders no `<Toolbar>` of its own; a second call site is
exactly how a calendar base used to show two stacked bars.

`ViewBar` (`app/src/ui/ViewBar.tsx`) takes six named regions, and a control's region is decided by
the **question it answers**, not its shape:

| Region | Question |
|---|---|
| `identity` | What am I looking at? |
| `locus` | Where am I inside it, and how do I move? |
| `facet` | Which projection of the same thing? |
| `readouts` | What is its state right now? |
| `config` | Which settings govern this session? |
| `actions` | Do a thing. |

`calendarSlots()` fills three of them:

- **`locus`** — `DateNav` (prev/next, Today, the range label — see [Navigation](#navigation) below)
  followed by the `[Month, Week, 3 Day, Day]` view-mode `SegmentedToggle`. It lives in `locus` rather
  than `facet`: "which span of time is on screen" is the same question the date navigation answers,
  and a calendar base's own `facet` slot is reserved for the base's OWN view tabs when it has more
  than one view.
- **`config`** — the Categories button, toggling `showCategoryPanel`.
- **`actions`** — the + Event button, opening `EventModal` seeded with the current anchor date.

The Settings gear is not part of `calendarSlots()` — `BaseView.tsx` renders a settings action for
every base type in its own `actions` group and routes it to `showCalendarSettings` for a calendar
base instead of the generic settings overlay.

---

## Navigation

Navigation and the range label live in `DateNav` (`app/src/calendar/components/DateNav.tsx`), the
`locus`-region cluster that `Toolbar.tsx`'s `calendarSlots()` contributes to the base's one `ViewBar`
(see [Toolbar and the view bar](#toolbar-and-the-view-bar) below). It holds prev / next chevrons and
a "Today" button:

| Action | Month | Week | 3 Day | Day |
|---|---|---|---|---|
| Previous / Next | ±1 month | ±7 days | ±3 days | ±1 day |
| Today | Jumps to today's date |

Previous/Next call `stepDate(currentDate.value, currentView.value, dir)`; Today sets
`currentDate.value = new Date()` directly.

**The range label is NOT an ISO date range.** It comes from `rangeLabel(d, view, mondayFirst)`
(`app/src/calendar/dates.ts`), which returns both a `long` and a `short` form — the toolbar collapses
to the short one in a narrow pane, since CSS can't rewrite text. Both forms are built by dropping
whatever the two ends of the span already agree on (`spanLabel`), not by concatenating two ISO
strings:

| View | `long` | `short` |
|---|---|---|
| Month | `"May 2026"` | `"May 2026"` |
| Week (Mon 2026-05-25 – Sun 2026-05-31, same month) | `"25 – 31 May 2026"` | `"25 – 31 May"` |
| 3 Day (2026-05-27 – 2026-05-29) | `"27 – 29 May 2026"` | `"27 – 29 May"` |
| Day (2026-05-27) | `"Wed 27 May 2026"` | `"Wed 27 May"` |
| Week spanning a month boundary (2026-01-29 – 2026-02-04) | `"29 Jan – 4 Feb 2026"` | same, no year |
| Week spanning a year boundary (2025-12-29 – 2026-01-04) | `"29 Dec 2025 – 4 Jan 2026"` | same, no years |

The year is dropped from the `short` form and, within `spanLabel`, from whichever endpoint shares it
with the other; the month name is dropped from the left endpoint when both ends fall in the same
month. There is no `headerLabel()` function — this table is `rangeLabel`'s real output, produced
entirely by `spanLabel` + `monthName`, both pure and colocated in `dates.ts`.

---

## Event Chips

`EventChip` renders each event as a colored chip. Behaviour:

- **Background color**: `color-mix(in srgb, <category-color> 85%, transparent)`. Events with no matching category render without a background (`ghost` CSS class — outline only).
- **Time display**: If `startTime` is set, rendered as `HH:MM — HH:MM` (12h) or `HH:MM` (24h) per `militaryTime` setting. The `formatTime` function strips the leading zero: `"13:05"` → `"1:05"` in 12h mode.
- **Meta row**: `location` and/or `link` shown below the title. The meta row is hidden via `ResizeObserver` if it overflows the chip height.
- **Click**: Opens `EventModal` in edit mode.
- **Right-click**: Shows a context menu with Edit and Delete options.

---

## Event Modal

The `EventModal` dialog handles both create and edit. Fields:

| Field | UI element | Stored in |
|---|---|---|
| Title | Plain text `<input>` | `CalendarEvent.title` |
| Date | Date picker | `CalendarEvent.date` |
| All-day toggle | Toggle switch | Absence of `startTime`/`endTime` |
| Start time / End time | Time pickers (shown when not all-day) | `CalendarEvent.startTime`, `endTime` |
| Location | Text input | `CalendarEvent.location` |
| Link | Text input | `CalendarEvent.link` |
| Description | Markdown textarea / rendered preview | `CalendarEvent.description` |
| Category | Chip picker from existing categories | `CalendarEvent.category` |
| Repeat | Segmented toggle (None/Daily/Weekly/Biweekly/Monthly) | `CalendarEvent.recurrence` |
| Days-of-week | Shown for Weekly/Biweekly | `Recurrence.daysOfWeek` |
| Ends | Optional date picker shown when any repeat is set | `Recurrence.endDate` |

### Keyboard shortcuts in modal

| Key | Action |
|---|---|
| `Enter` (not in textarea/select) | Save event |
| `Backspace` (not in input/textarea/select) | Delete event |
| `Escape` | Close modal |

### Description field

The description field renders as a plain textarea during edit and as sanitised markdown (via `renderMarkdown`) when blurred and non-empty. Click the rendered preview to return to edit mode.

### Recurrence: days-of-week

For `weekly` and `biweekly`, a day-of-week picker is shown: Mon–Sun mapped to integers 0–6 (Sunday=0). Defaults to the weekday of the event's date. Multiple days can be selected simultaneously (multi-select toggle buttons).

---

## Category Colors

Categories are named event groups with associated colors. The `CategoryPanel` modal manages them.

### Color storage

Colors are stored as either:

1. A **theme token** string: one of `accent`, `teal`, `blue`, `violet`, `green`, `gold`, `rose`. These map to `var(--<token>)` CSS variables, so the category automatically recolors when the user changes the app theme.
2. A **CSS hex string**: e.g. `"#b00020"`. These are literal hex values from the native color picker.

```ts
export const THEME_SWATCHES = ["accent", "teal", "blue", "violet", "green", "gold", "rose"] as const;
```

`resolveCategoryColor(color)` converts the stored value to a usable CSS value:
- Theme token `"teal"` → `"var(--teal)"`
- Hex `"#b00020"` → `"#b00020"` (pass-through)
- `undefined` → `"var(--accent)"` (fallback)

`categoryColorHex(color)` converts to a concrete hex for the native `<input type="color">` (which cannot display `var(...)`). It reads the computed CSS property off `:root` for theme tokens.

### Category CRUD

| Action | Method |
|---|---|
| Add | `store.addCategory({ name, color })` |
| Rename | `store.updateCategory(oldName, { name })` — also renames the category on all events |
| Recolor | `store.updateCategory(name, { color })` |
| Delete | `store.deleteCategory(name, reassignTo?)` — events are reassigned to `reassignTo` (if given) or have their `category` cleared (`undefined`) |

When deleting, the UI looks for a stable fallback: the first category named `"Uncategorized"` or `"Default"` is used as the reassign target. If no such category exists, `deleteCategory` is called without a `reassignTo`, clearing the field.

---

## Calendar Settings

Global calendar display settings live in `.settings` under `calendar:`. Like every other setting, they are edited in `.settings` itself — there is no GUI for them (see [settings overview](../../settings/overview.md)). The "Settings" button in the calendar toolbar opens `CalendarSettings.tsx`, which is a different thing: the PER-BASE field-mapping modal (which note column backs each calendar field) plus the Google Calendar sync panel.

### `settings.calendar` keys

| Key | Type | Default | Description |
|---|---|---|---|
| `defaultView` | `"month" \| "week" \| "3day" \| "day"` | `"week"` | The view selected when the calendar first opens |
| `weekStartsOnMonday` | `boolean` | `true` | Whether the week begins on Monday (ISO standard) or Sunday |
| `militaryTime` | `boolean` | `false` | Use 24-hour time in chips and the time grid gutter |
| `defaultCategoryColor` | `string` | `"#4a90e2"` | Default hex color pre-filled when creating a new category |

### Default view hydration

There is a known timing issue: `state.ts` seeds `currentView` from the synchronous `DEFAULTS` (`"week"`) at module-load time, before `.settings` has been fetched. `CalendarView.tsx` runs a one-shot reactive effect that reconciles `currentView` with the hydrated `settings.value.defaultView` once settings arrive, using the pure helper:

```ts
reconcileDefaultView(savedDefault: ViewType, current: ViewType, switched: boolean): ViewType | null
```

- Returns `null` (no-op) if the user has manually switched view or if `current` already matches `savedDefault`.
- Returns the saved default otherwise, applied via `applyDefaultView()` (which does NOT set `userSwitchedView = true`, so a programmatic reconcile is never treated as a user action).

---

## Column Mapping (CalendarSettings Modal)

The "Settings" button in the toolbar opens a field-mapping dialog (`CalendarSettings.tsx`) that controls which table columns the calendar reads for each role. This is persisted as top-level frontmatter keys on the base file (flat `setProperty` calls — no nested `views:` editing required).

| Key | Default column | Required | Description |
|---|---|---|---|
| `dateField` | `date` | Yes | Which column contains the event date. Required |
| `startTimeField` | `startTime` | No | Column for start time (week/day views) |
| `endTimeField` | `endTime` | No | Column for end time (block height) |
| `recurrenceField` | `recurrence` | No | Column holding the JSON repeat rule |
| `categoryField` | `category` | No | Column driving the chip color |

These keys configure the first view in the `views` array (via `parseBaseFile` in `parse.ts` — top-level field binding keys are automatically applied to `config.views[0]`). If a field mapping key is absent, the default column name is used.

The dropdown for each field lists: the standard columns (`date`, `startTime`, `endTime`, `recurrence`, `category`, `title`, `location`, `link`), plus any columns actually present in the existing event rows.

### Google Calendar sync (per-calendar)

The same settings panel (`GcalSyncPanel.tsx`) also carries the **per-calendar** Google sync linkage, persisted as two more top-level frontmatter keys (folded into `config.views[0]` like the field bindings above):

| Key | Default | Description |
|---|---|---|
| `googleCalendarSync` | `false` (absent) | Whether two-way Google Calendar sync is enabled for THIS calendar base. |
| `googleCalendarId` | `primary` | Which Google calendar this base syncs with (`primary` = main; or paste another calendar's ID). |

A vault can have several calendar bases, each synced with a different Google calendar. Connection-level config (conflict policy, cadence, timezone) lives in the global `googleCalendar` settings; see [Google Calendar sync](../../gcal/overview.md).

---

## Storage Backend

`CalendarView` selects a backend based on whether `basePath` is provided:

| Condition | Backend | Storage |
|---|---|---|
| `basePath` provided | `BaseBackend` | `PUT /file` writes the base `.md` file |
| No `basePath` | `MemoryBackend` | In-memory only (lost on unmount) |

`BaseBackend` (`bases/calendarBase.ts`) implements `CalendarStorage`:

1. `init()` — reads the base file via `api.read`, parses frontmatter + events with `parseCalendarFile`.
2. `load()` — returns the in-memory `EventsFile` snapshot (synchronous, called right after `init()`).
3. `save(data)` — writes back to disk with `api.write`. Fire-and-forget: saves preserve all original frontmatter keys (schema, source, etc.) and rewrite only the `categories` key and the event rows (the YAML list body). No full cache invalidation — the version poll reflects truth on next read.

---

## Tasks Register

**New view option: `calendarContent: 'events' | 'tasks'`, default `events`.** This mirrors the
cards view's `cardContent` — one view kind, a register enum picking what each cell draws. In
`calendarContent: tasks`, `CalendarView` renders resolved task **rows** (the same
`ViewResult`/`Row[]` pipeline every other row-based Bases view — table, cards, list — already
uses) instead of reading the base file's own event table through `BaseBackend`/`EventStore`.
`calendarContent: events` (or the key absent) is the events register documented above, entirely
untouched by the tasks register existing.

```yaml
---
type: base
source: tasks
views:
  - type: calendar
    calendarContent: tasks
---
```

`app/src/bases/CalendarView.tsx` is a thin gate on `calendarContent`: it mounts either
`EventsCalendar` (the pre-existing UI, above) or `TasksCalendar`, and a **live** flip of
`calendarContent` (editing the base's frontmatter with the pane still open) unmounts one and
mounts the other fresh — so an events register's `EventStore`/`BaseBackend` never sits around
stale while the tasks register is showing, and vice versa.

Tasks are **all-day only**. Month view stacks task chips in each day cell exactly like event
chips; week/3-day/day render them in the all-day gutter (`TaskAllDayStrip.tsx`, sharing
`TimeGrid`'s own header row + all-day row CSS classes so the two registers line up pixel-for-pixel
where they share a shape) — the hourly time grid is never used in this register.

### Where a task's rows come from

A tasks calendar works over **either kind of base**:

| The base | Rows come from |
|---|---|
| `source: tasks` (as above) | vault checkbox tasks, resolved through the normal `source: tasks` pipeline (`core/src/bases/source.ts` → `buildTaskRows`) — see [tasks syntax](../../tasks/syntax.md) |
| no `source:` (the base owns its rows) | the base file's own inline row table, same as any self-owned base — a row's `note.*` fields must use the same names a task row carries (`description`, `resolved`, `statusChar`, `scheduled`/`due`) for it to render and behave as a task |

`dateField` is deliberately **absent** by default. Without it, placement falls back to
scheduled-then-due (below); setting it explicitly pins the view to ONE field and turns that
fallback off.

### Placement: scheduled first, due as the fallback

A task with a `scheduled` date sits on it. A task with no `scheduled` date sits on its `due`
date. A task with **neither** does not appear on the grid at all. When `dateField` is set
explicitly, that field wins outright and no fallback applies.

The reasoning: the grid answers "when am I doing this", and the deadline (`due`) only places the
chip when that has not been decided (no `scheduled` date yet).

This logic is pure and lives in `app/src/calendar/taskPlacement.ts`'s `placedDate(row,
dateField?)` — the same module the write-back (drag reschedule, below) reads to know WHICH field
to rewrite, so the grid and the write path can never disagree about where a task sits.

### Overdue tasks roll onto today, WITHOUT the line being rewritten

An unfinished (not `resolved`) task whose placed date is **before today** renders in **today's**
cell, never on its original day — nothing falls off the back of the calendar. Critically, **the
markdown line itself is not touched**: rolling a carried task onto today is a pure read-time
placement decision (`placeRows` in `taskPlacement.ts`), not a write. The task's `scheduled`/`due`
field keeps its original value on disk; only the chip's on-screen bucket moves, every time the
page re-renders, until the task is either completed/cancelled or dragged to a new day (which IS a
write — see below).

The carried register — chosen from rendered mockups against the real theme tokens, the user's own
words for the goal being *"info from the quiet and look of alarm"*:

- Box: `color-mix(in srgb, var(--danger) 12%, transparent)` fill, `1px solid var(--danger)`.
- The `[ ]` marker: `var(--danger)`.
- The description: `var(--fg)`, normal ink — stays readable, not additionally alarmed.
- A trailing `Nd late` in `var(--danger)`.

A task placed on today itself (never carried, `late === 0`) reads as ordinary text with no box at
all — the box means "carried from a day that passed", not "due today". A **resolved** task (done
or cancelled) never carries forward, even if it's overdue and unfinished-looking by its dates: it
stays on its own original day, since `placeRows` only carries unresolved rows.

### Chip behavior

**Every writing interaction — toggle, status menu, drag — is gated by ONE predicate,
`isTaskLine(task)` (`app/src/calendar/taskPlacement.ts`): does the row carry a real markdown line
number (`note.line`) AND a resolvable placement field.** A `source: tasks` row always does. A
self-owned base's row never does — it's a YAML row, not a markdown line. The marker, the drag
gesture and the context menu all read this ONE function rather than three separate checks, so
they cannot silently disagree about which rows are writable (see
[the self-owned-row limitation](#creating-a-task--task) below for what that means in practice).

- **Left-click the `[ ]` marker** toggles the task, writing back through `POST /tasks/toggle` by
  path + line (the SAME endpoint every other row-based task view uses — `ListView.tsx`, the cards
  view) — but only when `isTaskLine` is true. When it is false, the marker renders **dimmed and
  inert** (`opacity: 0.4`, `aria-disabled="true"`, `TaskChip.module.css`'s `.readOnly`): clicking
  it does not toggle, and the click falls through to the chip's own open-on-click instead of
  landing in a silent dead zone.
- **Right-click the marker** opens the shared status menu (`app/src/taskStatusMenu.tsx` —
  same affordance the cards view and `ListView.tsx` already use) when `isTaskLine` is true,
  offering every status OTHER than the task's current one; picking one calls `POST /tasks/toggle`
  with an explicit `status` char. When `isTaskLine` is false, right-click does nothing special —
  no custom menu, no error.
- **Clicking the chip body** opens the source note at that line (`bismuth-open` event) —
  unconditionally, whether or not the row is writable.
- **Dragging a chip to another day** (native HTML5 drag-and-drop — `draggable` on the chip,
  `dragover`/`drop` on the day cell) reschedules it, when `isTaskLine` is true: `POST
  /tasks/reschedule` rewrites the ONE field that PLACED the task — `scheduled` or `due`, whichever
  `placementField` (`taskPlacement.ts`) resolved at drag-start, computed the same way `placedDate`
  picks scheduled over due — to the dropped-on day, always in **bracket form** regardless of the
  line's current spelling (see [tasks syntax → rescheduling a date field](../../tasks/syntax.md#rescheduling-a-date-field)).
  This is the ONLY way a carried task's stored date ever changes: rolling onto today (above) never
  touches the file. A row failing `isTaskLine` is not `draggable` at all — there is no "source
  markdown line" for a drop to rewrite.

The day cell's own `mousedown`-based drag (the events register's drag-to-move/drag-to-create,
above) and its `click`-based "new event" affordance are both suppressed in the tasks register — a
grid cell in this register says which DAY, never opens a modal on a bare click (creation is the
toolbar's `[ + task ]` action below), and the chip stops `click`, `mousedown`, `pointerdown` and
`dblclick` on its own marker so toggling never also opens the note or starts a drag on the
underlying cell.

### Creating a task: `[ + task ]`

The tasks register's toolbar `actions` slot swaps the events register's `[ + event ]` for
`[ + task ]` (`calendarSlots(ctx)` in `Toolbar.tsx`, now taking an optional context object —
`isTasks`, `basePath`, `ownsRows`, `taskFile` — that `BaseView.tsx` computes from the active
view/base config). What it writes depends on which kind of base is open, the SAME distinction as
[Where a task's rows come from](#where-a-tasks-rows-come-from) above:

| The base | A task is | `[ + task ]` writes |
|---|---|---|
| owns its rows (no `source:`) | a row in the base file | a new row via `upsertRow` (`core/src/bases/rowOps.ts`, through `POST /row/update` — the SAME write path the CLI `base`/`card` groups and `EditCardsModal` already use; nothing new invented) |
| sources tasks (`source: tasks`) | a checkbox line in a note | a line appended to the note named by `taskFile`, dated with the currently-viewed day as `[scheduled <day>]` |

**A self-owned base's task can be CREATED from the grid but not COMPLETED from the grid.** This is
a real, permanent limitation, not a bug: [tasks are fundamentally a checkbox LINE](../../tasks/syntax.md)
— that is what the syntax, the parser, `bismuth task migrate`, `POST /tasks/toggle` and the
right-click status menu all operate on. A base that owns its rows stores tasks as YAML rows
instead, a different data model that only the creation path above ever addresses. So on a
self-owned tasks calendar, `[ + task ]` writes a new row fine, but that row's chip renders its
`[ ]` marker **dimmed and inert** (`isTaskLine`, `app/src/calendar/taskPlacement.ts` — the same
predicate that gates dragging): clicking it does not toggle, right-click does not open the status
menu, and there is no error — the click simply falls through to opening the note instead, same as
clicking anywhere else on the chip. Ticking such a task means opening the note (or the base file
itself) and editing the row's own `resolved`/`statusChar` fields directly. Building a second,
row-based write path for toggling was deliberately left undone: it is scope nobody has designed
yet, and a half-designed write path is worse than a clearly bounded, documented gap. If a vault
needs both self-owned rows AND grid-completable tasks, use `source: tasks` with a `taskFile`
instead — every task then really is a checkbox line.

**`source: tasks` with no `taskFile`: the button is not rendered at all.** A grid cell says which
DAY, not which FILE — nothing here guesses a daily-note convention or any other default
destination. `taskFile` is a top-level frontmatter key (`core/src/bases/parse.ts`'s `FIELD_KEYS`,
same flat-persistence mechanism as `dateField`/`categoryField`), so it needs no nested `views:`
block:

```yaml
---
type: base
source: tasks
views:
  - type: calendar
    calendarContent: tasks
    taskFile: "[[Inbox]]"
---
```

Both write paths are picked up by the vault's normal version-bump/SSE reactivity (`POST
/row/update` and `PUT /file` both invalidate on write), so the new task appears on the grid without
any explicit refetch call from the toolbar.

---

## Google Calendar Two-Way Sync

A calendar base can be two-way-synced with Google Calendar (`core/src/gcal/`). One sync pass (`syncEvents` in `core/src/gcal/sync.ts`) does three phases:

- **Pull** — reconcile every remote event into the base (create / update / delete-local).
- **Push** — insert new local events and patch locally-changed ones (`If-Match` etag → 412 conflict handling).
- **Delete** — events removed locally (gone from the base but still linked) are deleted on Google.

Change detection is timestamp-free where possible: a per-event content signature in an external (non-vault) manifest flags local edits, while the remote `updated` time flags remote edits. Only a genuine conflict (both sides changed) consults the conflict policy (`lastWriteWins` | `googleWins` | `bismuthWins`). `lastWriteWins` compares the row's `localUpdated` stamp against the remote `updated` time. The base file itself stays clean — all sync state lives in the external manifest. See `docs/gcal/overview.md` for the full OAuth/sync detail.

---

## Reactive State

All calendar state is module-level reactive boxes in `calendar/state.ts` (Solid `createSignal` wrappers). Because these are global, only one calendar can render at a time (mounting two `CalendarView` instances would share the same `currentView`/`currentDate` signals).

| Signal | Type | Purpose |
|---|---|---|
| `currentView` | `ViewType` | Active view mode |
| `currentDate` | `Date` | The "focused" date (centre of the visible range) |
| `events` | `CalendarEvent[]` | Events visible in the current range |
| `categories` | `Category[]` | All categories from the store |
| `showEventModal` | object or `null` | Open the EventModal; carries optional `date`, `event`, `masterId`, `occurrenceDate`, `startTime`, `endTime` |
| `showCategoryPanel` | `boolean` | Toggle CategoryPanel |
| `showCalendarSettings` | `boolean` | Toggle CalendarSettings modal |
| `dragState` | `DragState \| null` | Active create/move drag |
| `recurrenceAction` | object or `null` | Pending scope-prompt for edit/delete on a recurring event |

`events` and `categories` are refreshed by `refreshEvents(store)` whenever `currentView`, `currentDate`, or `weekStartsOnMonday` changes, and after every mutation.

---

## Range Calculation

`refreshEvents` computes the visible date range from the current view and date:

| View | `start` | `end` |
|---|---|---|
| `month` | First day of `currentDate`'s month | Last day of `currentDate`'s month |
| `week` | `startOfWeek(currentDate, weekStartsOnMonday)` | start + 6 days |
| `3day` | `currentDate` | currentDate + 2 days |
| `day` | `currentDate` | `currentDate` |

Recurring events are expanded over this range by `getEventsForRange`, which calls `expandRecurrence` for each recurring master.

---

## Keyboard Shortcuts Summary

| Context | Key | Action |
|---|---|---|
| Event modal | `Enter` | Save event |
| Event modal | `Backspace` (not in field) | Delete event |
| Event modal / Category panel | `Escape` | Close |
| Category panel | `Enter` (not renaming) | Add new category |
| Category panel | `Enter` (in rename field) | Commit rename |
| Category panel | `Escape` (in rename field) | Cancel rename |

---

## Gotchas and Edge Cases

- **Single-calendar constraint**: global Solid signals mean only one `CalendarView` renders correctly at a time. Mounting two would share `currentView`/`currentDate`.
- **Recurrence stored as JSON inside a string field**: the `recurrence` field holds a JSON string, not a nested YAML structure. Do not hand-edit it as a YAML object — edit the JSON text itself.
- **All-day vs timed events**: omitting `startTime` (empty cell) makes the event all-day. In time-grid views, all-day events appear in a fixed header row, not in the scrollable 24-hour grid.
- **Monthly recurrence clamping**: a series starting on the 31st will fire on Feb 28/29 and on the 30th for 30-day months, not be silently skipped.
- **Category color theme tokens**: storing `"teal"` (not `"#008080"`) means the color follows the app theme. When exporting or reading the file outside Bismuth, `teal` must be resolved manually.
- **Frontmatter preservation**: `BaseBackend.save` preserves all original frontmatter keys. Only `categories` and the event rows body are overwritten. A `schema:` key in frontmatter will not be lost.
- **`userSwitchedView` is module-level, but reset on every mount**: `currentView.value` writes (e.g. the Toolbar's view buttons) flip the module-level `userSwitchedView` flag so `defaultView` hydration never clobbers a manual switch — see `applyDefaultView()`/`reconcileDefaultView()` above. Because the flag is module-level it would otherwise survive a `CalendarView` remount and permanently disable hydration for the rest of the session after a single click. `CalendarView.tsx`'s `onMount` calls `resetUserSwitchedView()` (`app/src/calendar/state.ts`) first, before `reconcileDefaultView`, precisely to undo that — so each fresh mount of the calendar (a new base opened, a pane split, etc.) honors the saved `defaultView` again regardless of what happened in a prior mount.
- **`view: calendar` shorthand vs `views:`**: use `view: calendar` (singular) for a single-view calendar base. Adding a `views:` array overrides the shorthand.
- **The tasks register never touches `EventStore`/`BaseBackend`** — it reads `props.result`'s
  resolved rows fresh on every render, the same pipeline table/cards/list use. There is nothing to
  re-initialise on remount and no stale-store risk the way the events register has to guard
  against (see [Storage Backend](#storage-backend) above).
  - **A carried task's rendered day and its stored day are different things, on purpose.** Reading
    the base file directly (or any tool that isn't this calendar) always shows the task on its
    real `scheduled`/`due` date, even while the grid shows it on today. Don't mistake the two for
    a bug — see [Overdue tasks roll onto today](#overdue-tasks-roll-onto-today-without-the-line-being-rewritten).
  - **A self-owned tasks calendar's rows need the right FIELD NAMES**, not just any columns —
    `description`, `resolved`, `statusChar`, `scheduled`/`due`. A row using different names (e.g.
    a generic `title`/`date` pair, as an EVENTS-register base would use) renders nothing in the
    tasks register: nothing here guesses a mapping the way `dateField`/`categoryField` do for
    events.

---

## Related Docs

- [Bases overview](../overview.md)
- [Base file format](../../calendar/overview.md)
- [Task syntax](../../tasks/syntax.md) — the bracket-field grammar the tasks register places by
  and rewrites on drag

Source: `app/src/bases/CalendarView.tsx`, `app/src/bases/BaseView.tsx`, `app/src/calendar/EventStore.ts`, `app/src/calendar/state.ts`, `app/src/calendar/types.ts`, `app/src/bases/calendarBase.ts`, `app/src/bases/calendarSerialize.ts`, `app/src/calendar/refresh.ts`, `app/src/calendar/dates.ts`, `app/src/calendar/categoryColor.ts`, `app/src/calendar/components/Toolbar.tsx`, `app/src/calendar/components/DateNav.tsx`, `app/src/calendar/components/EventModal.tsx`, `app/src/calendar/components/RecurrenceDialog.tsx`, `app/src/calendar/components/CategoryPanel.tsx`, `app/src/calendar/components/CalendarSettings.tsx`, `app/src/calendar/components/views/MonthView.tsx`, `app/src/calendar/components/views/WeekView.tsx`, `app/src/calendar/components/views/ThreeDayView.tsx`, `app/src/calendar/components/views/DayView.tsx`, `app/src/calendar/components/views/TimeGrid.tsx`, `app/src/calendar/components/views/timeGridDrag.ts`, `app/src/calendar/components/views/TaskAllDayStrip.tsx`, `app/src/calendar/components/EventChip.tsx`, `app/src/calendar/components/TaskChip.tsx`, `app/src/calendar/taskPlacement.ts`, `app/src/calendar/taskDrag.ts`, `app/src/ui/ViewBar.tsx`, `core/src/bases/parse.ts`, `core/src/bases/rows.ts`, `core/src/bases/rowOps.ts`, `core/src/bases/table.ts`, `core/src/bases/source.ts`, `core/src/tasks.ts`, `core/src/server.ts`, `app/src/api.ts`, `core/src/schema/settingsSchema.ts`, `core/src/settings.ts`, `core/src/gcal/sync.ts`, `app/src/calendar/EventStore.test.ts`, `app/src/calendar/state.defaultView.test.ts`, `app/src/calendar/dates.test.ts`, `app/src/calendar/taskPlacement.test.ts`, `app/src/calendar/taskDrag.test.ts`, `app/src/bases/calendarSerialize.test.ts`, `app/src/settings.calendar.test.ts`, `core/test/server.test.ts`
