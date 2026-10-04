# list

A compact, clickable horizontal-strip list — title, optional dimmed secondary label, optional right-aligned value. Task rows (from a `tasks:` source) render instead as native interactive checkbox lines. `list` is the automatic fallback for an embedded `tasks:` query block when `view:` is absent or unrecognized.

## Working example

```yaml
---
type: base
source: notes where file.hasTag("book")
view: list
groupBy:
  property: note.status
sort:
  - property: note.title
    direction: ASC
---
```

Task-query variant (embedded block):

````markdown
```query
tasks:
where: !note.resolved && note.priority == "high"
sort: note.due
view: list
```
````

Bare `tasks:` says "task query"; the filter goes in `where:` (a Bases expression) and ordering in `sort:`. Add `from: [[Base]]` to scope the tasks to that base's notes. A legacy `tasks: not done` (Obsidian-Tasks DSL text after the colon) still reads through a translation shim, but do not author it; `bismuth base migrate-queries` rewrites old blocks into the form above.

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `order` | `string[]` | auto-derived | Only the **first three** resolved columns are ever displayed (title, secondary label, right value) — extras are resolved but not shown. |
| `groupBy` | `{ property, direction? }` | none | Section headers with a colored dot + count. |
| `columns` (→ `groupOrder`) | `string[]` | value-sorted | Controls **group order only**, not which data columns display. |
| `mode` | `"normal"` \| `"tasks"` | `"normal"` | General mode axis. In `tasks` mode every row renders as a task line regardless of shape; in `normal` mode a row still renders as a task line if it merely has the shape a task query produces (`isTaskRow`) — `list` is the one view that checks shape as well as the declared mode. |
| `sort`, `limit` | — | — | Standard fields. (`filters` and `source` are base-level keys, not view fields.) |

## Failure modes

- **Columns beyond index 2 are silently ignored** by the renderer (still resolved by the query engine, just never shown) — use `table` if you need more than three visible fields.
- **Task rows bypass `order`/column logic entirely** — `TaskRow` reads `row.note.description`/`status`/`priority`/`due`/etc. directly, so declaring `order` has no effect on a tasks-sourced list.
- **Group header colors resolve against a fixed status palette, unmatched keys fall back to plain accent color.** `groupColor(key)` normalizes the key itself (`.trim().toLowerCase()`) before lookup, so `"Done"`, `" done "`, and `"done"` all hit green — only a name genuinely absent from the palette (`reading`, `to read`/`toread`, `finished`/`done`/`complete`, `abandoned`/`dropped`) falls back.

Full reference: `docs/bases/views/list-bullets.md`
