# list

A compact, clickable horizontal-strip list — title, optional dimmed secondary label, optional right-aligned value. Task rows (from a `tasks:` source) render instead as native interactive checkbox lines. `list` is the automatic fallback for an embedded `tasks:` query block when `view:` is absent or unrecognized.

## Working example

```yaml
---
type: base
source: notes where "#book"
views:
  - type: list
    name: My Books
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
tasks: not done
view: list
```
````

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `order` | `string[]` | auto-derived | Only the **first three** resolved columns are ever displayed (title, secondary label, right value) — extras are resolved but not shown. |
| `groupBy` | `{ property, direction? }` | none | Section headers with a colored dot + count. |
| `columns` (→ `groupOrder`) | `string[]` | value-sorted | Controls **group order only**, not which data columns display. |
| `sort`, `limit`, `filters`, `source` | — | — | Standard fields. |

## Failure modes

- **Columns beyond index 2 are silently ignored** by the renderer (still resolved by the query engine, just never shown) — use `table` if you need more than three visible fields.
- **Task rows bypass `order`/column logic entirely** — `TaskRow` reads `row.note.description`/`status`/`priority`/`due`/etc. directly, so declaring `order` has no effect on a tasks-sourced list.
- **Group header colors need an exact lowercase key match** — `groupColor("Done")` misses (falls back to plain accent color); `groupColor("done")` hits green. Trailing/leading whitespace is trimmed automatically, but case is not.

Full reference: `docs/bases/views/list-bullets.md`
