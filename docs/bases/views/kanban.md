# Kanban view

A kanban view shows a base's rows as a board of columns, one column per distinct value of its `groupBy` property. Dragging a card to another column writes that column's value into the card's note; for the other view kinds and the base file format, start at [Bases overview](../overview.md).

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

This board shows four columns in that order, even when one is empty. Each card is a book note: its title is the note's file name, and below it sit the `author` and `description` properties.

## Required configuration

A kanban view needs `groupBy`. Without it the view shows a hint instead of a board: *This kanban view needs a "group by" property. Open `Settings` (the gear in the view bar) and set group by.*

```yaml
---
type: base
source: notes where file.hasTag("book")
view: kanban
groupBy:
  property: note.status
---
```

Pick a property with a few repeating values (`status`, `stage`, `priority`). Each distinct value becomes a column, so a free-text or numeric property gives one column per card. A card whose property is missing or empty sits in a column labelled **(empty)**.

## Kanban config keys

Every key below is a top-level frontmatter key beside `view: kanban`. The base's `filters`, `source`, `formulas` and `properties` apply as for any view.

| Key | Type | Allowed values | Default | Effect |
|---|---|---|---|---|
| `groupBy` | object or string | `{ property, direction? }`; a bare string is the property | required | The property whose value picks a card's column |
| `groupBy.direction` | string | `ASC`, `DESC` | `ASC` | Order of columns not listed in `columns`, by value |
| `columns` | list of strings | any group values | none | Column order; every listed value shows as a column even with no cards |
| `groupColors` | map of value → colour | hex (`"#e5484d"`) or `var(--token)` | auto | Colour of a column's header dot and underline |
| `order` | list of property ids | `note.x`, bare `x`, `file.x`, `formula.x` | see below | Properties shown under each card's title |
| `hideLabels` | boolean | `true`, `false` | `false` | Show property values only, without the key column |
| `mode` | string | `normal`, `tasks` | `normal` | `tasks` turns each card into a task line |
| `sort` | list | `{ property, direction? }` entries | none | Order of cards inside a column until a card is dragged |
| `limit` | number | any integer ≥ 0 | none | Maximum cards per column |

Columns declared in `columns` come first, in the listed order. A value that appears in the data but not in `columns` gets a column after them, ordered by value. An empty list (`columns: []`) behaves like no list.

Without `order`, a base that declares its own property list (list-form `properties:`, see [Base properties](../properties.md)) shows the declared properties, minus the `groupBy` property. A base with neither shows the title alone.

## What a card shows

A card in `mode: normal` shows the note's title, then one line per property from `order`: the property's key, then its value. The value renders through the property's type: a `markdown` property as formatted text on its own line with no key, a boolean as `[ ]` or `[x]`, a number in its format. Tags render on their own line with no key.

- An empty value draws no line, except a boolean property, which always shows so you can switch it on.
- The `groupBy` value is not repeated on the card; the column already says it.
- On a note-backed board, `file.basename`, `title` and `note.title` in `order` name the title itself and add no second line.
- The `order` frontmatter key that drag-and-drop writes stays hidden unless `order` lists it.
- `hideLabels: true` drops the key column. The settings panel's **hide meta labels — show property values only** toggle sets it.

A property named `description` with no declared type, in the base or in the vault's property registry, is treated as `markdown`. Declare a `type:` on it to change that.

## Column colours

A column's colour comes from the first of these that applies:

1. Its entry in `groupColors`.
2. The status palette, for a value it knows (case-insensitive): `to read` and `todo` blue, `reading`, `doing` and `in progress` teal, `finished`, `done` and `complete` green, `abandoned` and `dropped` rose.
3. A slot of the active theme's graph palette (`--graph-0` to `--graph-4`), picked from the column's value rather than its position, so reordering columns never recolours them. Slots already taken by a named column on the same board are skipped.

Click a column's header dot to pick one of the five palette swatches, which writes `groupColors`. **auto** removes the entry.

## Edit the board

