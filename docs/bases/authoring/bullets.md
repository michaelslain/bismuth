# bullets

A plain bulleted list, one bullet per row showing only the first column. Suits quotes and short notes where a table is too much.

## Working example

```yaml
---
type: base
source: notes where file.hasTag("quote")
view: bullets
groupBy:
  property: note.author
sort:
  - property: note.author
    direction: ASC
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `order` | `string[]` | derived | Only the first column shows. A note row's bullet links to the note. |
| `groupBy` | `{ property, direction? }` or a property string | none | A header per group: dot, value, `// N` count. |
| `columns` | `string[]` | value order | Group order only. A listed group with no rows is not shown. |
| `mode` | `"normal"` \| `"tasks"` | `"normal"` | `tasks` renders each bullet as a task line (checkbox, description, field chips). |
| `sort`, `limit` | | | As for a table; `limit` is per group. |

## Failure modes

- If you need a second value per row, use `list` (three values) or `table`; every column after the first is ignored.
- If a `source: tasks` bullets base shows plain text with no checkboxes, add `mode: tasks`. Unlike `list`, bullets never detects a task row from its shape.
- If a bullet for a row stored in the base file is not a link, that is expected: it has no note to open, and a click opens the row editor instead.

Full reference: [docs/bases/views/list-bullets.md](../views/list-bullets.md)
