# Tables

A GFM pipe table in a note renders as a real table you edit in place: click a cell and type, press `Tab` to move on, drag to reorder rows and columns, right-click to insert or delete. The file stays plain markdown.

This page covers editing a table as a user and, last, how the widget works. For the markdown a table is built from, see [live-preview rendering](markdown.md).

```markdown
| Name  | Role     | Joined |
| :---- | :------- | -----: |
| Alice | Engineer |   2021 |
| Bob   | Designer |   2023 |
```

A table is a header row, a separator row of dashes, and body rows. Editing keeps the markdown column-aligned as above.

A note's table is the same table a chat message, a card face, a markdown property, a transcluded note and an exported note show, a table inside a callout included: its grid is typed with `+ - | =` (a doubled `=` under the header), and each column sizes to its content. Its editing controls stay in that register: hovering shows a `+` past the right edge (add a column) and below the bottom (add a row) and `∞` above. While extend is on, `[∞]` stays shown at the table's top-left without a hover, and keyboard focus inside the controls shows them too, a column's `|` turns accent under the pointer where it can be dragged to resize, and the cell being edited takes an accent wash. A one-word column takes that word's width, a prose column takes the wrapping, words wrap only between whole words, and a code path wraps at its `/` and `.`. A run longer than any prose word (a bare URL, a long link label, a long identifier) wraps at the cell's edge, so it stays inside its own cell instead of widening its column past the page.

## Write a table in markdown

The separator row sets each column's alignment:

| Separator cell | Alignment |
|---|---|
| `---` | None (left) |
| `:--` | Left |
| `--:` | Right |
| `:-:` | Center in the file, shown left-aligned |

- A cell with a literal pipe is written `\|`; the editor shows `|`.
- A short body row is padded with empty cells and extra cells are dropped, so the grid is always as wide as the header.
- The leading and trailing pipe on each row are optional.
- A table ends at the first line without a pipe.

Alignment can only be set in the separator row. The editor has no alignment control, and a centered column (`:-:`) is kept in the file but drawn left-aligned.

## Edit cells

Click a cell to edit it. The cell becomes a small copy of the note editor, so markdown reveals itself token by token as you type, and wikilink, tag and emoji completion work. When you click out, the cell renders again as formatted markdown. A cell shows the same things a note does: bold and italic, links, `[[wikilinks]]`, `#tags`, math, lists and embedded images.

| Key | What it does |
|---|---|
| `Tab` | Move to the next cell, wrapping to the next row; after the last cell, leave the table |
| `Shift+Tab` | Move to the previous cell; before the first cell, leave the table |
| `Enter` | Start a new line in the cell, or continue a list or quote there; on a plain line in the last row, add a new row instead |
| `Escape` | Close an open completion list, otherwise leave the cell and save |
| `Mod+B`, `Mod+I` | Toggle bold and italic (the rebindable `toggle-bold` and `toggle-italic` keybindings) |
| `Ctrl+Space` | Open autocomplete (the rebindable `open-completion` keybinding) |

Changes are written to the note when focus leaves the table, so moving between cells does not touch the file. Editing a cell rewrites only that row's line; adding, deleting or moving a row or column re-aligns the whole table.

A cell is one markdown line, so a line break inside a cell is stored as `<br>`. A cell whose lines all start with `-`, `*`, `1.` or `1)` is stored as `- a<br>- b` and displays as a list.

Click a `[[wikilink]]` in a cell to open the note. Drop an image, PDF or media file onto a cell to embed it there. By default the file is copied into the vault's attachment folder; set `attachments.onDrop` to `reference` to link it in place. In a browser, holding `Alt` while dropping also links it.

## Add, delete and move rows and columns

- **Add**: hover the table to show a `+` bar along the right edge (add a column) and the bottom edge (add a row). A new column starts in its header cell.
- **Insert or delete**: right-click a cell for the table menu. The menu items are Insert row above, Insert row below, Delete row, Insert column left, Insert column right, Delete column, Delete table, Merge cells, Unmerge cells and Edit source. The header row, the only body row and the only column cannot be deleted, and Insert row above is unavailable on the header.
- **Delete table**: removes the whole table and one adjacent newline in a single undo step.
- **Reorder**: hover a column header to see a grip above it, or hover a body row to see a grip at its left edge. Drag the grip to a new slot; a line shows where it will land. The header row does not move.
- **Resize**: drag the border between two columns. A column cannot be narrower than 40 px. Row height always follows content.

The right-click menu also has an Emoji library button on its left rail, and the picked emoji lands in the cell you clicked.

## Merge cells

Merge body cells into one wide or tall cell:

1. Click a body cell, then `Shift`+click another to select the rectangle between them.
2. Right-click and choose **Merge cells**.
3. To undo, right-click the merged cell and choose **Unmerge cells**, or press `Mod+Z`.

Header cells cannot be merged. The hidden cells keep their text in the file; only the display changes. Merging is undoable and redoable with `Mod+Z` and `Mod+Shift+Z`.

