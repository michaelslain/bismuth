# List and bullets views

The `list` and `bullets` views show a base's rows as a vertical sequence instead of a grid. `list` gives each row a title with an optional secondary label and a right-hand value; `bullets` gives each row one plain `<li>` that reads like a note's own `- item` list. Both turn a task row into a checkbox line. The other [view kinds](../overview.md) show the same rows differently.

## Minimal working bases

A grouped list of books:

```json
{"type":"base","source":"notes where file.hasTag(\"book\")","view":"list","groupBy":{"property":"note.status"},"sort":[{"property":"note.title","direction":"ASC"}]}
```

A bullet list of quotes:

```json
{"type":"base","source":"notes where file.hasTag(\"quote\")","view":"bullets","groupBy":{"property":"note.author"},"sort":[{"property":"note.author","direction":"ASC"}]}
```

## Config keys

All keys sit at the top level of the base's config (line 1 of a `.base.jsonl` file, or the frontmatter of a markdown base). `filters` and `source` apply as for every kind, as described in the [bases overview](../overview.md).

| Key | Type | Allowed values | Default | Effect |
|---|---|---|---|---|
| `view` | string | `list`, `bullets` | none | Selects the renderer. |
| `order` | `string[]` | property ids | all columns | The columns the engine resolves. `list` reads the first three, `bullets` the first. |
| `sort` | list of `{property, direction}` | `ASC`, `DESC` | none | Stable multi-key sort. |
| `groupBy` | `{property, direction}` | `ASC`, `DESC` | none | Splits rows into labelled sections. |
| `columns` | `string[]` | group values | unset | Group order, not the displayed columns. Declared groups come first; other groups follow sorted by value; declared groups with no rows are omitted. |
| `limit` | number | `0` or greater | none | Maximum rows, applied per group when grouped. |
| `mode` | string | `normal`, `tasks` | `normal` | `tasks` makes every row a task line. |

Use `order`, not `columns`, to choose which properties show.

## List view

Each `list` row is a title built from the first column, then an optional secondary label from the second column after an em dash (`Title — Author`), then an optional right-aligned value from the third column. The title falls back to the file name when the first column is empty. The secondary label is hidden when its value is empty or an object. Columns beyond the third are not displayed; use the [table view](table.md) for more.

```json
{"type":"base","view":"list","groupBy":{"property":"formula.urgency"},"columns":["Overdue","This week","Later"]}
```

A click on a row depends on whether the base is editable:

- **Saved base file.** A click, or a right-click, opens the property editor for that row, for a stored row and a note row alike.
- **Read-only block.** An embedded `query` block cannot edit, so the title is a link that opens the note. A row stored in the base's own body has no note and shows plain text.

## Bullets view

Each `bullets` row is one `<li>` showing the first column through the title renderer. The list uses the UI font, not the prose font, because it is app chrome rather than note text. There are no headers, row borders, icons, secondary labels or extra columns.

| First column holds | The bullet shows |
|---|---|
| A link value, such as `file.asLink("text")` | The link's display text, opening the link's own target |
| Anything else, on a row backed by a note | The text as a link that opens the note |
| Anything, on a row stored in the base's own body | Plain text; in a saved base, a click opens the row editor |

In a saved base, right-click on any bullet opens the property editor.

### Choosing between them

| Need | Pick |
|---|---|
| Prose feel that matches a note's bullet list | `bullets` |
| A secondary label and a right-hand value | `list` |
| Left-click on a note row edits its properties | `list` |
| Left-click on a note row opens the note | `bullets` |
| Task checkboxes on rows that came from a task query, with no `mode:` set | `list` |

## Group headers

With `groupBy`, each non-empty group gets a header in the form `● label // N`: a dot, the label exactly as written, and the row count. Both views use it. Rows with an empty group value get no header.

The dot and label take the group's status colour when the label is one of these (compared case-insensitively, ignoring surrounding spaces); any other label stays neutral grey:

| Group label | Colour |
|---|---|
| `reading`, `doing`, `in progress` | teal |
| `to read`, `toread`, `todo` | blue |
| `finished`, `done`, `complete` | green |
| `abandoned`, `dropped` | rose |

The same palette colours status words in table, cards and kanban.

## Tasks mode rendering (shared by both views)

A row renders as a task line, not as the view's normal markup, when it is a task. A row is a task when the view declares `mode: tasks`, whatever the row looks like. `list` also treats a row as a task when it has the shape a task query produces, even in `normal` mode, so a `source: tasks` list with no `mode:` key still shows checkboxes. `bullets` obeys the declared mode only: a `source: tasks` bullets base without `mode: tasks` shows plain items.

A task line shows a checkbox, the description, and a chip for each field the task carries. The same task line is used by the cards and kanban views in tasks mode.

| Field | Shown as |
|---|---|
| `status` | The checkbox glyph: `done` is checked, `in-progress` a slash, `cancelled` a dash, anything else (or no status) an empty box. |
| `description` | The task text, with inline Markdown. Falls back to the file name. |
| `priority` | A chip `[highest]`, `[high]`, `[medium]`, `[low]` or `[lowest]`. `none` or missing shows nothing. |
| `start`, `scheduled`, `due` | A chip such as `[due 2026-10-07]`. |
| `recurrence` | A chip with the rule, such as `[every month]`. |

