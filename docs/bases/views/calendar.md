# Calendar View

The calendar view is a full-featured event calendar (month / week / 3-day / day modes, drag-to-create, drag-to-move, recurrence, and category colours) that runs entirely inside a `type: base` markdown file. There is no standalone calendar page and no separate file extension: any base can become a calendar by declaring `view: calendar` (shorthand) or `views: [{ type: calendar }]` in its YAML frontmatter. Events are stored as rows in a GFM pipe table in the base file body; categories are stored as a YAML list under the `categories` key in frontmatter. All calendar settings (default view, week-start, time format) live in the unified `.settings` under the `calendar` section.

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

`categories` is a YAML list of `{name, color}` objects. The `color` field accepts either a CSS hex string (`"#b00020"`) or a theme token (one of `accent`, `teal`, `blue`, `violet`, `green`, `gold`, `rose`) — see [Category Colours](#category-colours) below.

---

## On-Disk Event Format

Events are stored as rows in a GFM pipe table appended after the frontmatter block. The column order is fixed by the serialiser (`calendarSerialize.ts`):

```
| id | title | date | startTime | endTime | location | link | description | category | recurrence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a1 | Standup | 2026-05-30 | 09:00 |  |  |  |  | Work |  |
| b2 | Weekly sync | 2026-05-25 | 14:00 | 15:00 |  |  |  | Work | {"type":"weekly","daysOfWeek":[1],"startDate":"2026-05-25","seriesId":"s1"} |
```

### Event row fields

| Column | Type | Notes |
|---|---|---|
| `id` | `string` | UUID, auto-generated on create |
| `title` | `string` | Event title |
| `date` | `"YYYY-MM-DD"` | The event's primary date |
| `startTime` | `"HH:MM"` or empty | Omit for all-day events |
| `endTime` | `"HH:MM"` or empty | Sets block height in time-grid views |
| `location` | `string` | Free-text location |
| `link` | `string` | URL opened by the chip link button |
| `description` | `string` | Markdown — rendered with marked in the modal |
| `category` | `string` | Must match a name in `frontmatter.categories`; uncategorised events render as a ghost (outline-only) chip |
| `recurrence` | JSON string or empty | A `Recurrence` object serialised as JSON — see [Recurrence](#recurrence) |

All fields except `id`, `title`, and `date` are optional. Absent values are stored as empty cells (`| |`).

### Recurrence storage

Recurrence is stored as a JSON string inside the table cell:

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
  category?: string
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

- **Drag-to-create**: Mouse-down on an empty column area begins a "create" drag. On mouse-up the `EventModal` opens pre-filled with the dragged start (and end, if ≥ 15 minutes).
- **Drag-to-move**: Mouse-down on an existing event chip triggers a "move" drag if the pointer moves more than 4px vertically. On release, `store.updateEvent` is called with the new `startTime` / `endTime`.
- Both drags snap to 30-minute intervals (`SNAP_INTERVAL = 30`).
- Short events (≤ 30 min duration) are rendered 15px taller than their true duration for legibility.
- If an event ends before it starts (data error), `endMin` is forced to `startMin + 15`.

---

## Navigation

The `Toolbar` component contains prev / next chevrons and a "Today" button:

| Action | Month | Week | 3 Day | Day |
|---|---|---|---|---|
| Previous / Next | ±1 month | ±7 days | ±3 days | ±1 day |
| Today | Jumps to today's date |

The header crumb shows:
- Month: `"May 2026"`
- Week: `"2026-05-25 — 2026-05-31"` (ISO date strings)
- 3 Day: `"2026-05-27 — 2026-05-29"`
- Day: `"2026-05-27"`

---

## Event Chips

`EventChip` renders each event as a coloured chip. Behaviour:

- **Background colour**: `color-mix(in srgb, <category-color> 85%, transparent)`. Events with no matching category render without a background (`ghost` CSS class — outline only).
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

## Category Colours

Categories are named event groups with associated colours. The `CategoryPanel` modal manages them.

### Colour storage

Colours are stored as either:

1. A **theme token** string: one of `accent`, `teal`, `blue`, `violet`, `green`, `gold`, `rose`. These map to `var(--<token>)` CSS variables, so the category automatically recolours when the user changes the app theme.
2. A **CSS hex string**: e.g. `"#b00020"`. These are literal hex values from the native colour picker.

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

Global calendar display settings live in `.settings` under `calendar:`. They are edited by clicking "Settings" in the toolbar, which opens `CalendarSettings.tsx` — a modal specific to the per-base field mapping — or changed directly in `.settings`.

### `settings.calendar` keys

| Key | Type | Default | Description |
|---|---|---|---|
| `defaultView` | `"month" \| "week" \| "3day" \| "day"` | `"week"` | The view selected when the calendar first opens |
| `weekStartsOnMonday` | `boolean` | `true` | Whether the week begins on Monday (ISO standard) or Sunday |
| `militaryTime` | `boolean` | `false` | Use 24-hour time in chips and the time grid gutter |
| `defaultCategoryColor` | `string` | `"#4a90e2"` | Default hex colour pre-filled when creating a new category |

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
| `categoryField` | `category` | No | Column driving the chip colour |

These keys configure the first view in the `views` array (via `parseBaseFile` in `parse.ts` — top-level field binding keys are automatically applied to `config.views[0]`). If a field mapping key is absent, the default column name is used.

The dropdown for each field lists: the standard columns (`date`, `startTime`, `endTime`, `recurrence`, `category`, `title`, `location`, `link`), plus any columns actually present in the existing event rows.

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
3. `save(data)` — writes back to disk with `api.write`. Fire-and-forget: saves preserve all original frontmatter keys (schema, source, etc.) and rewrite only the `categories` key and the event table. No full cache invalidation — the version poll reflects truth on next read.

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
- **Recurrence stored as JSON in a table cell**: the `recurrence` column holds a JSON string, not a YAML value. Do not hand-edit it as YAML structure inside the table.
- **All-day vs timed events**: omitting `startTime` (empty cell) makes the event all-day. In time-grid views, all-day events appear in a fixed header row, not in the scrollable 24-hour grid.
- **Monthly recurrence clamping**: a series starting on the 31st will fire on Feb 28/29 and on the 30th for 30-day months, not be silently skipped.
- **Category colour theme tokens**: storing `"teal"` (not `"#008080"`) means the colour follows the app theme. When exporting or reading the file outside Bismuth, `teal` must be resolved manually.
- **Frontmatter preservation**: `BaseBackend.save` preserves all original frontmatter keys. Only `categories` and the event table body are overwritten. A `schema:` key in frontmatter will not be lost.
- **`userSwitchedView` is module-level**: once the user clicks a view button in any calendar session, `userSwitchedView` is permanently `true` for the lifetime of the page. The defaultView hydration effect becomes a no-op for the rest of the session.
- **`view: calendar` shorthand vs `views:`**: use `view: calendar` (singular) for a single-view calendar base. Adding a `views:` array overrides the shorthand.

---

## Related Docs

- [Bases overview](../overview.md)
- [Base file format](../../calendar/overview.md)

Source: `app/src/bases/CalendarView.tsx`, `app/src/calendar/EventStore.ts`, `app/src/calendar/state.ts`, `app/src/calendar/types.ts`, `app/src/bases/calendarBase.ts`, `app/src/bases/calendarSerialize.ts`, `app/src/calendar/refresh.ts`, `app/src/calendar/dates.ts`, `app/src/calendar/categoryColor.ts`, `app/src/calendar/components/Toolbar.tsx`, `app/src/calendar/components/EventModal.tsx`, `app/src/calendar/components/RecurrenceDialog.tsx`, `app/src/calendar/components/CategoryPanel.tsx`, `app/src/calendar/components/CalendarSettings.tsx`, `app/src/calendar/components/views/MonthView.tsx`, `app/src/calendar/components/views/WeekView.tsx`, `app/src/calendar/components/views/TimeGrid.tsx`, `app/src/calendar/components/EventChip.tsx`, `core/src/bases/parse.ts`, `core/src/schema/settingsSchema.ts`, `core/src/settings.ts`, `core/src/gcal/sync.ts`, `app/src/calendar/EventStore.test.ts`, `app/src/calendar/state.defaultView.test.ts`, `app/src/calendar/dates.test.ts`, `app/src/bases/calendarSerialize.test.ts`, `app/src/settings.calendar.test.ts`