## Extend a wide table

A table always fits the page: when its columns cannot fit even with whole words (many columns in a narrow pane), its cells break inside words as well, so the table wraps to the page instead of running past it. Hover a table and press `∞` (Extend table horizontally) to put every cell on one line and scroll the table sideways instead of wrapping its columns. An extended table, or one whose column widths were dragged, scrolls sideways inside its own box instead, and the side with more table to scroll to fades out. The box scrolls sideways only: scrolling up or down with the pointer over a table scrolls the note. A column whose width was dragged keeps that width in an extended table too, so its cells wrap inside it rather than run across the next column. Press `∞` again to go back.

## Where table layout is stored

Column widths, the `∞` setting and merged cells have no markdown syntax, so they are not in the note. They are saved in the browser's local storage on that device, per note and per table (the table is identified by its header row). Consequences:

- They do not travel with the file to another computer or into an export.
- Changing a header cell's text or the number of columns starts that table from default widths. The `∞` setting follows a reshape; widths and merges follow only a header rename.
- Another editor shows the table without them.

## Search inside a table

`Mod+F` highlights matches inside the rendered cells and scrolls to the current one. The table does not flip to source while you search.

## Edit the raw source

Right-click a cell and choose **Edit source** to see the pipe syntax. The source is re-aligned as it opens, which makes hand-written tables readable. Move the cursor out of the table and it renders again. Only one table is open as source at a time.

The cursor never rests on a rendered table's boundary, so clicking beside a table or arrowing past it lands on the neighboring line.

## Gotchas

- A cell edit is not saved until focus leaves the table. An external change to the note is deferred while a cell has focus, so you do not lose typing.
- A line that contains a pipe directly under a table is read as another body row. Leave a blank line to end the table.

## How it works

| Module | Role |
|---|---|
| `tableModel.ts` | Pure parse and serialize functions, the row and column operations, merge regions and the cursor remap; no CodeMirror or DOM imports |
| `tableState.ts` | `notePathFacet`, `noteNamesFacet`, `tagNamesFacet`, `setActiveTableEffect` and `activeTableField` |
| `tableWidget.ts` | `TableWidget`, the context menu, grips, resize, merge, find highlight and file drop |
| `cellEditor.ts`, `cellEditorExtensions.ts` | The nested in-cell CodeMirror editor and the markdown stack it shares with the note editor |
| `cellBlockRender.ts` | The idle (display) face of a cell, rendered with the note reader's engine |
| `tableResizeDrag.ts` | Column-resize drag lifecycle and `∞` helpers |
| `cellList.ts` | The `<br>`-separated list convention, shared with `bases/markdown.ts` |
| `ui/table/typeTable.ts`, `alignCells.ts`, `tableEdges.ts`, `codeBreaks.ts`, `longRuns.ts`, `fitTable.ts`, `scrollFade.ts` | The table shared with every rendered surface: the typed grid, the cell rules, the column alignment, the code-token breaks, the long-run breaks, the squeeze to fit, the scroller's edge fade |
| `ui/table/MarkdownTable.tsx`, `typeTables.ts`, `exportTables.ts` | The table in rendered markdown HTML (chat, card faces, markdown properties, transclusion) and in an export |

`groupTableBlocks(doc)` finds table blocks (a separator row under a line with a pipe, then every following line with a pipe) and is memoized per document. `parseTableBlock` returns a rectangular `{ cells, aligns }` grid with the separator row removed; `serializeTable` writes it back padded by display width (CJK and emoji count as two columns), with `|` re-escaped. Parsing then serializing returns the same cells.

`livePreview.ts` replaces each table block with a `TableWidget` through a `StateField`, because block decorations cannot come from a view plugin. The widget's `eq` compares serialized markdown, so a cursor move elsewhere keeps the DOM and any edit in progress. Blocks in `activeTableField` are left as source until the cursor leaves their line range.

Each cell has two faces. The display face is `renderCellBlockHtml(src)`, the reader's `renderNoteBody` over the cell source with `<br>` turned into newlines; embeds are swapped in after sanitizing so a PDF iframe survives. The edit face is a nested `EditorView` mounted by `mountCellEditor`, loaded with `cellSourceToBlockMarkdown` and read back with `cmDocToCellSource`. `cellEditor.ts` is imported dynamically (it pulls in `livePreview`'s Solid components, which the headless test transform cannot compile); `toDOM` pre-warms the chunk so the first click mounts synchronously.

`commit` runs when focus leaves the whole table. It re-reads each cell from the DOM (the live editor doc for a cell in edit mode, `data-src` for the rest), computes the new markdown, and dispatches the smallest changed span, so undo and the save-time merge touch only the edited region. An in-place edit goes through `surgicalTableEdit` (changed row lines only); structural operations go through `formatTable`. Dispatches use `dispatchKeepScroll`, which pins the scroll position while CodeMirror re-measures the taller widget. The cell to focus after a rebuild is stashed in `pendingCellFocus` and claimed by document position.

