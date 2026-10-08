# Table view

The table view shows a base's rows as a spreadsheet-style grid with sortable, groupable, reorderable and resizable columns, editable in place. It is the view a base gets when it declares `view: table` or no `view:` at all. Use it when you want every property visible at once; the other [view kinds](../overview.md) show the same rows differently.

## Minimal working base

```yaml
---
type: base
view: table
order: [file.name, note.status, note.rating, note.tags]
sort:
  - property: note.rating
    direction: DESC
groupBy:
  property: note.status
  direction: ASC
columns: [Todo, In Progress, Done]
summaries:
  note.rating: Average
columnWidths:
  file.name: 240
  note.status: 120
limit: 50
filters: 'file.hasTag("book")'
---
```

A base has one view, and every view key sits at the top level of the frontmatter. Columns resolve in this order: `order` if it is non-empty, else the base's declared `properties` list, else every `note.*` key seen in the filtered rows.

## Config keys

These keys apply to `view: table`. Keys shared with other view kinds (`filters`, `source`, `mode`) are described in the [bases overview](../overview.md).

| Key | Type | Allowed values | Default | Effect |
|---|---|---|---|---|
| `view` | string | `table` | `table` | Selects the table renderer. |
| `order` | `string[]` | property ids | unset | The columns to show, in order. Unlisted columns are hidden. `[]` counts as unset. |
| `sort` | list of `{property, direction}` | `direction`: `ASC`, `DESC` | none | Stable multi-key sort, applied after filtering and before grouping. A bare string entry means ascending. |
| `groupBy` | `{property, direction}` | `direction`: `ASC`, `DESC` | none | Groups rows under full-width header rows, ordered by the group's real value (numbers numerically, dates chronologically). |
| `columns` | `string[]` | group values | unset | Explicit group order. Listed groups come first, in order; other groups follow sorted by value. |
| `summaries` | `{property: name}` | `Sum`, `Average`, `Min`, `Max`, `Count`, `Empty`, `Filled`, `Unique` | none | A footer row of per-column aggregates. |
| `columnWidths` | `{property: px}` | positive numbers | measured | Per-column pixel widths. Drag-resizing writes this key. |
| `limit` | number | `0` or greater | none | Maximum rows shown, applied per group when grouped. |
| `mode` | string | `normal`, `tasks` | `normal` | `tasks` makes every row a task and adds a status checkbox and overdue styling. |

Summary names are case-sensitive, and an unknown name renders an empty cell. Summaries cover every row that passes the filter, ignoring `limit`.

A `columns:` entry for a group with no rows is dropped. Only the [kanban view](kanban.md) keeps empty declared groups as columns.

### Column ids

A column id names where its values come from:

| Prefix | Source | Example |
|---|---|---|
| `file.` | The note's file metadata | `file.name`, `file.path`, `file.mtime`, `file.tags` |
| `note.` | A frontmatter key | `note.status`, `note.rating` |
| `formula.` | A formula declared in `formulas:` | `formula.value_per_page` |
| none | A frontmatter key, treated as `note.<name>` | `status` |

Summary keys accept the bare and the `note.` spelling interchangeably, so `price` and `note.price` name one summary.

### Column labels and hidden columns

A header shows the property's `displayName` when its base declares one, else the id without its prefix (`note.price` shows `price`). A property marked `hidden: true` is left out of the auto-derived columns, but an explicit `order` always wins and can show it.

```yaml
---
type: base
view: table
properties:
  note.price:
    displayName: "Price (USD)"
  note.internal_id:
    hidden: true
order: [file.name, note.price]
---
```

## Reorder and resize columns

A saved base file lets you reshape the table by hand; an embedded `query` block is read-only for all of this.

- **Reorder.** Drag a header sideways. Release writes the new `order` to the base.
- **Resize.** Grab the right edge of a header, or the left edge of the next one, and drag. Release writes the full `columnWidths` map.
- **Width floor.** The `ui.tableMinColWidth` setting (default 60 px, range 30 to 150) is the narrowest a column can get.

The table uses a fixed layout from the first paint. A column with no stored width gets the width of its own header text, and nothing is written to the file until you drag. Editing a cell therefore never changes any column's width.

Reordering writes `order` containing only the visible columns, so a hidden column drops out of it.

## Cell rendering

The first column is the title cell: the value as a link that opens the note. A row stored in the base's own body has no note, so its title is plain text. A column whose bare name matches a known shape gets a special rendering.

