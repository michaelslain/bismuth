# kanban

A Trello-style drag-drop board, one column per distinct `groupBy` value.

## Working example

```yaml
---
type: base
source: notes where "#book"
views:
  - type: kanban
    name: By Status
    groupBy:
      property: note.status
    columns: [to read, reading, finished, abandoned]
    order: [note.title, note.author]
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `groupBy` | `{ property, direction? }` | **required** | Which column a card lands in. Without this key the view renders a hint message, not a board. |
| `columns` (→ `groupOrder`) | `string[]` | value-sorted | Column display order. **Kanban-specific:** every listed key stays visible as an (empty) column even with zero cards — other view types drop empty declared groups. |
| `groupColors` | `Record<groupKey, cssColor>` | auto palette | Per-column color override (hex or `var(--token)`). |
| `order` | `string[]` | none | Which properties (besides the title) show as editable meta chips on each card. |
| `hideLabels` | `boolean` | `false` | Hide the uppercase label caption above each meta chip, values only. |
| `descriptionField` | `string` | — | **Deprecated, no-op** (#103) — still parsed for old files but does nothing. |

## Failure modes

- **`groupBy` must name a low-cardinality field.** Kanban makes one column per distinct value — a numeric or free-text field (e.g. `note.rating` or `note.title`) produces one column per row/value, not a usable board. Use a small enum-like field (`status`, `stage`, `priority`).
- **`groupBy` must be a *writable* key for drag-drop to persist.** `note.status`/bare `status` are writable; `file.*`/`formula.*`/`this.*` are not — a card dragged to a new column visually moves but snaps back to its original column on the next refetch, and the "+" add-card button is hidden entirely for such boards.
- **The card body has no dedicated description slot anymore** (#103 removed it) — a `description` field is just a normal property. To get a rich multiline markdown editor for it, either declare it (`properties: [{ name: description, type: markdown }]`) or list it in `order:` and rely on the bare-name-`description` → markdown default.

Full reference: `docs/bases/views/kanban.md`