The widget hands its `<table>` to `typeTable` (`app/src/ui/table/typeTable.ts`), the same call every table in rendered markdown HTML goes through: `typeTables` (`typeTables.ts`) mounts a `MarkdownTable` frame on each table a chat bubble, card face, flip card, markdown property or `.md` transclusion renders, and `typeExportTables` (`exportTables.ts`) types an export's tables. `alignCells` copies marked's `align="left|right"` onto each cell as an inline `text-align`, which outranks the shared cell rule's `text-align: left`; `center` is left to that rule. The `bismuth-table` class picks up global.css's "Markdown tables" section: cell padding, top alignment, `overflow-wrap: normal` so auto layout sizes each column from its longest word, and `break-word` only on a table carrying `data-fixed-columns` (set once a column is resized). `typeTable` puts `<wbr>` at the joints `codeBreaks` finds in each code token, wraps each run `longRuns` marks (more than `LONG_RUN` characters without whitespace) in a `bismuth-long-run` span whose `overflow-wrap: anywhere` drops it out of its column's minimum width, and mounts an `AsciiCellEdges` overlay in every shown cell, with the edges it owns decided by `cellEdges` from the cell's place and span, so a merged cell types the outline of its whole rectangle. The module mounts Solid roots, so the widget imports it dynamically like `cellEditor.ts` and sets the `bismuth-table` class itself; a cell's display or edit face rewrite puts its overlay back with `reattach`, and every merge re-types the grid through the wrap's `_retype`. `watchFitTable` (`fitTable.ts`) watches the note's content width and the table: a table still wider than its scroll box with whole words gets `data-squeezed`, whose cells take `overflow-wrap: anywhere`, except in `∞` mode or once a resize has frozen `table-layout: fixed`.

Merges, `∞` and widths live in `localStorage` under `bismuth:table-size:<notePath>`, a map from the JSON of the header row to `{ cols, rows, infinity, merges }`. `rows` is always empty. `reshapeVisual` carries state to a new key when a structural edit changes the header. A merge dispatches a no-document-change transaction carrying `setTableMergesEffect`; `tableMergeUndo` registers the inverse effect so merges join the editor's undo history.

`tableSelectionGuard` (a transaction filter) and `tableUndoSelectionGuard` (an update listener, because undo bypasses filters) remap a collapsed cursor off a table's line range with the pure `remapCursorOffTable`, which prevents a caret as tall as the widget. Programmatic selections and source mode are exempt.

`tableFindHighlight` is a view plugin that wraps matches of the open find query in `mark.cm-table-find-match` inside display cells, and marks the active match with `cm-table-find-active`. It never dispatches a transaction.

Right-click on WebKit would select a word, so the widget cancels `selectstart` for the press and restores the previous selection (`suppressRightClickWordSelect`). Resize and reorder drags end on every plausible end event (pointer up, cancel, mouse up, window blur), so a release outside the window cannot leave them stuck.

A file dropped on a cell is handled twice. In a browser, capture-phase `dragover` and `drop` listeners on the widget root dispatch a `bismuth-table-drop` window event that `Editor.tsx` turns into upload plus `insertEmbedsInTableCell`. In the packaged app, Tauri intercepts the drag and `app/src/nativeDrop.ts` re-broadcasts it as `bismuth-native-drag` with client-pixel coordinates; `Editor.tsx` then resolves the cell geometrically with `tableCellDropTargetAtPoint` (the pure `cellRectAtPoint`, not `elementFromPoint`), lets one handler claim the drop (`claimNativeDrop`), and blurs any cell mid-edit first so its uncommitted text is not discarded. A native drag has no modifier keys, so `attachments.onDrop` alone decides copy or reference.

The context menu is delivered as a `bismuth-context-menu` window event, the same one the note editor uses, and rendered by the app's shared menu.

Source: `app/src/editor/tableModel.ts`, `app/src/editor/tableState.ts`, `app/src/editor/tableWidget.ts`, `app/src/editor/tableResizeDrag.ts`, `app/src/editor/cellEditor.ts`, `app/src/editor/cellEditorExtensions.ts`, `app/src/editor/cellBlockRender.ts`, `app/src/editor/cellList.ts`, `app/src/editor/livePreview.ts`, `app/src/ui/table/typeTable.ts`, `app/src/ui/table/alignCells.ts`, `app/src/ui/table/MarkdownTable.tsx`, `app/src/ui/table/typeTables.ts`, `app/src/ui/table/exportTables.ts`, `app/src/ui/table/tableEdges.ts`, `app/src/ui/table/codeBreaks.ts`, `app/src/ui/table/longRuns.ts`, `app/src/ui/table/fitTable.ts`, `app/src/ui/table/scrollFade.ts`, `app/src/global.css`, `app/src/nativeDrop.ts`, `app/src/Editor.tsx`
