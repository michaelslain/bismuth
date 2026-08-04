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

(`view: calendar` is shorthand for `views: [{ type: calendar, name: Calendar }]` — only applies when no `views:` array is present.)

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

## Failure modes

- **Events live in the file BODY as rows (a YAML list of row objects), not in frontmatter.** A calendar base with an empty body has zero events even if the frontmatter looks complete — you must write the event rows below the `---` closing fence.
- **`recurrence` is a JSON *string* in one field, not nested YAML** — e.g. `recurrence: '{"type":"weekly","daysOfWeek":[1],"startDate":"2026-05-25","seriesId":"s1"}'`. Hand-editing it as a YAML object breaks parsing.
- **An event's `category` must exactly match a `name` in the top-level `categories:` list.** A typo'd or undeclared category doesn't error — the event just renders as a "ghost" (outline-only, no fill color) chip.

Full reference: `docs/bases/views/calendar.md`
