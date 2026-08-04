# table

Spreadsheet-style grid. The default/fallback view — used when no `type:` is set or an unknown `type:` is given.

## Working example

```yaml
---
type: base
source: notes where "#book"
views:
  - type: table
    name: Reading List
    order: [file.name, note.status, note.rating, note.pages]
    sort:
      - property: note.rating
        direction: DESC
    groupBy:
      property: note.status
      direction: ASC
    summaries:
      note.rating: Average
    limit: 200
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `order` | `string[]` | auto-derived from row data | Explicit column list (property ids: `file.name`, `note.price`, `formula.ppu`). Only these columns show when set. |
| `sort` | `{ property, direction?: "ASC"\|"DESC" }[]` | none | Multi-key stable sort, applied in order. |
| `groupBy` | `{ property, direction?: "ASC"\|"DESC" }` | none | Groups rows under a full-width header row per distinct value. |
| `columns` (parses to `groupOrder`) | `string[]` | value-sorted | Explicit group display order for a grouped table. Unlike kanban, a declared group with zero rows is **not** shown. |
| `summaries` | `Record<propertyId, string>` | none | Footer aggregate per column: `Sum`\|`Average`\|`Min`\|`Max`\|`Count`\|`Empty`\|`Filled`\|`Unique`. |
| `columnWidths` | `Record<propertyId, number>` | none | Per-column pixel widths; normally written by drag-resize, safe to set by hand. |
| `limit` | `number` | none | Max rows per group. |
| `filters` | `FilterNode` | none | Per-view filter, ANDed with the base-level `filters`. |

## Failure modes

- **`order: []` (present but empty) means "show all," not "show nothing."** Only an *absent* `order` and an *empty* `order` behave identically — both auto-derive columns. There is no way to declare zero columns.
- **Formula columns must be explicitly listed in `order`** — `formula.*` ids are never auto-derived, so a formula you don't reference in `order` never appears even though it computed successfully.
- **Fixed-width layout requires every visible column to have a width in `columnWidths`.** Miss one (e.g. after adding a column post-save) and the whole table silently falls back to fluid 100% layout until the next drag-resize reseeds every width.

Full reference: `docs/bases/views/table.md`
