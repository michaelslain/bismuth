# Calendar events, recurrence and categories

A calendar is a Bases view kind, not a standalone page: a `type: base` markdown file with `view: calendar` stores its events as rows in its body and its categories in its frontmatter. An event is a row with a date, optional times, an optional repeat rule and optional categories. The grid, column bindings and tasks register are configured in [the calendar view](../bases/views/calendar.md); two-way sync with Google is in [Google Calendar sync](../gcal/overview.md).

```yaml
---
type: base
view: calendar
categories:
  - name: Work
    color: teal
  - name: Personal
    color: "#e06c75"
---

- id: a1
  title: Standup
  date: 2026-05-04
  startTime: "09:00"
  endTime: "09:30"
  category: Work
  recurrence: '{"type":"weekly","daysOfWeek":[1,2,3,4,5],"startDate":"2026-05-04","seriesId":"s1"}'
```

This file holds one event that repeats every weekday from 2026-05-04, drawn in the `Work` colour. You can write events by hand like this, edit them in the app, or drive them from the shell with [`bismuth calendar`](#how-do-i-edit-a-calendar-from-the-shell).

## What fields does an event have?

An event is one row. Only `id`, `title` and `date` are needed; every other field is optional, and an empty field is left out of the file.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | unique id, a UUID when the app or CLI creates it |
| `title` | string | the event's name |
| `date` | `YYYY-MM-DD` | the day of a single event, and the anchor day of a repeating one |
| `startTime` | `HH:MM` | start time; an event without one is all-day |
| `endTime` | `HH:MM` | end time; without it the event has no explicit end |
| `location` | string | free text |
| `link` | string | a URL |
| `description` | markdown | notes about the event |
| `category` | string | the name of one category |
| `categories` | JSON list of names | several categories; takes precedence over `category` |
| `recurrence` | JSON string | the repeat rule, described below |
| `localUpdated` | ISO timestamp | stamped on every create or edit; Google sync uses it to decide which side changed last |

Dates and times are plain strings with no time zone. The app and the CLI write `recurrence` and `categories` as JSON strings in a single field; a `recurrence` that is not valid JSON is read as "does not repeat".

The calendar view can bind other column names to the date, time, recurrence and category fields; see [the calendar view](../bases/views/calendar.md). Write rows with the standard names above so the grid, the export and the CLI all agree.

## How do I make an event repeat?

Put a `recurrence` JSON string on the event.

| Key | Type | Meaning |
|---|---|---|
| `type` | `daily`, `weekly`, `biweekly` or `monthly` | how the series repeats |
| `daysOfWeek` | list of 0 to 6, Sunday is 0 | which weekdays; used by `weekly` and `biweekly`, defaults to the weekday of `startDate` |
| `startDate` | `YYYY-MM-DD` | the first possible occurrence |
| `endDate` | `YYYY-MM-DD` | the last day, inclusive; without it the series runs to 2100-01-01 |
| `seriesId` | string | ties the pieces of one series together |

```json
{"type":"weekly","daysOfWeek":[1,3],"startDate":"2026-05-04","seriesId":"s1"}
```

This is every Monday and Wednesday from 2026-05-04.

| Type | An occurrence falls on |
|---|---|
| `daily` | every day |
| `weekly` | every listed weekday |
| `biweekly` | a listed weekday in every second week, counted from `startDate` |
| `monthly` | the day of the month of `startDate`; in a shorter month, the last day |

A monthly series that starts on 2026-01-31 fires on 2026-02-28 and 2026-04-30 instead of skipping those months. A biweekly series counts its weeks from its own `startDate`, so two biweekly series that start in different weeks fire in alternating weeks even with the same `daysOfWeek`. There is no yearly type and no interval other than two weeks.

Repeating events are stored once and expanded at read time into one occurrence per matching day in the visible range. The stored `date` of a series is its anchor; the `startDate` and `endDate` in `recurrence` decide which days appear.

## How do I change or delete one occurrence of a repeating event?

Editing or deleting a repeating event in the app asks for a scope.

| Choice | Effect |
|---|---|
| this event | only that day changes or disappears |
| this and following events | that day and every later one change or end |
| all events | every occurrence of the series changes or goes |

Under the hood a series is one or more segments that share a `seriesId`. Deleting one day cuts the series in two:

```text
before   daily  2026-05-01 to open-ended
delete   2026-05-03
after    daily  2026-05-01 to 2026-05-02
         daily  2026-05-04 to open-ended        (same seriesId)
```

Editing one day does the same cut and adds a standalone single event for that day carrying your changes. If the day is the first of the series, the head segment is dropped instead of left empty. Editing "this and following" ends the old segment the day before and starts a new segment that gets a fresh `seriesId`, so you can change the rule of the tail: a daily series can become weekly-on-Mondays from a chosen date. Deleting "this and following" just sets `endDate` to the day before.

## How do categories work?

A category is a name and a colour, declared in the base's `categories` frontmatter list. An event refers to a category by name in `category`, or by several names in `categories`.

```yaml
categories:
  - name: Work
    color: teal
  - name: Personal
    color: "#e06c75"
```

A `color` is either a palette token or any CSS colour. The tokens are `accent`, `teal`, `blue`, `violet`, `green`, `gold` and `rose`. Store the token rather than a hex value and the category recolours itself when the theme changes.

- **Chips.** An event chip draws a frame and a faint wash in its category colour. An event with several categories keeps one wash and splits its frame into one band per category, up to three, then shows `+n` for the rest. An event whose category is not declared in `categories` draws as an outline with no fill.
- **Rename.** Renaming a category renames it on every event that uses it, in both `category` and `categories`.
- **Recolor.** Pick a palette swatch or a custom colour in the category panel. New categories start from the `calendar.defaultCategoryColor` setting.
- **Delete.** Deleting a category clears it from every event that carried it. If a category named `Uncategorized` or `Default` exists, the events move to it instead. The app offers undo after a delete.

A duplicate or blank category name is refused.

## How do I edit a calendar from the shell?

The `bismuth calendar` commands read the base file, change events or categories, and write it back, so an agent or script never edits raw YAML by hand. They need no running server, and the app picks up each write live. Every command takes the calendar's path inside the vault as `<basePath>`; the vault comes from `--vault` or `BISMUTH_VAULT`.

| Command | Does |
|---|---|
| `calendar bases` | lists every calendar base in the vault with its event count and category names |
| `calendar create <basePath> [--title '...']` | creates an empty calendar, adding `.md` if missing; fails if the path exists |
| `calendar list <basePath> [--from D --to D]` | lists stored events, with repeating events unexpanded and their real ids |
| `calendar range <basePath> <from> <to>` | lists concrete occurrences in the range, with repeats expanded |
| `calendar day <basePath> <date>` | lists one day's occurrences |
| `calendar get <basePath> <id>` | prints one event as stored |
| `calendar search <basePath> <text> [--from D --to D]` | searches title, description, location and category |
| `calendar overlaps <basePath> <date>` | lists pairs of timed events that overlap that day |
| `calendar add <basePath> --date D --title '...'` | adds an event |
| `calendar move <basePath> <id> [--date D --start T --end T]` | changes an event's date or times |
| `calendar delete <basePath> <id>` | deletes an event |
| `calendar override <basePath> <id> <date> [fields]` | changes one occurrence of a repeating event |
| `calendar delete-occurrence <basePath> <id> <date>` | removes one occurrence |
| `calendar categories <basePath>` | lists the categories |
| `calendar category add <basePath> <name> [--color C]` | adds a category; the colour defaults to `accent` |
| `calendar category update <basePath> <name> [--rename N] [--color C]` | renames or recolours, cascading a rename into events |
| `calendar category remove <basePath> <name> [--reassign OTHER]` | removes a category, clearing or reassigning it on events |

`calendar add` takes its fields as `--title`, `--date`, `--start`, `--end`, `--location`, `--link`, `--description`, `--category`, `--recurrence '<json>'`, or all at once as `--json '{...}'`; flags override `--json`. `--rrule 'FREQ=WEEKLY;BYDAY=MO'` takes an iCalendar rule instead of `--recurrence` and moves the event's date to the first matching day. The rule subset is `FREQ=DAILY|WEEKLY|MONTHLY`, `INTERVAL=2` with weekly (biweekly), `BYDAY` and `UNTIL`; anything else, including `COUNT` and `YEARLY`, is refused with `CALENDAR_RRULE_FORMAT_ERROR`.

Use `calendar list` to find an id, because `calendar range` and `calendar day` return occurrences of repeating events rather than the stored master. Changing a repeating master's `--start` or `--end` with `calendar move` changes every occurrence. The CLI has no "this and following" command; use `calendar override` and `calendar delete-occurrence` for single days. Every command is listed with its flags in the [CLI reference](../cli/reference.md).

## How does a calendar edit interact with Google sync?

Edits from the CLI are safe on a Google-synced calendar. Each command keeps event ids and stamps `localUpdated` the way the app does, and the sync bookkeeping lives outside the vault, so rewriting the base file cannot corrupt it. A locally deleted event is deleted from Google on the next sync. See [Google Calendar sync](../gcal/overview.md).

## How it works

### Storage

The app edits events through `EventStore` (`app/src/calendar/EventStore.ts`), which holds the events and categories in memory and hands every change to a storage backend. `BaseBackend` (`app/src/bases/calendarBase.ts`) reads the base file, keeps its whole frontmatter, and writes the file back with only `categories` and the event rows changed; the write is not awaited, so a failed write is not shown to the user. `MemoryBackend` is the in-memory fallback for a calendar with no file, and for tests.

The event rows are a YAML list, read and written through `parseRows` and `serializeRows` (`core/src/bases/rows.ts`). `app/src/bases/calendarSerialize.ts` maps rows to events. `recurrence` and `categories` are `JSON.stringify`d into their cells.

### The headless module

`core/src/calendar.ts` is the same model with no UI and no I/O, so the CLI, the daemon and agents can use it. Every function is a pure transform; the CLI in `cli/src/commands/calendar.ts` does the read, parse, mutate, serialize and write.

| Group | Functions |
|---|---|
| Parse and write | `parseCalendarFile`, `serializeCalendarFile`, `categoriesOf`, `isCalendarBase`, `emptyCalendarFile` |
| Read | `eventsForRange`, `eventsForDay`, `eventsInWindow`, `searchEvents`, `detectOverlaps`, `findEvent` |
| Change events | `addEvent`, `moveEvent`, `deleteEvent`, `overrideOccurrence`, `deleteOccurrence`, `recurrenceFromRRule` |
| Change categories | `addCategory`, `updateCategory`, `removeCategory` |

`serializeCalendarFile` keeps every frontmatter key and writes `categories` only when the list is non-empty. `eventsForRange` expands repeats and sorts by date then start time; `eventsInWindow` returns stored events without expanding, matching a series by whether its `startDate` to `endDate` window overlaps the range. `detectOverlaps` compares only events that have both a start and an end, using half-open intervals, so back-to-back events do not overlap.

`overrideOccurrence` and `deleteOccurrence` implement the same series cut as the app. Category renames cascade into events and re-stamp `localUpdated` on each event they change, because category is part of the Google sync signature. Failures use `createError` with `CALENDAR_EVENT_NOT_FOUND`, `CALENDAR_NOT_RECURRING`, `CALENDAR_CATEGORY_EXISTS`, `CALENDAR_CATEGORY_NOT_FOUND`, `CALENDAR_CATEGORY_FORMAT_ERROR` or `CALENDAR_RRULE_FORMAT_ERROR`.

### Recurrence engine

`core/src/bases/recurrence.ts` is the one recurrence implementation; the app, the CLI and the HTML export all import it. `expandRecurrence(recurrence, rangeStart, rangeEnd)` walks day by day from the later of `startDate` and `rangeStart` to the earlier of `endDate` (or 2100-01-01) and `rangeEnd`, asking `matchesRecurrence` of each day, so its cost follows the range, not the age of the series. The biweekly test is `floor(daysSinceStart / 7)` being even, and any day before `startDate` never matches. Date arithmetic uses local midnight, never UTC.

The app's scope dialog (`RecurrenceDialog`) calls `EventStore`'s `editOccurrence`, `editFollowing`, `editSeries`, `deleteOccurrence`, `deleteFollowing` or `deleteSeries`. The dialog opens when a chip or the event form edits or deletes a repeating event.

### Category colours

`app/src/calendar/categoryColor.ts` resolves a stored colour: a palette token becomes `var(--<token>)`, anything else passes through, and a missing colour is `var(--accent)`. `eventCategoryNames` prefers the `categories` list over `category`, and `categoryBands` builds the hard-edged frame bands with `MAX_BANDS` (3) and `categoryOverflow` for the `+n`. Category writes go through `app/src/calendar/categoryActions.ts`.

Source: `core/src/calendar.ts`, `core/src/bases/recurrence.ts`, `core/src/bases/rows.ts`, `cli/src/commands/calendar.ts`, `app/src/calendar/EventStore.ts`, `app/src/calendar/categoryColor.ts`, `app/src/calendar/categoryActions.ts`, `app/src/calendar/components/RecurrenceDialog.tsx`, `app/src/calendar/types.ts`, `app/src/bases/calendarBase.ts`, `app/src/bases/calendarSerialize.ts`
