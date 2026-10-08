# kanban

A drag-and-drop board with one column per distinct `groupBy` value. Dragging a card writes the column's value into its note.

## Working example

```yaml
---
type: base
source: notes where file.hasTag("book")
view: kanban
groupBy:
  property: note.status
columns: [to read, reading, finished, abandoned]
order: [note.author, description]
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `groupBy` | `{ property, direction? }` or a property string | required | Picks a card's column. Without it the view shows a hint, not a board. |
| `columns` | `string[]` | value order | Column order. Every listed value shows as a column even with no cards. |
| `groupColors` | `Record<value, cssColor>` | auto palette | Per-column colour, hex or `var(--token)`. |
| `order` | `string[]` | declared `properties:` minus `groupBy` | Properties shown under each card's title. With neither, cards show the title only. |
| `hideLabels` | `boolean` | `false` | Show property values without their key column. |
| `mode` | `'normal' \| 'tasks'` | `'normal'` | `tasks` makes each card a task line (checkbox and chips) and removes the edit modal. |
| `limit` | `number` | none | Maximum cards per column. Renaming or deleting a non-empty column is refused while a limit is set. |

## Failure modes

- If `groupBy` names a free-text or numeric property, every card gets its own column. Use a property with a few repeating values (`status`, `stage`, `priority`).
- If `groupBy` names a `file.`, `formula.` or `this.` property, a cross-column drag writes nothing to the group value, so the card returns to its old column on reload, and the add-card, add-column, rename and delete controls are hidden. Use a `note.` or bare property.
- If `order` lists `file.basename`, `title` or `note.title` on a note board, no extra line appears: all three name the card's title.
- A `description` property with no declared `type:` renders and edits as markdown. Declare a `type:` in `properties:` to change it.
- Inside an embedded ` ```query ` block the board is read-only. Edits need a saved base file.

Full reference: [docs/bases/views/kanban.md](../views/kanban.md)