The `due` chip takes the danger colour when the task is overdue: its date is before today and the task is neither done nor cancelled. No field uses an emoji. The line syntax that these fields come from is in [task syntax](../../tasks/syntax.md).

Task descriptions render this inline Markdown:

| Written | Shown as |
|---|---|
| `[[Target]]`, `[[Target\|Alias]]` | A link that opens the note, labelled by the alias or the last path segment |
| `[Label](url)` | `http`, `https` and `mailto` URLs open externally; a path with no scheme opens the note; any other scheme is plain text |
| `#tag` | A tag |
| `**bold**`, `*italic*` | Bold, italic |

A task row has no open-on-click. Clicking its body does nothing unless the click lands on a link in the description. Rows that can be edited also show a pencil button that opens the task editor.

### Task origins and the write seam

A task row comes from one of two places, and the task line does not care which:

| Origin | How the row is identified | What ticking the box does |
|---|---|---|
| A checkbox line scanned from a note | It carries a line number | Rewrites that line in its note |
| A row stored in the base's own body (`mode: tasks` with no `source:`) | It carries a row index | Rewrites that row in the base file |

Left-click on the checkbox flips done and todo. Right-click opens a menu with every status. A row with neither a line number nor a usable index shows a checkbox that does nothing; it never errors. Ticking a box never navigates to the note.

## Add, edit and delete rows

A saved base file supports row operations for non-task rows in both views. An embedded `query` block is read-only.

- **Add a row.** Click **New row** in the view bar (normal mode). A base that owns its rows appends a row to its body, seeded from declared property defaults. A notes-sourced base creates an `Untitled` note in the base's folder. Either way the row editor opens, and a toast warns when the base's filters would hide the new row. In `tasks` mode the bar offers **New task** instead.
- **Edit properties.** Click or right-click as described under each view above.
- **Delete a row.** Use delete in the editor footer. A stored row is removed and a note goes to the trash, each with an Undo toast.

## Use them in a query block

An embedded `query` block picks the renderer with `view:`.

````markdown
```query
of: [[My Base]]
view: bullets
```
````

````markdown
```query
tasks:
where: !note.resolved
from: [[My Project Base]]
view: list
```
````

A `tasks:` block with a missing or unrecognised `view:` renders as `list`. Any other block falls back to `table`. `bullets` is never a fallback and has to be named.

## Gotchas

- `columns` orders groups; it does not choose displayed columns. Use `order` for that.
- `list` ignores every column past the third, and `bullets` ignores every column but the first.
- A declared group with no rows is omitted. Only the [kanban view](kanban.md) keeps empty declared groups.
- A `source: tasks` bullets base without `mode: tasks` shows plain items, where the same base as a `list` shows checkboxes.

## How it works

`ListView.tsx` and `BulletsView.tsx` each render a `ViewResult` from `runView` in `core/src/bases/query.ts`. Both key their groups by index, so a re-resolve repaints only the changed rows and the list does not flash on a task toggle. `GroupHeader` in `app/src/ui/` draws the group header and owns the status palette, `STATUS_COLOR` in `StatusDot.tsx`.

`isTaskRow` in `columnKinds.ts` decides task rendering: `ListView` calls it with the view's mode, which returns true for `tasks` mode or for the scanned-task shape (a numeric `note.line`, a string `note.status`, and a `raw` key). `BulletsView` tests `props.mode === 'tasks'` instead.

`TaskRow.tsx` is the shared task line, built from `TaskCheck`, `TaskText` (inline Markdown through `taskInline.ts`) and `TaskFieldChips`. It reads only the `note.*` keys that both row producers emit: `taskToRow` for a scanned line and `normalizeStoredTaskRow` for a stored row, both in `core/src/bases/taskRow.ts`. Overdue uses `note.resolved`, the derived done-or-cancelled flag, falling back to the raw status for rows that never passed through a producer.

`BaseView.tsx` owns the one pair of write handlers, `toggleTaskRow` and `setTaskRowStatus` from `baseTaskWrites.ts`, and passes it to every view kind. A scanned line goes through `POST /tasks/toggle`; a stored row goes through `POST /row/update` (`taskWrite.ts`, gated by `canWriteStoredRow`). `toggleTaskRow` stops propagation itself, and `TaskCheck` stops the pointer events, which matters for kanban cards that arm a drag on pointerdown.

Source: `app/src/bases/ListView.tsx`, `app/src/bases/BulletsView.tsx`, `app/src/bases/TaskRow.tsx`, `app/src/bases/TaskCheck.tsx`, `app/src/bases/TaskText.tsx`, `app/src/bases/TaskFieldChips.tsx`, `app/src/bases/taskDisplay.ts`, `app/src/bases/taskWrite.ts`, `app/src/bases/baseTaskWrites.ts`, `app/src/bases/columnKinds.ts`, `app/src/bases/renderValue.tsx`, `app/src/bases/useRowEditor.ts`, `app/src/ui/GroupHeader.tsx`, `app/src/ui/StatusDot.tsx`, `core/src/bases/taskRow.ts`, `core/src/bases/queryBlock.ts`
