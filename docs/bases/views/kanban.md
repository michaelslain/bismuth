# Kanban View

The kanban view renders a base's rows as a board of swim-lane columns, one column per group value. It requires a `groupBy` property in the view config; without one, the view renders a hint message instead of a board. Cards are draggable between columns — dropping a card writes the new group value and a within-column sort index back to the note's frontmatter via `POST /set-property`. Column order and the set of visible columns (including empty ones) is controlled by `columns` in the view config. Column header colors follow a built-in status palette with an accent fallback.

---

## Required Configuration

A kanban view **must** have a `groupBy` property. Without it, the view renders:

```
This kanban view needs a "groupBy" property. Add e.g. groupBy: note.status to the view.
```

Minimal valid config in a `type: base` file:

```yaml
---
type: base
source: notes where #book
views:
  - type: kanban
    groupBy:
      property: note.status
---
```

---

## View Config Fields

All fields below are set inside a single view object under `views:` in a `type: base` markdown file. These are fields from `ViewConfig` in `core/src/bases/types.ts` that are relevant to kanban.

### `groupBy` (required)

```typescript
groupBy?: { property: string; direction?: "ASC" | "DESC" }
```

The frontmatter property whose value determines which column a card belongs to. Each distinct value in the data becomes a column.

- `property`: A property id string. Can be a bare name (`status`), a `note.`-prefixed name (`note.status`), or a `file.`-prefixed name (`file.folder`). See [Writable Keys](#writable-keys) below for which namespaces support drag-drop.
- `direction`: Optional sort direction for the column ordering when no `columns` list is declared. `"ASC"` or `"DESC"`. The sort is value-aware (type-sensitive) and applied by the query engine, not the kanban renderer.

Example:

```yaml
views:
  - type: kanban
    groupBy:
      property: note.status
      direction: ASC
```

### `columns` (column order and empty column pinning)

```typescript
columns?: string[]
```

Declares the display order of group keys. This field has special behavior in kanban vs other view types:

- Groups are rendered in the order listed in `columns`. Data-only keys (groups that exist in the data but are not listed) are appended after the declared list in data order.
- **Empty columns are pinned**: every key in `columns` is shown as a column even when no cards have that value. Without `columns`, a column disappears when its last card is dragged out.
- Other view types (table, list, etc.) only show declared groups that actually have rows — the always-show-empty behavior is kanban-specific.

Example with pinned empty columns:

```yaml
views:
  - type: kanban
    groupBy:
      property: note.status
    columns:
      - "to read"
      - "reading"
      - "finished"
      - "abandoned"
```

With this config, "finished" and "abandoned" stay visible as columns even when no cards have those statuses.

### `order` (column property visibility)

```typescript
order?: string[]
```

The list of property ids to display inside each card (passed to `CardBody`). When `order` is not set or is empty, the `order` (sort key) frontmatter field is hidden from cards — it is an internal persistence detail. When `order` is explicitly provided, all listed properties including `order` / `note.order` are shown in cards.

Example showing all fields including the internal sort key:

```yaml
views:
  - type: kanban
    groupBy:
      property: note.status
    order:
      - note.title
      - note.author
      - note.status
      - note.order
```

### Other standard `ViewConfig` fields

The following standard fields apply to kanban as they do to other view types. See [bases overview](../overview.md) for full details.

| Field | Effect |
|---|---|
| `filters` | Per-view filter, ANDed with the base-level `filters` |
| `sort` | Sort order for rows within each group |
| `limit` | Maximum total rows |
| `name` | Tab label for this view |
| `source` | Per-view source override |

---

## Card Body Layout

Each card renders its fields using the shared `CardBody` component. The layout is compact and design-opinionated:

1. **Title** — the first column in `order` (or `file.name` if no columns are resolved). Rendered as a wikilink-aware title via `renderTitle`.
2. **Author line** — the first column that is not the title and is not a status, rating, or pages column. Shown faint below the title.
3. **Meta row** — a single row with:
   - Left side: status word, color-coded if the value matches a known status string (see [Column Colors](#column-colors))
   - Right side: star rating if a rating column is detected, otherwise a page count if a pages column is detected

Column detection is heuristic, based on the column name:

- **Status column**: detected by `isStatusColumn` — names containing "status", "state", "stage", "phase", "priority", or "category" (case-insensitive).
- **Rating column**: detected by `isRatingColumn` — names like "rating", "score", "stars", "grade", "rank" (case-insensitive).
- **Pages column**: detected by `isPagesColumn` — bare name is exactly `pages`, `pagecount`, or `page_count`.

These heuristics run over the resolved column ids after stripping the `note.` / `file.` / `formula.` prefix.

---

## Column Colors

Column header dots are colored by `groupColor(key)` from `app/src/ui/StatusDot.tsx`. The palette is:

| Key (case-insensitive, trimmed) | CSS variable |
|---|---|
| `reading` | `var(--teal)` |
| `to read` or `toread` | `var(--blue)` |
| `finished` | `var(--green)` |
| `done` | `var(--green)` |
| `complete` | `var(--green)` |
| `abandoned` | `var(--rose)` |
| `dropped` | `var(--rose)` |
| anything else | `var(--accent)` |

The dot in the column header is colored with this resolved color. The column title text is always `var(--fg)` (not the color).

---

## Drag-and-Drop

### User interaction

Drag a card by clicking and holding anywhere on its surface (the cursor shows `grab`; changes to `grabbing` while dragging). While dragging over a column:

- The target column highlights with an accent border and slightly elevated background.
- An animated placeholder shows where the card will land on drop. The placeholder height animates to `46px` at the insertion point.
- Other cards in the column animate to their new positions using FLIP (First-Last-Invert-Play) with a `180ms cubic-bezier(.2,.7,.2,1)` transition, so the surrounding cards slide aside smoothly like Trello.

Drop the card at any position in a target column. If you drag outside all columns and release, the drag is cancelled via a `window` `dragend` handler, and no writes occur.

### Write behavior on drop

Dropping a card triggers sequential writes to the note's frontmatter via `POST /set-property` (`api.setProperty`):

1. **Status write** (cross-column moves only): if the card was dragged to a different column than it started in, `POST /set-property` sets the `groupBy` property to the target column's key. This is skipped for reorders within the same column.

2. **Order write**: `POST /set-property` sets the `order` key to the integer insertion index `i` (0-based, `Math.max(0, Math.min(insertAt, others.length))`).

3. **Reindex side-writes**: for every other card in the target column whose current `order` value differs from its new position `k`, a parallel `POST /set-property` sets `order: k`. These run concurrently via `Promise.all`.

After all writes complete, `props.onChange()` is called to trigger a data refetch in the parent `BaseView`.

The `order` key is always the bare string `"order"` — it is hardcoded in `KanbanView.tsx` as the `ORDER_KEY` constant. It is written to and read from `row.note.order` as a number.

### Writable keys

The property used for `groupBy` must be writable for a cross-column status update to occur. The `writableKey` function in `KanbanView.tsx` determines what frontmatter key to write:

| `groupBy.property` value | Frontmatter key written | Status update occurs? |
|---|---|---|
| `note.status` | `status` | Yes |
| `status` (bare name) | `status` | Yes |
| `file.name` | (non-writable) | No — status write is skipped |
| `formula.x` | (non-writable) | No — status write is skipped |
| `this.x` | (non-writable) | No — status write is skipped |

Specifically:
- Properties prefixed with `file.`, `formula.`, or `this.` return `null` from `writableKey` and the status write is silently skipped. The `order` write still occurs.
- Properties prefixed with `note.` have the prefix stripped: `note.status` → writes `status`.
- Bare property names are written as-is.

---

## Within-Column Sort Order

Cards within a column are sorted by the `effOrder` function:

```
effective_order = (typeof row.note.order === "number") ? row.note.order : group.rows.indexOf(row)
```

If a card has no `order` frontmatter value (or a non-numeric one), it falls back to its index in the group's engine-provided row array. After any drag-drop, all affected cards in the target column get clean integer `order` values.

---

## Backend: `POST /set-property`

The endpoint that kanban drag-drop writes to. From `core/src/server.ts`:

```
POST /set-property
Body: { path: string, key: string, value: unknown }
```

- `path` — vault-relative path of the note to update (e.g. `reading/the-name.md`)
- `key` — the frontmatter key to set (e.g. `status`, `order`)
- `value` — the new value; for status this is the column key string, for order this is a number

Returns `"ok"` (200) or `404` if the note does not exist. The note must already exist; the endpoint refuses to silently create notes.

Internally this calls `setFrontmatterKey(raw, key, value)` from `core/src/frontmatter.ts` and then `writeNote`. It goes through `mutatingHandler`, which automatically:
- Invalidates the graph/tree/rows/tasks caches
- Bumps the server `version`
- Broadcasts an SSE event to all connected clients

This means a kanban reorder will trigger a re-fetch in all open views of the same vault.

---

## CSS Dimensions and Layout

The kanban board (`styles.kanban`) is a horizontal flex row with `overflow-x: auto` and `padding: 18px`. Each column has:

- `min-width: var(--kanban-col-min, 248px)`
- `max-width: var(--kanban-col-max, 288px)`
- `flex: 1` (columns distribute space evenly up to their max)

To customize column widths, override the CSS variables on the host element or globally:

```css
.myBase {
  --kanban-col-min: 300px;
  --kanban-col-max: 360px;
}
```

The column card area (`styles.kanbanCards`) has `padding: 0 10px 12px` and `gap: 9px` between cards.

---

## Complete Example

A `type: base` note for a reading tracker with a full kanban config:

```yaml
---
type: base
source: notes where #book
views:
  - type: kanban
    name: By Status
    groupBy:
      property: note.status
    columns:
      - "to read"
      - "reading"
      - "finished"
      - "abandoned"
    order:
      - note.title
      - note.author
      - note.status
    sort:
      - property: note.title
        direction: ASC
---
```

This board will:
- Show four pinned columns in the declared order (empty columns stay visible).
- Color column dots using the built-in status palette.
- Show each card with a title (serif, bold), an author line below it, and a status badge in the meta row.
- Allow dragging any card to a different column, which writes `status` and `order` to the note's frontmatter.
- Sort cards within each column alphabetically by title (from the `sort` config) until any manual drag reorder overrides the `order` field.

---

## Edge Cases and Gotchas

- **Empty group key**: when a note's groupBy property is missing or empty string, the card is placed in a column labeled `(empty)`. Its key is the empty string `""`.
- **Non-writable groupBy**: using `file.folder`, `formula.x`, or `this.x` as `groupBy.property` means cross-column drags will still reorder within the target column (via `order` writes) but will NOT update the groupBy field itself. The card will visually move, but after the next data refetch it will snap back to its original column.
- **Concurrent edits**: kanban does sequential writes (status then order); the order write for the dragged card comes after the status write, and reindex writes for other cards run concurrently. A vault SSE event fires after each write, so the view may refetch mid-sequence. The `props.onChange()` call at the end triggers a final refetch to reconcile.
- **`order` column hidden by default**: the `order` frontmatter key is an internal persistence detail. Unless the view config explicitly lists `order` or `note.order` in `order:`, it is filtered out of the card body display.
- **FLIP animation requires the DOM**: the FLIP rect-snapshot + playback runs synchronously in `onColumnDragOver`/`requestAnimationFrame`. If the drag moves very fast (multiple columns per frame), only the last stable state is animated.
- **Drag cleanup on unmount**: a `window` `dragend` listener cleans up drag state if the card's DOM node unmounts mid-drag (e.g. a vault SSE refetch during a drag). This prevents phantom drag state.
- **`columns` empty vs absent**: an explicit empty list (`columns: []`) is treated the same as absent — the `hasExplicitOrder` check in `KanbanView` reads `props.result.view.order` (the card-body property list), not `columns`. Columns ordering and card-body property visibility are separate config fields.

Source: /Users/michaelslain/Documents/dev/bismuth/app/src/bases/KanbanView.tsx, /Users/michaelslain/Documents/dev/bismuth/core/src/server.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/bases/types.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/CardBody.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/ui/StatusDot.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/BaseView.module.css, /Users/michaelslain/Documents/dev/bismuth/app/src/api.ts