| Bare column name | Rendering |
|---|---|
| `status` | A coloured dot and the status word. |
| `tags`, `tag` | A plain teal `#tag` list. |
| `rating`, `stars`, `score` (numeric value) | Five gold stars. |

Every other cell shows the value as text: links as links, booleans as a `[ ]` or `[x]` glyph, dates as `YYYY-MM-DD`, lists joined with commas, and empty values as `—`.

## Tasks mode

With `mode: tasks`, the table keeps its ordinary columns instead of folding each row into a task line like the [list and bullets views](list-bullets.md#tasks-mode-rendering-shared-by-both-views) do. Two columns change:

- **`status`** shows a live checkbox. Click toggles the task; right-click opens the status menu.
- **`due`** is painted in the danger colour when the task is overdue: due before today and not resolved (a done or cancelled task is never overdue).

All other columns render as in normal mode.

## Add, edit and delete rows

A saved base file supports every row operation from the table itself.

- **Add a row.** Click **New row** in the view bar. A base that owns its rows appends a row to its own body, seeded from the declared property defaults. A base sourced from notes creates an `Untitled` note in the base's folder and opens its row editor. If the base's filters would hide the new row, a toast says so. In `tasks` mode the bar offers **New task** instead.
- **Edit a cell.** Click it. The editor matches the property's declared type, or the value's own shape when no type is declared. Enter or blur saves; Escape cancels.
- **Toggle a boolean.** Click a boolean cell. It flips immediately and never opens an editor.
- **Edit tags.** A tags cell opens as one comma-separated line with tag completion from the column's own values, then every tag in the vault. Tab or Enter takes the highlighted suggestion, and Enter with no popup saves the list.
- **Edit or delete a whole row.** Right-click the row to open the row editor, which lists every column and has a delete action. Both a deleted stored row and a trashed note offer an Undo toast.

The `file.*` and `formula.*` columns are read-only, and so are the fields of a task line, which edit through the task editor. A note row's title cell opens the note on a plain click.

## Settings panel

The gear icon in the view bar opens the table settings panel over the live view. It edits the view kind, `mode`, `source`, `filters`, column visibility, sort, group-by, `limit`, `summaries` and `formulas`, and every field writes a plain top-level key. **Save** writes only the keys that changed. **Reset** restores the defaults. At least one column must stay visible. The panel can set several sort keys, so the multi-key `sort` above needs no hand editing.

## Gotchas

- `order: []` shows every column. It does not hide all of them.
- A column missing from `order` is hidden even when rows carry it, and a `formula.*` column appears only when listed.
- A `summaries` key that matches no column produces no footer cell.
- The `columns:` key is a group order for the table, and has nothing to do with the column list. The column list is `order`.

## How it works

`TableView.tsx` renders the grid from a `ViewResult` that `runView` in `core/src/bases/query.ts` produces: formulas, then filter, sort, column resolution, grouping and summaries. `parse.ts`'s `normalizeView` reads the frontmatter, mapping the author-facing `columns:` onto `ViewConfig.groupOrder`.

Reorder and resize are pointer-based, not HTML drag and drop. A `pointerdown` inside the 10 px resize zone (`RESIZE_GRAB_PX`) starts a resize; anywhere else on the header starts a reorder. Both write through `api.setProperty(basePath, ...)`, and the callbacks are only passed when the base has a path, which is what makes embedded blocks read-only. `TableView` stays mounted across refetches and re-applies `columnWidths` from props, skipping the update while a drag is in progress.

Cells render through `TableCell.tsx` and `renderValue.tsx`; the name heuristics live in `columnKinds.ts`. Row creation and deletion go through `rowWrites.ts` and `openRowEditor.tsx`. The settings panel is `BaseSettings.tsx`, and `baseSettingsPlan.ts` decides which keys a Save writes.

Source: `app/src/bases/TableView.tsx`, `app/src/bases/TableCell.tsx`, `app/src/bases/renderValue.tsx`, `app/src/bases/columnKinds.ts`, `app/src/bases/columnLabel.ts`, `app/src/bases/AddRowAction.tsx`, `app/src/bases/BaseSettings.tsx`, `app/src/bases/baseSettingsPlan.ts`, `core/src/bases/query.ts`, `core/src/bases/parse.ts`, `core/src/bases/types.ts`
