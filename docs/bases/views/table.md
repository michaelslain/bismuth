# Table View

The table view renders a base's rows as a spreadsheet-style HTML table with sortable, groupable, reorderable, and resizable columns. It is the default fallback view when no other view type matches — if `type: table` is declared in a view config or no explicit type is set by the Switch in `BaseView.tsx`, rows render as a table. Column widths are persisted per-view in the base file's frontmatter under `columnWidths`, and column order is written back to `order`. All interactive mutations (reorder, resize, settings) require a `basePath` (a saved `.md` base file); embedded `query` blocks are read-only for these interactions.

---

## View Frontmatter (`ViewConfig` fields for `type: table`)

Declare a table view inside a `type: base` markdown file's `views:` array:

```yaml
---
type: base
views:
  - type: table
    name: My Table
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
      note.rating: 80
    limit: 50
    filters: "#book"
---
```

### All Table-Relevant `ViewConfig` Fields

| Field | Type | Description |
|---|---|---|
| `type` | `"table"` | Selects the table renderer. Required. |
| `name` | `string` | Tab label shown in the view bar when a base has multiple views. |
| `order` | `string[]` | Explicit column list. Property ids, e.g. `file.name`, `note.price`, `formula.ppu`. When set, **only these columns are shown**; columns not listed here are hidden even if present in the data. When unset, all columns not marked `hidden: true` in `BaseConfig.properties` are auto-derived. An empty array (`order: []`) means "no preference → show all auto-derived columns" (NOT zero columns — see gotchas). |
| `sort` | `SortSpec[]` | Sort keys applied in order (stable multi-key sort). Each entry: `{ property: string, direction?: "ASC" \| "DESC" }`. |
| `groupBy` | `{ property: string; direction?: "ASC" \| "DESC" }` | Group rows by this property. Groups appear in type-aware order (numbers numerically, dates chronologically) honoring `direction`, unless overridden by `columns`. |
| `columns:` (YAML) → `groupOrder` (`ViewConfig`) | `string[]` | Explicit group order for a grouped table. The author-facing frontmatter key is `columns:`, but `parse.ts` `normalizeView` reads it into `ViewConfig.groupOrder` (there is no `ViewConfig.columns` field). Groups listed here appear first in declaration order; data-only groups not in the list are appended sorted by value. Unlike kanban, groups with zero rows are NOT kept — a declared group only appears when it has rows. |
| `summaries` | `Record<string, string>` | Column footer aggregates. Key is a property id (bare or namespaced); value is a summary name: `"Sum"`, `"Average"`, `"Min"`, `"Max"`, `"Count"`, `"Empty"`, `"Filled"`, `"Unique"`. |
| `columnWidths` | `Record<string, number>` | Per-column pixel widths, keyed by property id (e.g. `"file.name": 240`). Written automatically after drag-resize; safe to set manually. |
| `limit` | `number` | Maximum rows per group (applied after sort/filter). |
| `filters` | `FilterNode` | Per-view filter ANDed with the base-level `filters`. |
| `mode` | `"normal"` \| `"tasks"` | Whether every row IS a task, independent of `type`/`source` — the same [mode axis](../overview.md#three-axes-kind-mode-and-origin) `list`/`bullets`/`cards`/`kanban` read. Default `"normal"`. In `"tasks"` mode the table gets two affordances instead of becoming a task line (unlike every other row view — see [Cell Rendering in Tasks Mode](#cell-rendering-in-tasks-mode)): the `status` column renders a live `TaskCheck` checkbox and the `due` column paints overdue. |

---

## Column IDs and Property Namespaces

Column ids follow a dot-prefix namespace convention:

| Prefix | Resolves from | Example |
|---|---|---|
| `file.` | `FileMeta` fields | `file.name`, `file.path`, `file.mtime`, `file.tags` |
| `note.` | Frontmatter key | `note.status`, `note.rating`, `note.price` |
| `formula.` | Computed formula | `formula.ppu`, `formula.total` |
| *(bare)* | Frontmatter key (auto-canonicalized to `note.*`) | `status` → treated as `note.status` |

`canonicalId("price")` returns `"note.price"` — summaries keyed on bare names are normalized internally.

### Auto-Derived Columns

When `order` is absent (or empty), columns are auto-derived:

1. `file.name` is included **only** if any row has a non-empty `file.name` (i.e. rows from distinct notes, not a base-source base that shares a synthetic name).
2. Every `note.*` key seen across all filtered rows is included.
3. Columns where `BaseConfig.properties[id].hidden === true` (or `BaseConfig.properties[bareKey].hidden === true`) are excluded.

The `hidden` flag on `properties` only suppresses auto-derivation. A view's explicit `order` always wins — you can include a hidden column by putting it in `order`.

### Column Header Labels

Header text is computed by `columnLabel(id, config)`:

1. `config.properties[id]?.displayName` — custom label wins if set.
2. Strip namespace prefix: `file.name` → `"name"`, `note.price` → `"price"`, `formula.ppu` → `"ppu"`.
3. Bare id returned as-is for unknown prefixes.

Set a custom label in the base file's `properties` section:

```yaml
---
type: base
properties:
  note.price:
    displayName: "Price (USD)"
  note.rating:
    hidden: true
---
```

---

## Column Order

### Via Frontmatter (`order`)

Declare the exact column sequence as an array of property ids:

```yaml
order:
  - file.name
  - note.status
  - note.rating
  - note.tags
  - formula.score
```

Any column not in `order` is hidden. Formula columns (`formula.*`) must be explicitly included to appear.

### Via Drag-Reorder (Interactive)

When the base has a file path (i.e. is a saved base file, not an embedded query block), dragging a column header left or right reorders columns. The mechanism:

- Pointer-based (not HTML5 DnD): `pointerdown` on the header body starts a reorder drag.
- The **right-edge resize zone** (`RESIZE_GRAB_PX = 10px`) on the right edge of a header (or left edge of the next header — both sides of the boundary are grabbable) intercepts the pointer and starts a **resize**, not a reorder.
- On `pointerup`, the moved column is spliced to the target position and `api.setProperty(basePath, "order", newCols)` is called, which writes `order: [...]` back to the base file's frontmatter.

Reorder is disabled for embedded `query` blocks (no `onReorder` prop passed).

---

## Column Widths

### Via Frontmatter (`columnWidths`)

```yaml
columnWidths:
  file.name: 240
  note.status: 100
  note.price: 80
```

Widths are in pixels. A column with no entry here gets a default, seeded once on first paint
from its header's own rendered natural width (so an unstyled table's first paint looks exactly
like the old auto-layout table) — see [Fixed Layout, Always](#fixed-layout-always) below.

### Via Drag-Resize (Interactive)

Grab the right edge of any header (within `RESIZE_GRAB_PX = 10px` of the cell's right boundary, or the left edge of the next column) and drag horizontally.

Behavior:
- The table is table-layout:fixed at all times (see below) with `width = sum(all column widths)px` — this stops the browser from redistributing space to other columns (spreadsheet semantics: only the grabbed column changes).
- Columns before the grabbed column are pinned exactly; columns after shift as a block.
- The minimum column width is controlled by `settings.ui.tableMinColWidth` (default `60`, range `30–150`, configured in `.settings`).
- On release, `api.setProperty(basePath, "columnWidths", widths)` writes the full widths map back to the base file.

### Fixed Layout, Always

The table renders `table-layout: fixed` with a `<colgroup>` from the moment it mounts, not only
once every column has a `columnWidths` entry. A column with no stored width gets a default,
measured once on first paint from its own header's rendered natural width (identical to what the
old auto-layout table would have shown), then held fixed forever after. This is what makes
clicking a cell to edit it — a `<select>` trigger, a text input, a date picker — never widen or
narrow any column: by the time a cell can be clicked, every column's width is already pinned,
edited cell or not. Dragging a header still writes the real value to `columnWidths`; an
unresized column's *effective* width (used for layout) is the same default until a drag sets
one, but nothing is written to the file until that drag happens.

#### Width Persistence vs. Reload

`TableView` stays mounted across `BaseView` refetches (SSE-triggered vault change, etc.). A `createEffect` re-applies the latest `columnWidths` from props when they change on reload — but only when no resize drag is in progress.

---

## Sort

Configured as a list of sort specs (multi-key, stable):

```yaml
sort:
  - property: note.status
    direction: ASC
  - property: note.rating
    direction: DESC
```

- `property`: any property id (`file.*`, `note.*`, `formula.*`, bare).
- `direction`: `"ASC"` (default) or `"DESC"`.
- Sort is applied to the post-filter, pre-group rows.
- The sort is stable: rows with equal values for all sort keys retain their original relative order.
- Comparison is type-aware: numbers sort numerically, dates chronologically, strings lexicographically (`compare()` from `values.ts`).

Via the **Settings modal** (gear icon in the view bar), sort can also be configured interactively:
- "Sort by" dropdown: any column or "None".
- "Sort direction" dropdown (visible only when Sort by is set): Ascending / Descending.
- Settings writes a single-entry `sort` array (`[{ property, direction }]`); multi-key sort requires manual frontmatter editing.

---

## Grouping

```yaml
groupBy:
  property: note.status
  direction: ASC
```

- `property`: the column whose values define groups.
- `direction`: group ordering direction (`"ASC"` default / `"DESC"`). Type-aware sorting: numbers numerically, dates chronologically — **not** alphabetical.
- Each group renders a full-width header row (`.groupRow`) spanning all columns, then its rows below.
- The first group (key `""`) suppresses its header row — meaning an ungrouped view is a degenerate single group with an empty key.

### Explicit Group Order (`columns`)

```yaml
groupBy:
  property: note.status
columns: [Todo, "In Progress", Done, Blocked]
```

- Groups in `columns` appear first, in declaration order, **only if they have rows** (unlike kanban, which keeps empty declared groups as drop targets).
- Data-only groups not in `columns` are appended, sorted by value.

---

## Summaries (Column Footer)

A `<tfoot>` row renders when `view.summaries` is non-empty:

```yaml
summaries:
  note.price: Sum
  note.rating: Average
  note.count: Count
```

Supported summary names (case-sensitive):

| Name | Behavior |
|---|---|
| `Sum` | Sum of numeric values |
| `Average` | Mean of numeric values |
| `Min` | Minimum numeric value |
| `Max` | Maximum numeric value |
| `Count` | Count of all values (including null) |
| `Empty` | Count of null / undefined / `""` values |
| `Filled` | Count of non-null / non-empty values |
| `Unique` | Count of distinct string representations |

- Summaries are computed over the post-filter, **pre-limit** row set (all matching rows, not just the shown page).
- The key can be bare (`price`) or namespaced (`note.price`) — `canonicalId()` normalizes both to `note.price` when looking up the summary value.

---

## Cell Rendering

The first column (`ci() === 0`) renders as a **title cell** (`renderTitle`):
- Accent book icon + an `<a>` link that dispatches a custom `bismuth-open` event to open the note.
- If the value is a `Link` object (e.g. from `file.asLink(...)` or the `link()` function), the link's display text and target path are used; otherwise the row's `file.path` is opened.

All other columns render as **data cells** (`renderCell`), with special handling for heuristically detected column names:
- `status` / `note.status` — colored dot + word via `StatusText`.
- `tags` / `tag` — plain teal `#tag` list, no chips.
- `rating` / `stars` / `score` with a numeric value — five gold star icons.
- All others — generic `renderValue`: links as `<a>`, booleans as literal text (`'x'` for `true`, `''` for `false`) in a `.boolCell` span, dates as `YYYY-MM-DD`, arrays as comma-separated, nulls/undefined as `—`.

A boolean is deliberately **never** rendered as a check icon: `renderValue.tsx`'s own comment states the rule — "Typed glyph, not an SVG check … per the ASCII system's renderValue rule: booleans render as text, never an icon asset."

Non-first columns (except tags and ratings) get a `.cellMuted` style for visual de-emphasis.

### Cell Rendering in Tasks Mode

The table is the **one** row view that does not fold a task row into a single task line the way `list`/`bullets`/`cards`/`kanban` do (see [tasks mode rendering](list-bullets.md#tasks-mode-rendering-shared-by-both-views)) — a checkbox, a description and five bracket-field chips do not fit a table cell, and folding a row into one would throw away the columns the table exists to show in the first place. Instead, in `mode: tasks` the table keeps its ordinary column layout and gives exactly two columns task-aware rendering, by the same bare-name heuristic `isStatusColumn`/`isDueColumn` use elsewhere (`bareName(id) === 'status'` / `'due'`):

- **`status` column** — renders a live `<TaskCheck variant="cell">` checkbox instead of the normal status dot/text. Clicking it calls the `onToggle` prop (toggles the task's status); right-clicking it calls `onSetStatus` (opens the status menu). The checkbox's glyph state comes from `checkStatus(row.note.status)`, the same mapping every other tasks-mode row uses. The cell does **not** get the `.cellMuted` de-emphasis style while showing the checkbox.
- **`due` column** — gets the `.cellOverdue` style when `isOverdue(row.note, todayISO())` is true — the same overdue rule (`--danger` token, due strictly before today and not resolved/done) documented for the `due` chip in [list/bullets tasks mode](list-bullets.md#tasks-mode-rendering-shared-by-both-views).

Every other column renders exactly as it does in `mode: normal` — the title column still uses `renderTitle`, and non-status/non-due data columns still go through the normal `status`/`tags`/`rating`/`renderValue` heuristics above. `onToggle` and `onSetStatus` are the same handler pair `BaseView` threads to every other view kind (`list`, `bullets`, `cards`, `kanban`); the table's `status`-column checkbox is simply where that pair surfaces here.

---

## Adding, Editing and Deleting Rows

Every row a table can show is reachable from the UI — no action requires hand-editing the base file or a note's frontmatter.

**Requires a saved base file** (`basePath` set) — same gate as reorder/resize above. An embedded `query` block is read-only.

- **Add a row**: the "+ row" button in the view bar (mode `normal` only — `mode: tasks` keeps its own "+ task" button instead). A base that **owns its rows** (no `source:`) appends a new row to the base's own body, seeded from any declared property `default`s. A **notes-sourced** base creates a new note (named "Untitled", deduped) in the base's folder, seeded the same way. Then click its cells to fill it in; if the base's filters would hide the new row from this view, a toast says so and names where it actually landed.
- **Edit a cell**: click it. The cell turns into a type-aware editor in place (`TableCell.tsx` over `PropertyValueEditor`: text, number, date, select, markdown, … — a declared property type picks the control, otherwise the value's own shape does; a table never guesses a dropdown from the other rows' values), **except a boolean cell**, which never opens an editor at all — a click commits the flip (`!value`) immediately and the cell still reads `x`/blank. For every other kind, Enter or blur saves, Escape cancels. The write is `openRowEditor.tsx`'s `commitMeta`: a row stored in the base's own body is rewritten by index, a note row's frontmatter key is set (an emptied cell removes the key). `file.*`/`formula.*` columns and a task LINE's fields stay read-only here — a task line edits through the task editor.
- **Edit or delete a row**: right-click any editable row to open the row editor modal (`openRowEditor`, the same modal `[✎]` buttons elsewhere in the app open) — it lists every column this view shows and carries its own delete action. A row stored in the base's own body is removed by index; a note row is moved to trash — both offer an Undo toast from inside the modal.
- A note row's title cell **still opens the note** on a plain click, exactly as before; its other cells edit in place. There is no separate pencil button.

---

## Settings Modal

Clicking the gear icon in the view bar opens the `BaseSettings` modal (not a page — it floats over the live view). For record types including `table`:

**Columns section**: toggle individual columns visible/hidden. The last visible column cannot be hidden (would paradoxically show all columns since `order: []` means "show all"). The modal shows every column seen across all current rows, with columns not in the current `order` as hidden by default if `order` was set.

On save, `order` is written as the array of toggled-on column ids in display order. To reorder, drag headers in the table directly.

**Sort & group section**: dropdowns for Sort by / Sort direction / Group by / Group direction.

**Reset** returns all fields to defaults (all columns visible, no sort, no group).

**Save** writes only the keys that changed, then refetches.

**Settings (full panel).** Beyond columns/sort/group the same modal sets everything a table reads: the view's **name**, **kind** and **rows are** records/tasks (`mode`); the base's **source**; **filters** for this view and for every view; a **row limit** (`limit`, per group when grouped); multi-key **sort** ("sort by" + any number of "then by"); **summaries** — one aggregation per visible column (`summaries:`, `Sum` `Average` `Min` `Max` `Count` `Empty` `Filled` `Unique`; a hidden column keeps its summary; an existing key's `note.`-prefixed spelling is reused); and the base's **formulas**, whose `formula.<name>` columns join the columns list. View keys go into `views[i]` of the active view (`setViewProperty`); a flat top-level copy of the same key — which would override `views[0]` — is removed when `views[0]` is written. The write planning lives in `app/src/bases/baseSettingsPlan.ts`.

---

## BaseConfig-Level `properties` for Table Columns

In `BaseConfig` (the base file's frontmatter top level, outside `views:`):

```yaml
---
type: base
properties:
  note.price:
    displayName: "Price (USD)"
  note.internal_id:
    hidden: true
  internal_id:          # bare form also works
    hidden: true
views:
  - type: table
    order: [file.name, note.price]
---
```

`displayName` and `hidden` behave exactly as described under [Column Header Labels](#column-header-labels) and [Auto-Derived Columns](#auto-derived-columns) above (including that `hidden` only suppresses auto-derivation — an explicit `order` always wins, and both bare and namespaced keys work). This section is simply where those settings live in the frontmatter, shown here with both forms in one example.

---

## Gotchas and Edge Cases

- **`order: []` means "show all"**: An empty `order` array (not absent, but present as `[]`) is treated as "no preference" by `query.ts` and falls back to auto-derived columns. Setting `order: []` in the settings modal does NOT produce zero columns; it shows everything. The Settings modal enforces a minimum of one visible column.
- **The table is always `table-layout: fixed`**: a column with no `columnWidths` entry (e.g. a new column added after widths were saved) gets a default seeded from its own header's natural width on first paint, not a fluid 100% layout. Column widths never move once mounted, editing a cell included.
- **Both sides of a resize boundary are grabbable**: The right 10px of column `i` OR the left 10px of column `i+1` both resize column `i`. This is intentional — the visual separator is centered on the boundary and overhangs into the next cell.
- **Reorder and resize are mutually exclusive per-interaction**: `pointerdown` checks the resize zone first; only if outside the zone does a reorder drag start.
- **Reorder writes `order`; resize writes `columnWidths`**: these are separate frontmatter keys. Reordering removes hidden columns (only visible columns are in the reordered array). Resizing always writes all current column widths.
- **Embedded `query` blocks are read-only**: `onReorder` and `onWidthsChange` are only passed when `data().basePath` is truthy (a saved base file), so drag-reorder and resize are disabled for embedded blocks.
- **Summaries key normalization**: a `summaries` entry keyed on `"price"` (bare) and one on `"note.price"` both resolve to `note.price` via `canonicalId` — only one summary will appear.
- **Width persistence across SSE reloads**: `TableView` stays mounted across base refetches. The `createEffect` re-syncs `columnWidths` from props when they change, but skips the update while a resize drag is in progress to avoid flickering.
- **Boolean cells never mount a text editor**: `propertyEditKind`'s `boolean` kind is checked before a cell opens; a click commits `!value` straight away. `PropertyValueEditor` is never mounted for a boolean column, so there is no `input` to accidentally type into.

---

## Example: Complete Table Base File

```markdown
---
type: base
source:
  kind: notes
  where: "#book"
properties:
  note.isbn:
    hidden: true
  note.title:
    displayName: "Book Title"
formulas:
  value_per_page: "note.rating / note.pages"
views:
  - type: table
    name: Reading List
    order:
      - file.name
      - note.title
      - note.status
      - note.rating
      - note.pages
      - formula.value_per_page
    sort:
      - property: note.rating
        direction: DESC
    groupBy:
      property: note.status
      direction: ASC
    columns: [Reading, "To Read", Done]
    summaries:
      note.rating: Average
      note.pages: Sum
    columnWidths:
      file.name: 220
      note.title: 300
      note.status: 110
      note.rating: 90
      note.pages: 80
      formula.value_per_page: 120
    limit: 200
---
```

---

Source: `app/src/bases/TableView.tsx`, `app/src/bases/BaseSettings.tsx`, `core/src/bases/types.ts`, `core/src/bases/parse.ts`, `app/src/bases/BaseView.tsx`, `core/src/bases/query.ts`, `app/src/bases/renderValue.tsx`, `app/src/bases/columnLabel.ts`, `core/src/schema/settingsSchema.ts`, `app/src/bases/TaskCheck.tsx`, `app/src/bases/taskDisplay.ts`, `core/src/dates.ts`
