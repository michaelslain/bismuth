# Calendar view

The calendar view draws a base's rows on a month, week, 3-day or day grid. It has two registers: the events register draws events stored in the base file, and the tasks register (`mode: tasks`) draws checkbox tasks on the same grid. Use this page to configure a calendar base. Event fields, recurrence rules and categories live in [calendar overview](../../calendar/overview.md); Google sync lives in [Google Calendar sync](../../gcal/overview.md).

A calendar is an ordinary `type: base` file with `view: calendar`. This base holds its own events in the body:

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

This base shows every open task in the vault instead:

```yaml
---
type: base
source: tasks
view: calendar
mode: tasks
---
```

## Config keys

A calendar reads these top-level frontmatter keys. The settings gear in the view bar writes the register-specific ones for you.

| Key | Type | Default | Effect |
|---|---|---|---|
| `view` | `calendar` | `table` | Selects the calendar renderer |
| `mode` | `normal` or `tasks` | `normal` | `normal` draws events; `tasks` draws task rows |
| `categories` | list of `{name, color}` | none | Declared category names and colours; a colour is a hex string or a palette token (`accent`, `teal`, `blue`, `violet`, `green`, `gold`, `rose`) |
| `dateField` | string | `date` (events), unset (tasks) | Events: the date column. Tasks: pins placement to one field and turns off the `scheduled`-then-`due` fallback |
| `startTimeField` | string | `startTime` | Events: start-time column |
| `endTimeField` | string | `endTime` | Events: end-time column |
| `recurrenceField` | string | `recurrence` | Events: column holding the JSON repeat rule |
| `categoryField` | string | `category` (events), unset (tasks) | Column that names a row's category |
| `googleCalendarSync` | boolean | `false` | Turns on two-way sync for this calendar |
| `googleCalendarId` | string | `primary` | Google calendar this base syncs with |
| `taskFile` | wikilink or path | none | Tasks: the note a new task is appended to in a `source:` base |
| `defaultCategory` | string | none | Tasks: the category preselected for a new task in an own-rows base |

