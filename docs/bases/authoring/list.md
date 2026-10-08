# list

A compact list: one line per row with a title, a muted second value and a right-hand value. Rows that are tasks render as checkbox lines. `list` is also what a ` ```query ` task block renders when it names no `view:`.

## Working example

```yaml
---
type: base
source: notes where file.hasTag("book")
view: list
order: [file.name, note.author, note.rating]
groupBy:
  property: note.status
sort:
  - property: note.rating
    direction: DESC
---
```

Task-query variant, in a note:

````markdown
```query
tasks:
where: !note.resolved && note.priority == "high"
sort: note.due
view: list
```
````

Bare `tasks:` makes it a task query; the filter goes in `where:` (a Bases expression) and the order in `sort:`. Add `from: [[Base]]` to scope the tasks to that base's notes.

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `order` | `string[]` | derived | Only the first three columns show: title, `— second`, right-hand value. |
| `groupBy` | `{ property, direction? }` or a property string | none | A header per group: dot, value, `// N` count. |
| `columns` | `string[]` | value order | Group order only, not which values show. A listed group with no rows is not shown. |
| `mode` | `"normal"` \| `"tasks"` | `"normal"` | `tasks` renders every row as a task line. In `normal`, a row scanned from a note's checkbox line still renders as a task line. |
| `sort`, `limit` | | | As for a table; `limit` is per group. |

## Failure modes

- If you need more than three values per row, use `table`; columns after the third are not shown.
- If `order` seems ignored on a task list, that is expected: a task line reads the task's own fields (`description`, `status`, `priority`, dates), not the columns.
- If the second value never shows, it is a list or link object; the list hides those.
- If a group header has no colour, its value is not a known status (`reading`, `to read`, `todo`, `doing`, `done`, `finished`, `abandoned` and so on); unknown groups are muted.

Full reference: [docs/bases/views/list-bullets.md](../views/list-bullets.md)
