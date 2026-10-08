# table

A spreadsheet grid: one row per note or stored row, one column per property, with sort, groups, a summary footer, and drag-to-resize and drag-to-reorder columns. It is also the kind a base gets when `view:` is missing or names an unknown kind.

## Working example

```yaml
---
type: base
source: notes where file.hasTag("book")
view: table
order: [file.name, note.status, note.rating, note.pages]
sort:
  - property: note.rating
    direction: DESC
groupBy:
  property: note.status
summaries:
  note.rating: Average
limit: 200
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `order` | `string[]` | derived from the rows | The columns, in order (`file.name`, `note.price`, `formula.ppu`). Only these show. |
| `sort` | `{ property, direction? }[]` | none | Stable multi-key sort; `direction` is `ASC` or `DESC`. |
| `groupBy` | `{ property, direction? }` or a property string | none | One section per distinct value, ordered by value. |
| `columns` | `string[]` | value order | Group order. A listed group with no rows is not shown. |
| `summaries` | `{ propertyId: name }` | none | Footer values: `Sum` `Average` `Min` `Max` `Count` `Empty` `Filled` `Unique`. |
| `columnWidths` | `{ propertyId: px }` | measured | Column widths; dragging a header edge writes this. |
| `limit` | number | none | Maximum rows per group. |
| `mode` | `"normal"` \| `"tasks"` | `"normal"` | `tasks` turns the `status` column into a checkbox and paints an overdue `due` red; the other columns stay ordinary cells. |

`filters:` and `source:` are base-level keys, written beside `view:`, never inside a view.

## Failure modes

- If `order: []` is present but empty, every derived column shows, as if `order` were absent. There is no way to declare zero columns.
- If a formula computes but never appears, its `formula.<name>` id is missing from `order`; formula columns are never derived.
- If a `summaries` name is misspelled or lowercase (`average`), the footer cell is empty with no error.
- If `limit` is quoted (`"50"`), it is ignored; write a YAML number.
- If `direction` is anything but `DESC` (any case), it reads as `ASC` without a warning.

Full reference: [docs/bases/views/table.md](../views/table.md)
