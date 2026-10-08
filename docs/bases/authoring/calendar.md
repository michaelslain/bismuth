# calendar

Month, week, 3-day and day grid. It draws events stored in the base's body, or checkbox tasks when `mode: tasks`. The base marker stays `type: base`; the kind is `view: calendar`.

## Working example

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
```

For a tasks calendar over the vault's checkbox tasks:

```yaml
---
type: base
source: tasks
view: calendar
mode: tasks
taskFile: "[[Inbox]]"
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `mode` | `normal` or `tasks` | `normal` | `tasks` draws task rows as all-day chips and adds an inline composer to each day cell |
| `categories` | list of `{name, color}` | none | A colour is a hex string or one of `accent`, `teal`, `blue`, `violet`, `green`, `gold`, `rose` |
| `dateField` | string | `date` (events), unset (tasks) | Tasks: pins placement to one field and drops the `scheduled`-then-`due` fallback |
| `startTimeField` | string | `startTime` | Rebinds the column only where the calendar is rendered from view config (HTML export) |
| `endTimeField` | string | `endTime` | Same as `startTimeField` |
| `recurrenceField` | string | `recurrence` | Same as `startTimeField` |
| `categoryField` | string | `category` (events), unset (tasks) | Column naming a row's category |
| `googleCalendarSync` | boolean | `false` | Two-way sync for this calendar |
| `googleCalendarId` | string | `primary` | Google calendar to sync with |
| `taskFile` | wikilink or path | none | Tasks, `source:` bases: note the composer appends to |
| `defaultCategory` | string | none | Tasks, own-rows bases: category preselected for a new task |

## Failure modes

- Events live in the file body as a YAML list of row objects, not in frontmatter. A calendar with an empty body has zero events even when the frontmatter looks complete; write the rows below the closing `---`.
- The interactive grid reads the standard column names `date`, `startTime`, `endTime`, `recurrence` and `category`. A `dateField: when` key does not make the grid read a `when` column, so write event rows with the standard names.
- `recurrence` is a JSON string in one field, for example `'{"type":"weekly","daysOfWeek":[1],"startDate":"2026-05-25","seriesId":"s1"}'`. A nested YAML object is accepted on read and rewritten as a string on the next save, so author the string.
- `bismuth base create --view calendar` writes `source: notes`, which makes the base read vault notes instead of its own body rows. Delete the `source:` line before adding event rows, or scaffold with `bismuth calendar create` instead.
- An event's `category` that matches no `name` in `categories` does not error. The event draws as an outline-only chip.
- A tasks calendar over body rows needs the columns `description` and `scheduled` or `due`. Rows that use `title` and `date` draw nothing.
- A `taskFile` outside the base's `from:` scope writes tasks that never appear in the view; `bismuth base validate` reports it.

Full reference: [docs/bases/views/calendar.md](../views/calendar.md)
