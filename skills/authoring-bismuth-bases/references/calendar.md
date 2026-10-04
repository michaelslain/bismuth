# calendar

A full-featured month/week/3-day/day event calendar running inside a `type: base` file. No standalone page, no separate file extension.

## Working example

```yaml
---
type: base
view: calendar
schema: { title: text, date: date }
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

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `dateField` | `string` | `"date"` | Column carrying the event date. Required column, but the config key itself has a default. |
| `startTimeField` | `string` | `"startTime"` | Omit the column value for an all-day event. |
| `endTimeField` | `string` | `"endTime"` | Sets block height in time-grid views. |
| `recurrenceField` | `string` | `"recurrence"` | Column holding the JSON-encoded recurrence rule. |
| `categoryField` | `string` | `"category"` | Column driving chip color; must match a name in top-level frontmatter `categories:`. |
| `googleCalendarSync` | `boolean` | `false` | Per-calendar two-way Google Calendar sync toggle. |
| `googleCalendarId` | `string` | `"primary"` | Which Google calendar this base syncs with. |
| `mode` | `'normal' \| 'tasks'` | `'normal'` | `mode: tasks` swaps the calendar into a tasks register: day cells get an inline composer instead of an event-create flow. |
| `taskFile` | `string` (note path) | — | **Tasks-register only, when the base does NOT own its rows** (it has a `source:`) — the note the inline composer appends a checkbox line to. The composer's destination picker offers one target per distinct source note already on the grid, plus `taskFile` when set; it is a no-op only when there is nothing to pick (no `taskFile` and no task rows yet). |
| `defaultCategory` | `string` | — | **Tasks-register only, when the base DOES own its rows** (no `source:`) — category stamped on rows the composer creates. |

### Tasks register (`mode: tasks`)

Clicking a day cell opens an inline composer with no separate create button. What it writes depends on whether the base **owns its rows** (no `source:` — it's a plain row-backed base) or **queries them** (has a `source:`):

- **Owns its rows**: commit calls `rowCreate` with a new row (`description`, `status: todo`, `scheduled: <date>`, plus the configured `categoryField` set to `defaultCategory` if one is set).
- **Has a `source:`**: commit appends a checkbox line — `- [ ] <text> [scheduled <date>]` — to the note picked in the composer's destination picker (one entry per distinct source note on the grid, plus `taskFile` if set) via the task-create endpoint. Only when there is no `taskFile` and no task rows yet is there nothing to pick, and the composer does nothing but open settings.
- **Own-rows bases** get a per-category picker; `defaultCategory` is only the preselected one.

## Failure modes

- **Events live in the file BODY as rows (a YAML list of row objects), not in frontmatter.** A calendar base with an empty body has zero events even if the frontmatter looks complete — you must write the event rows below the `---` closing fence.
- **`recurrence` is written as a JSON *string* in one field** — e.g. `recurrence: '{"type":"weekly","daysOfWeek":[1],"startDate":"2026-05-25","seriesId":"s1"}'`. Both readers also accept an already-parsed YAML object, but the app re-serialises it as a JSON string on its next write, so author the string form.
- **`bismuth base create --view calendar` writes `source: notes`**, which makes the base read vault notes instead of its own body rows. For an own-rows calendar (events in the body), delete the `source:` line after scaffolding, before adding event rows.
- **An event's `category` must exactly match a `name` in the top-level `categories:` list.** A typo'd or undeclared category doesn't error — the event just renders as a "ghost" (outline-only, no fill color) chip.

Full reference: `docs/bases/views/calendar.md`