Global display preferences (default view, week start, 24-hour time) live in `.settings`; see [Display settings](#display-settings).

## Which register does a calendar draw?

A calendar draws events when `mode` is absent or `normal`, and tasks when `mode: tasks`. Changing `mode` in the file while the pane is open swaps registers immediately. Both registers share the same four grid layouts and the same date navigation.

| | Events register | Tasks register |
|---|---|---|
| Rows | The base's own body rows | Task rows from `source: tasks`, or the base's own rows |
| Time | Timed or all-day | All-day only |
| Create | Click a cell or drag on the time grid | Click a cell and type |
| View bar | Categories button and a new-event button | Date navigation and grid layout only |

## Move around the calendar

The view bar's grid toggle switches between month, week, 3 day and day. The arrows step by one grid unit: a month, 7 days, 3 days or 1 day. The date between the arrows names the visible range and, when clicked, jumps to today; a **today** button beside the arrows does the same.

The first grid shown is the `defaultView` setting. Switching the grid by hand wins over the setting until the calendar is reopened.

## Events register

The events register reads and writes event rows in the base file's body. It writes them as a YAML list of row objects, one per event.

### Event columns

The interactive grid reads events from the standard column names `id`, `title`, `date`, `startTime`, `endTime`, `location`, `link`, `description`, `category`, `categories` and `recurrence`. Only `id`, `title` and `date` are needed; an event with no `startTime` is all-day. The `dateField`, `startTimeField`, `endTimeField`, `recurrenceField` and `categoryField` keys rebind those columns where a calendar is rendered from its view config, which is the HTML export. Author event rows with the standard names so the grid and the export agree.

`recurrence` is a JSON string in one field, not a nested YAML object. An event's `category` matches a `name` in `categories`; an undeclared name draws as an outline-only chip. The full field table is in [calendar overview](../../calendar/overview.md).

### Create, edit and move events

| Gesture | Result |
|---|---|
| Click an empty month cell | Opens the new-event dialog on that date |
| Click an empty spot on a week, 3-day or day column | Opens the dialog with a start time |
| Drag down an empty spot on a time column | Opens the dialog with a start and end time, snapped to 30 minutes |
| Drag an event chip up or down on a time column | Retimes the event; the drop snaps to 30 minutes |
| Drag an event chip sideways on a time column | Moves the event to another day |
| Click an event chip | Opens the dialog in edit mode |
| Right-click an event chip | Menu with Edit and Delete |

A press that moves less than 4 pixels is a click, not a drag. A drag that ends shorter than 30 minutes is stretched to 30. Editing or deleting one occurrence of a recurring event asks whether the change applies to this one, this and following, or all.

Every change rewrites the base file: the `categories` frontmatter key and the body rows change, and every other frontmatter key is kept as written.

### Bind columns and sync from calendar settings

The settings gear opens the calendar settings dialog. It sets the five column-binding keys in one batch and carries the Google Calendar panel that sets `googleCalendarSync` and `googleCalendarId`. A vault can hold several calendar bases, each synced with a different Google calendar. Connection settings such as conflict policy and cadence are global; see [Google Calendar sync](../../gcal/overview.md).

## Tasks register

The tasks register draws task rows as all-day chips on the grid. A chip is a checkbox, a description and, when the task is overdue, an `Nd late` label. Week, 3-day and day layouts show one tall all-day strip per day instead of an hourly grid.

### Where a task's rows come from

A tasks calendar works over either kind of base.

| The base | Rows come from |
|---|---|
| `source: tasks` | Checkbox lines in the vault's notes; see [task syntax](../../tasks/syntax.md) |
| no `source:` | The base file's own body rows |

A body row needs `description` and a `scheduled` or `due` date under those exact names. `status` defaults to `todo`. A row that uses `title` and `date` as an events base would draws nothing in this register, because nothing maps those names.

### Where a task sits on the grid

A task sits on its `scheduled` date, or on its `due` date when it has no `scheduled` date. A task with neither does not appear. Setting `dateField` pins placement to that one field with no fallback.

### Overdue tasks roll onto today

An unfinished task placed before today draws in today's cell, with a red-washed box and an `Nd late` label. The file keeps the original date: only the drawing moves. Dragging the chip to another day is the one gesture that rewrites the date. A done or cancelled task stays on its own day. Within a day, the most overdue task comes first, then file order.

### Category colours

A chip's checkbox takes the colour of its category. The category name comes from the first of these that exists:

1. The column named by `categoryField`, when the row has a non-empty value there.
2. For a task read from a note, the name of the note it lives in.
3. The row's `category` column.

A name declared in `categories` uses its declared colour. Every other name gets a palette colour chosen from its text, shifted to the next unused colour when two names collide, so the first six categories are six distinct colours with no configuration. The shifting means adding a category can change a later category's colour; declare a colour to pin it.

### Work with a task chip

| Gesture | Result |
|---|---|
| Click the checkbox | Toggles done |
| Right-click the checkbox | Opens the status menu |
| Click the chip | Opens the task editor (description, priority, dates, category, destination, delete, open note) |
| Drag the chip to another day | Reschedules the task |
| Press `Enter` on a focused chip | Opens the task editor |
| Press `Space` | Toggles done |
| Press `Shift+F10` or the context-menu key | Opens the status menu |
| Press `Alt+←` or `Alt+→` | Reschedules by one day |
| Press `Alt+↑` or `Alt+↓` | Reschedules by one week |

A drag or an `Alt` shortcut rewrites the field that placed the task (`scheduled` or `due`, or `dateField`). For a checkbox line it always writes bracket form; see [task syntax](../../tasks/syntax.md#rescheduling-a-date-field). Keyboard focus follows the task to its new cell after a write.

Only a task with a place to write is editable from the grid: a checkbox line in a note, or a row in the base's own body. Any other chip draws a dimmed checkbox and ignores toggling, dragging and the shortcuts, though `Enter` still opens it.

### Create a task

Hover a day cell and click the `+` in its corner, or click empty space in the cell. An inline composer opens at the bottom of the cell with a checkbox and a text input.

| Key or event | Result |
|---|---|
| `Enter` with text | Creates the task and keeps the composer open for another |
| `Enter` with no text, or `Escape` | Closes the composer and discards the text |
| Click away with text | Creates the task |
| Click away with no text | Closes the composer |

Under the input, a `→` line names where the task will be written. With two or more choices it is a picker, and the choice is remembered for the session.

| The base | The picker offers | A new task is |
|---|---|---|
| `source: tasks` | Each note already on the grid, plus `taskFile` | A line `<text> [scheduled <date>]` appended to the chosen note |
| no `source:` | Each category in play, plus "no category" | A body row `{description, status: todo, scheduled, <categoryField>}` |

`taskFile` accepts a wikilink (`[[Inbox]]`), a bare name or a path. A name resolves against the vault like a wikilink does, so a note in a subfolder is found rather than a stray copy created at the vault root. A `source: tasks` base with no `taskFile` and no task on the grid has nowhere to write: committing opens the task calendar settings and shows a toast asking you to set a destination note.

```yaml
---
type: base
source: tasks
view: calendar
mode: tasks
taskFile: "[[Inbox]]"
---
```

A task written outside the view's own filters is still written. A toast names the file it went to and says it will not appear in this view.

### Task calendar settings

In the tasks register the settings gear opens a task calendar settings dialog. Choosing "not set" removes the key from the file.

| Section | Field | Writes |
|---|---|---|
| placement | date column | `dateField` |
| new tasks | destination note (`source:` bases) | `taskFile`, as a wikilink |
| new tasks | default category (own-rows bases) | `defaultCategory` |
| categories | category column (own-rows bases) | `categoryField` |
| categories | a colour swatch per category in play | the whole `categories` list, with the picked entry updated or appended |

## Display settings

These `.settings` keys under `calendar:` change how every calendar looks. They are edited in `.settings` like any other setting; the full list with ranges is in [settings reference](../../settings/reference.md).

| Key | Type | Default | Effect |
|---|---|---|---|
| `defaultView` | `month`, `week`, `3day`, `day` | `week` | Grid shown when a calendar first opens |
| `weekStartsOnMonday` | boolean | `true` | Week starts Monday instead of Sunday |
| `militaryTime` | boolean | `false` | 24-hour times on chips and the hour gutter |
| `monthCellMinHeight` | number, 50 to 160 | `80` | Minimum day-cell height in month view, in pixels |
| `timeGutterWidth` | number, 40 to 80 | `50` | Hour-label column width in week and day views, in pixels |
| `defaultCategoryColor` | hex string | blue swatch | Colour pre-filled for a new category |

## Failure modes

- A calendar base with an empty body has no events, even when the frontmatter looks complete. Write event rows below the closing `---`.
- `bismuth base create --view calendar` writes `source: notes`, which makes the base read vault notes instead of its own body. For an own-rows calendar, delete the `source:` line before adding event rows, or scaffold with `bismuth calendar create` instead.
- Only one calendar renders at a time. Two calendar panes visible together share the same date and grid layout.
- An own-rows tasks calendar whose rows lack `description` or the `scheduled` and `due` names draws nothing.
- `taskFile` naming a note outside the base's `from:` scope writes tasks that never appear in the view. `bismuth base validate` reports it.
- A palette-token category colour (`teal`) follows the app theme. A tool outside Bismuth that reads the file sees the word, not a colour.

## How it works

`CalendarView` (`app/src/bases/CalendarView.tsx`) only chooses a register from `viewMode(view)`. `EventsCalendar` mounts an `EventStore` over a `BaseBackend`, which reads the base file with `parseCalendarFile`, applies edits, and writes the whole file back with `serializeCalendarFile`. The write is serialised through a promise chain, and the backend re-reads the file when the server reports a change to it, so a background Google sync is not overwritten. `TasksCalendar` has no store: it places the resolved rows of the view result on every render.

The calendar contributes controls to the base's single view bar through `calendarSlots()`, which `BaseView` reads; the view renders no bar of its own. Grid state (current view, date, open dialogs) is module-level signals in `app/src/calendar/state.ts`, which is why one calendar renders at a time.

Task placement, the overdue carry and category colours are pure functions in `app/src/calendar/taskPlacement.ts` and `taskCategory.ts`. The chip's writability, the drag payload and the reschedule target all come from `isWritableTask` and `taskRowRef`, so the marker, the drag and the shortcuts cannot disagree. Writes go through the same endpoints as the other task views: `POST /tasks/toggle`, `POST /tasks/reschedule` and `POST /tasks/create` for checkbox lines, and `POST /rows/update` and `POST /rows` for body rows; see [HTTP API reference](../../api/http-reference.md). `POST /tasks/create` resolves `taskFile` server-side in `resolveTaskFilePath`. An own-rows base runs each row through `normalizeStoredTaskRow` before the tasks register sees it.

Source: `app/src/bases/CalendarView.tsx`, `app/src/bases/EventsCalendar.tsx`, `app/src/bases/TasksCalendar.tsx`, `app/src/bases/calendarBase.ts`, `app/src/bases/calendarSerialize.ts`, `app/src/bases/tasksCalendarWrites.ts`, `app/src/calendar/state.ts`, `app/src/calendar/taskPlacement.ts`, `app/src/calendar/taskCategory.ts`, `app/src/calendar/taskCompose.ts`, `app/src/calendar/components/Toolbar.tsx`, `app/src/calendar/components/TaskChip.tsx`, `app/src/calendar/components/TaskCellComposer.tsx`, `app/src/calendar/components/TaskCalendarSettings.tsx`, `app/src/calendar/components/views/timeGridDrag.ts`, `app/src/ui/chipKeys.ts`, `core/src/bases/taskRow.ts`, `core/src/taskCreate.ts`, `core/src/schema/settingsSchema.ts`
