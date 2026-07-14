# Kanban View

The kanban view renders a base's rows as a board of swim-lane columns, one column per group value. It requires a `groupBy` property in the view config; without one, the view renders a hint message instead of a board.

Each card is a note. On a board backed by a real base file (`props.basePath` set — i.e. not an embedded ```query block) the board is fully editable:

- **Drag cards** between/within columns — writes the new group value + a within-column sort index to the note's frontmatter (`POST /set-property`).
- **Drag column headers** to reorder columns — persists the new order to the view's `columns` (`groupOrder`).
- **Edit a card in place** — tap its title to rename the note; tap any meta property chip to edit it through a control matched to its type (text/number/date/select/multiselect/tags, a markdown property opens a multiline textarea, a boolean toggles instantly). See [properties](../properties.md) for how a property's type is determined.
- **Recolor a column** — click its header dot to pick a color from the theme palette; persists to the view's `groupColors`.
- **Add a card** — a compact "+" button (Lucide `Plus`) at the bottom of each column opens a composer that creates a note in the board's folder with that column's value set.

The card face shows the note's **title**, then every other property the view's `order:` lists, rendered as **editable meta chips**. `description` is NOT special-cased (#103) — a board that declares it (or lists it in `order:`) shows it exactly like any other property: rendered through its type (a `type: markdown` property renders block markdown and opens a multiline editor on click; see [`order`](#order) below for the default when it's left undeclared). The card deliberately does NOT echo the `groupBy` value, since the column the card sits in already represents it.

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
groupOrder?: string[]
```

Authors write this in YAML as `columns:`. During parsing (`core/src/bases/parse.ts`) the YAML `columns:` key is mapped onto the `ViewConfig.groupOrder` field (`strArr(o.columns)` → `groupOrder`; the top-level `columns:` shorthand likewise sets `config.views[0].groupOrder`). The query engine (`core/src/bases/query.ts`) then reads `view.groupOrder` — there is no `columns` field on `ViewConfig`. Keep using `columns:` in your YAML; just be aware the parsed field is named `groupOrder`.

`columns:` declares the display order of group keys. This field has special behavior in kanban vs other view types:

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

### `groupColors` (per-column colors)

```typescript
groupColors?: Record<string, string>   // group key -> CSS color
```

Overrides the color of individual columns, keyed by the group value (the same strings as in `columns`). The value is any CSS color — a hex string (`"#e5484d"`) or a CSS variable (`"var(--graph-2)"`). Columns without an entry fall back to the automatic palette (see [Column Colors](#column-colors)). Set interactively by clicking a column header's dot; persisted to the view via `POST /set-property` with a `viewIndex` (so it lands nested inside `views[N]`, not as a duplicate top-level key).

```yaml
views:
  - type: kanban
    groupBy:
      property: note.status
    groupColors:
      TODO: var(--graph-0)
      Done: "#2ecc71"
```

### `descriptionField` (deprecated — no-op)

```typescript
descriptionField?: string   // deprecated (#103); ignored
```

**Deprecated.** Before #103, kanban had a dedicated, always-multiline "description" slot on the card face, and `descriptionField` named the frontmatter property that fed it. That slot no longer exists: `description` is now just a normal declared property (typically `type: markdown`), rendered and edited via the same generic type-aware meta path as any other property (see [`order`](#order) below and [properties](../properties.md)). `descriptionField` is still **parsed** (so old base files don't error) but has **no runtime effect** — remove it at your leisure. To keep a description-like field editable as multiline markdown, either declare it (`properties: [{ name: description, type: markdown }]`) or rely on the fallback default described under `order` below.

### `order`

`order` selects which properties (besides the title, `file.name`) appear on each card as editable meta chips (see [Card Face](#card-face)). Each property renders through its type-aware kind — text/number/date/select/multiselect/tags/markdown/boolean — resolved by `propertyEditKind` (`app/src/bases/propertyEdit.ts`): a base-declared `type:` wins outright; otherwise the vault-wide property registry (`.settings`) is consulted; otherwise **a property literally named `description`** (bare or `note.description`) defaults to **markdown** — the least-surprising choice, since every pre-#103 board treated it as a multiline markdown field — and everything else falls back to a runtime-value/known-values heuristic. Properties that are empty on a given note render nothing on that card (no `—` placeholder). The internal `order` sort-index key remains hidden unless explicitly listed.

Without an `order:`, a base that **declares its own properties** (list-form `properties:` — see the [properties doc](../properties.md)) shows the declared set as the card meta instead (same title/empties exclusions, plus the `groupBy` property is dropped — the column already conveys it), and its add-card composer seeds each declared `default` onto the new note. A base with neither `order:` nor a declaration shows no meta, as before.

```yaml
views:
  - type: kanban
    groupBy:
      property: note.status
    order:
      - file.name
      - file.tags
      - description   # a normal property — markdown by default, editable like any other
      - worktree      # cards show the note's #tags, an editable markdown description, and its worktree value
```

### `hideLabels`

```typescript
hideLabels?: boolean   // default false
```

When `true`, every card's meta section shows only property **values** — no uppercase label caption above them (tag columns already have no label, and are unaffected). Default `false` (labels shown), so existing boards render unchanged. Set via the view's settings panel — a "Hide meta labels — show property values only" toggle, shown only for kanban views — or by hand:

```yaml
views:
  - type: kanban
    groupBy:
      property: note.status
    hideLabels: true
```

Normally (the default) each meta item stacks its label **above** its value — see [Card Face](#card-face).

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

## Card Face

Each card (`app/src/bases/KanbanCard.tsx`) shows:

1. **Title** — the note's filename (`file.name`). Bound to `file.name` specifically (not the base's first display column) so that editing the title is always a **rename** of the note, never a rewrite of some property value. Tap it to edit (see [Editable Cards](#editable-cards)).
2. **Meta** — every other property the view's `order:` lists (everything except the title column), each shown as a chip, its label stacked **above** its value. On an editable board, tapping a chip swaps in a control matched to the property's type (text/number/date/select/multiselect/tags; a declared `markdown` property — `description` included, since #103 dropped its dedicated slot — opens a multiline auto-growing textarea; a boolean toggles instantly with no popover). Tag columns render as teal `#tags` with no label; other columns get a small uppercase label (`columnLabel`) above the value — unless the view's [`hideLabels`](#hidelabels) is `true`, which suppresses every non-tag label and shows values only. Empty values are skipped entirely (except a declared/runtime-boolean property, which always shows so its chip stays reachable). Embedded ```` ```query ```` kanbans render the same meta section, read-only (no `basePath` to write back to).

The card intentionally does **not** render the `groupBy` value or a generic field dump — the column already conveys the status, and only the properties the view's config explicitly lists appear on the card.

---

## Column Colors

Each column's color is resolved by `colColor(key, index)` in `KanbanView.tsx`, in priority order:

1. **Explicit override** — `groupColors[key]` from the view config (set via the header dot's color picker).
2. **Known-status palette** — `STATUS_COLOR[key]` from `app/src/ui/StatusDot.tsx` for semantic statuses (`reading`→teal, `done`/`finished`/`complete`→green, `abandoned`/`dropped`→rose, `to read`→blue).
3. **Theme graph palette** — otherwise the column gets a distinct color from the active theme's `accentPalette` ramp (`--graph-0` … `--graph-4`, cycled by column index). This is the theme's designed set of distinguishable-yet-cohesive colors (a rainbow on `oxide-duotone`, a green family on a forest theme), so custom columns vary out of the box instead of all sharing one accent.

The resolved color is applied to the column header's dot, a subtle header background tint, and the header's bottom border (all via a `--kb-col-color` CSS variable on the column). The column title text stays `var(--fg)`.

**Color picker**: clicking a column header's dot opens a small popover of the five theme-palette swatches plus an **Auto** button (which clears the override back to the automatic color). Picking a swatch writes `groupColors[key]` to the view; Auto deletes the entry.

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

**Optimistic + flicker-free.** The drop applies the whole new order to a local overlay (`pending`) *before* the writes, so a moved card never snaps back to its origin during the round-trip. Each overlay entry clears itself once the resolved server row matches it exactly. Cards are rendered **keyed by note path** (a stable primitive) rather than by Row object, so an `order`-only change — which `reconcileRows` treats as a fresh identity — *moves* the card's DOM (FLIP-animated) instead of unmounting/remounting it. Together these remove the "whole board reloads/flickers" feel: only a genuinely column-changed card re-mounts, and it does so once, in place.

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

## Reordering Columns

Column headers are draggable (on editable boards). Dragging a header and dropping it onto another column reorders the columns; the drop position (before/after the target) is decided by the pointer's x vs the target column's horizontal midpoint. Column drag is tracked separately from card drag (`colDrag` signal vs the `draggedPath`/`dragPath` card state) so the two never interfere — while a column drag is active, the column's dragover/drop act as a reorder target instead of a card drop zone.

On drop, the full current column-key order (with the dragged key moved) is persisted to the view's `columns` (`groupOrder`) via `POST /set-property` with a `viewIndex`. Any previously "extra" (undeclared) columns become declared in the process, so they persist as pinned columns.

---

## Editable Cards

On editable boards, the card face edits in place (`KanbanCard.tsx`):

- **Title → rename.** Tapping the title opens an input seeded with the current filename (text pre-selected). Enter (or blur) commits: if the name changed, the note is renamed via `POST /move` to `<same-folder>/<new-title>.md` (filename-sanitized, de-collided against sibling cards). Escape reverts.
- **Meta chip → type-aware editor.** Tapping a writable chip swaps in the control its resolved kind calls for (see [Card Face](#card-face)); a `markdown`-kind chip (e.g. `description`) opens an auto-growing textarea. Blur (or Enter, for single-line kinds) commits: a non-empty value is written to the property's frontmatter key (`POST /set-property`); an emptied value **deletes** the key (`POST /delete-property`). Escape reverts. Only one editor — the title input or a single meta chip — is ever open at a time.

**Tap vs drag.** Because the whole card is `draggable`, a plain `click` is unreliable (the browser's drag machinery can swallow it). Editing is therefore triggered by a pointer **tap detector**: `pointerup` within ~6px of `pointerdown` counts as a tap (edit); more movement is a drag and is left to the card's native drag-and-drop. While a field is being edited, the card's `draggable` is turned off so text selection/caret placement work normally. This also makes touch editing work on iPad.

Local signal mirrors paint the committed value instantly (optimistic) and are re-seeded from the row only when the row's own values change on refetch — `mode` is read untracked so committing doesn't flash the stale pre-write value.

---

## Adding Cards

Each column has a Trello-style composer, shown only when the board is editable **and** the `groupBy` value is writable (a `file.`/`formula.`/`this.` groupBy hides it, since a new card can't be placed in the clicked column without writing that column's value).

Clicking the **"+"** button reveals a textarea; typing a title and pressing Enter creates a note:

- **Folder** — the folder of an existing card (all board cards share one), falling back to the base file's path minus `.md` when the board is empty.
- **Filename** — the title, sanitized for the filesystem and de-collided against the board's notes.
- **Frontmatter** — the `groupBy` key set to the clicked column's value. The value is copied (with its original type) from an existing card in that column when there is one, so a numeric/boolean groupBy writes a number/boolean rather than a stringified key. Plus every frontmatter field that is identical across all existing cards (e.g. a `board:` tag, or a `tags:` array the base filters on) so the new card keeps matching the base's source/filter. Serialized with `yaml.stringify` (handles arrays, numbers, quoting, newlines).

After the write, `props.onChange()` refetches and the card appears in the column.

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
Body: { path: string, key: string, value: unknown, viewIndex?: number }
```

- `path` — vault-relative path of the note to update (e.g. `reading/the-name.md`)
- `key` — the frontmatter key to set (e.g. `status`, `order`)
- `value` — the new value; for status this is the column key string, for order this is a number
- `viewIndex` (optional) — when present, the key is written **inside** `views[viewIndex]` of a `type: base` note rather than at the top level. This is how kanban persists per-view settings (`columns`, `groupColors`) so they land where the base declares its views instead of a duplicate top-level key that would shadow the nested one.

Returns `"ok"` (200) or `404` if the note does not exist. The note must already exist; the endpoint refuses to silently create notes.

Internally this calls `setFrontmatterKey(raw, key, value)` — or `setFrontmatterViewKey(raw, viewIndex, key, value)` when `viewIndex` is given — from `core/src/frontmatter.ts`, then `writeNote`. The view-scoped helper writes into `views[viewIndex][key]` when the base has a `views:` sequence, and falls back to a top-level key otherwise (matching the flat single-view persistence style). `POST /delete-property` accepts the same optional `viewIndex`. It goes through `mutatingHandler`, which automatically:
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
properties:
  - name: description
    type: markdown
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
      - description
    sort:
      - property: note.title
        direction: ASC
---
```

This board will:
- Show four pinned columns in the declared order (empty columns stay visible).
- Color column dots by the known-status palette (`to read`→blue, `reading`→teal, `finished`→green, `abandoned`→rose), overridable via the header dot's color picker.
- Show each card as its title (the note's filename) over an editable meta section: `note.title` and `note.author` as ordinary chips, and `description` rendered as block markdown (declared `type: markdown` above) that opens a multiline editor on click — no dedicated slot, just the generic property path (drop it from `order:` and it stops appearing, same as any other listed property).
- Allow dragging any card to a different column (writes `status` + `order`), dragging column headers to reorder, editing the title and any meta chip in place, and adding cards via the per-column composer.
- Sort cards within each column alphabetically by title (from the `sort` config) until any manual drag reorder overrides the `order` field.

---

## Edge Cases and Gotchas

- **Empty group key**: when a note's groupBy property is missing or empty string, the card is placed in a column labeled `(empty)`. Its key is the empty string `""`.
- **Non-writable groupBy**: using `file.folder`, `formula.x`, or `this.x` as `groupBy.property` means cross-column drags will still reorder within the target column (via `order` writes) but will NOT update the groupBy field itself. The card will visually move, but after the next data refetch it will snap back to its original column. The **"+" add-card button is hidden** for such boards (a new card couldn't be placed in the clicked column). Column reorder, colors, and card title/meta editing still work.
- **Rename mid-edit**: a title rename changes the note's path, so the refetch remounts the card (its identity genuinely changed). Editing is single-mode, so there's no open meta-chip edit to lose in the normal flow; only a value typed into the same card during the brief in-flight window of a just-committed rename would be dropped — a narrow, no-existing-data-loss race.
- **`description` migration (#103)**: pre-#103 boards that relied on the built-in description slot (via a bare `description`/`note.description` in `order:`, or an explicit `descriptionField:`) keep working with no config changes — `description` still appears, still opens a multiline markdown editor by click, and still persists to the same frontmatter key. The differences are cosmetic: it's no longer visually pinned directly under the title (it renders wherever it falls in `order:`, like any other listed property) and there's no "Add a description…" placeholder affordance for an empty value (an empty meta property simply renders no row until it has one). `descriptionField:` itself is now ignored — see [`descriptionField`](#descriptionfield-deprecated--no-op).
- **Overwrite scope**: new-card filenames and rename targets are de-collided against the board's visible notes + this session's fresh adds, but not against a same-named note the board's *filter* hides (there's no reliable client-side disk-existence probe). For the common folder-scoped board every note is a visible row, so this doesn't arise.
- **Concurrent edits**: kanban does sequential writes (status then order); the order write for the dragged card comes after the status write, and reindex writes for other cards run concurrently. A vault SSE event fires after each write, so the view may refetch mid-sequence. The `props.onChange()` call at the end triggers a final refetch to reconcile.
- **`order` column hidden by default**: the `order` frontmatter key is an internal persistence detail. Unless the view config explicitly lists `order` or `note.order` in `order:`, it is filtered out of the card body display.
- **FLIP animation requires the DOM**: the FLIP rect-snapshot + playback runs synchronously in `onColumnDragOver`/`requestAnimationFrame`. If the drag moves very fast (multiple columns per frame), only the last stable state is animated.
- **Drag cleanup on unmount**: a `window` `dragend` listener cleans up drag state if the card's DOM node unmounts mid-drag (e.g. a vault SSE refetch during a drag). This prevents phantom drag state.
- **`columns` empty vs absent**: an explicit empty list (`columns: []` → `groupOrder: []`) is treated the same as absent — `query.ts` gates on `view.groupOrder && view.groupOrder.length`, so an empty list falls through to value-ordered groups. Note also that the `hasExplicitOrder` check in `KanbanView` reads `props.result.view.order` (the card-body property list), not `groupOrder` — column ordering (`columns:` → `groupOrder`) and card-body property visibility (`order:` → `order`) are separate config fields.

Source: /Users/michaelslain/Documents/dev/bismuth/app/src/bases/KanbanView.tsx, /Users/michaelslain/Documents/dev/bismuth/core/src/server.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/bases/types.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/bases/parse.ts, /Users/michaelslain/Documents/dev/bismuth/core/src/bases/query.ts, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/CardBody.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/ui/StatusDot.tsx, /Users/michaelslain/Documents/dev/bismuth/app/src/bases/BaseView.module.css, /Users/michaelslain/Documents/dev/bismuth/app/src/api.ts