Every edit below needs a saved base file. A kanban inside an embedded ` ```query ` block is read-only.

| Action | How | What is written |
|---|---|---|
| Move a card | Drag it to another column or position | The card's `groupBy` property set to the column's value, plus an `order` number on every card in the target column |
| Reorder columns | Drag a column header | The full column list to `columns` |
| Recolour a column | Click the header dot | `groupColors` |
| Rename a column | Hover the column, click **Rename column** | `columns`, any `groupColors` entry, a declared select option, and every card's `groupBy` value |
| Delete a column | Hover the column, click **Delete column** | The value removed from `columns` and `groupColors`; each card loses its `groupBy` property |
| Add a column | Click **Add a column** after the last column | The new value appended to `columns` |
| Add a card | Click **Add a card** under a column, type a title, press Enter | A new note (see below) |
| Edit a card | Click the card | Through the edit modal (see below) |

Deleting a column that still has cards moves them to **(empty)** and offers **Undo**, which restores the column, its colour and each card's value. A card you changed in between keeps your change.

On a board with a `limit`, renaming or deleting a column with cards is refused, because cards past the limit would be left under the old value.

When the `groupBy` property is a declared `select` or `multiselect`, adding or renaming a column also adds or renames that option in the base's `properties:`.

## Add a card

The **Add a card** composer under each column creates one card. On a board whose rows are notes, it writes a new note:

- Folder: the folder of the board's existing cards, or the base file's path without `.md` when the board is empty.
- File name: the typed title, made safe for the file system; a clash gets a ` 2` suffix.
- Frontmatter: declared property defaults, then every property that all existing cards share with the same value (so the new card still matches the base's source and filters), then the column's `groupBy` value, then an `order` that places it last.

On a board that stores its rows in the base file's own body (no `source:`), the composer appends a row there instead, and the title goes into the first writable property in `order` (`title` when there is none).

The composer, **Add a column**, **Rename column** and **Delete column** appear only when `groupBy` names a writable property. A `file.`, `formula.` or `this.` property has nowhere to write a new value.

## Edit a card in the modal

Clicking a card opens the **edit card** modal, focused on whatever you clicked: the title, one property, or the first field. It lists the title and every property in `order`, including empty ones.

- **title**: renames the note, in the same folder. A clash gets a ` 2` suffix.
- A `markdown` property opens a rich text editor that saves on blur and when the modal closes.
- A boolean saves the moment you toggle it.
- Every other type (text, number, date, select, multiselect, tags) saves on blur. Clearing a value removes the key from the note.
- A `file.`, `formula.` or `this.` property is shown read-only.
- **delete** moves the note to the trash with an **Undo** toast. **open note** opens it in a tab. **done** closes the modal.

Right-clicking a card does nothing; there is no card menu.

## Drop an image onto a card

Dropping an image file from Finder or the desktop onto a card, or onto the modal's markdown field, copies it into the vault's attachment folder (`attachments.folder` in `.settings`, resolved relative to the card's note) and appends an `![[file name]]` embed to the card's first writable `markdown` property. The image shows on the card at once.

Accepted types are the image extensions the app recognises (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `avif` and others). If the board has no writable markdown property, a toast says so and nothing is written. See [Attachments](../../vault/attachments.md) for where attachments land.

## Show a board as tasks

`mode: tasks` declares that every row is a task. Each card becomes the shared task line: a checkbox, the description as inline markdown, and the priority, date and recurrence chips, exactly as in the [list and bullets views](list-bullets.md).

```yaml
---
type: base
source: tasks
view: kanban
mode: tasks
groupBy:
  property: note.status
---
```

- Clicking the checkbox toggles done; right-clicking opens the status menu. The write goes to the task's source line or stored row.
- A task card has no edit modal, so no rename, property editing or delete.
- Columns, dragging, colours and the composers work as on any board. **Add a card** adds a note or a stored row, as on a normal board, not a task line inside a note.
- The mode is a declaration. A `source: tasks` board without `mode: tasks` keeps ordinary note cards.

## Order of cards inside a column

Cards in a column sort by their numeric `order` frontmatter value. A card without one sorts by its position in the base's results, which follows `sort`. Dropping a card renumbers every card in the target column from 0, so after the first drag the hand-made order wins over `sort`.

## Column width

Columns are 248 to 288 pixels wide by default. Change the range in `.settings`:

```yaml
ui:
  kanbanColumnMinWidth: 300
  kanbanColumnMaxWidth: 360
```

Both keys are listed in the [settings reference](../../settings/reference.md).

## Silent failures

- A `groupBy` on a `file.`, `formula.` or `this.` property cannot be written. A cross-column drop writes only `order`, so the card returns to its real column when the board reloads.
- A new card's file name is checked only against notes on the board. A note with the same name that the base's filters hide can be overwritten.
- A second view of the same rows is another base file with `source: base` and `ref: "[[Board]]"`. It receives the rows only, not the first base's filters or formulas; see [Sources](../sources.md).

## How it works

`KanbanView` renders columns from the `ViewResult` groups that `runView` (`core/src/bases/query.ts`) builds: `parse.ts`'s `normalizeView` reads the `columns:` key into `ViewConfig.groupOrder`, and `query.ts` keeps empty declared groups only when `view.type === 'kanban'`. `limit` is applied per group there.

Writes live in `kanbanActions.ts` (`createKanbanActions`). A note-board drop sends one `POST /set-properties` batch (`api.setProperties`); a stored-row drop sends `POST /rows/update` (`api.rowUpdateMany`) per file. The branch is `canWriteStoredRow` on the row, never the base's shape. Column order, colours and declared options go through `POST /set-property` and `POST /delete-property` on the base file. `writableKey` (`kanbanMeta.ts`) maps `note.x` to `x` and returns `null` for `file.`/`formula.`/`this.`.

The board is optimistic: `pending`, `pendingAdds`, `pendingColOrder` and `pendingRemovedCols` hold moves, adds and column changes until the SSE-driven refetch matches them. Cards and columns render keyed by row id and column key, so a reorder moves DOM (FLIP-animated by `kanbanFlip.ts` and the `kanbanDrag.ts` pointer engine) instead of remounting it.

Card faces are `KanbanCard` (`metaColumns`, `metaSource`, `metaVisible` in `kanbanMeta.ts`); the modal is `CardEditModal`, with types from `propertyEditKind` (`propertyEdit.ts`). Column colour is `autoGroupColor`/`claimedSlots` in `groupHue.ts` over `STATUS_COLOR`. Image drops use `cardImageDrop.ts` for intake (Tauri's `bismuth-native-drag` event or HTML5 files, arbitrated by `claimNativeDrop`) and `kanbanImageDrop.ts` for the embed. Task cards are `TaskRow` with `variant="card"`.

Source: `app/src/bases/KanbanView.tsx`, `app/src/bases/kanbanActions.ts`, `app/src/bases/kanbanMeta.ts`, `app/src/bases/KanbanCard.tsx`, `app/src/bases/KanbanColumnHeader.tsx`, `app/src/bases/CardEditModal.tsx`, `app/src/bases/groupHue.ts`, `app/src/bases/kanbanImageDrop.ts`, `core/src/bases/parse.ts`, `core/src/bases/query.ts`
