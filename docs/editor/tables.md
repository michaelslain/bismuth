# GFM Pipe Tables — Interactive Widget

This document covers everything about how Bismuth renders and edits GitHub Flavored Markdown (GFM) pipe tables inside the CodeMirror editor. A GFM table in a note is replaced by a fully interactive `<table>` DOM widget with contenteditable cells, Tab/Enter navigation (Enter is row-aware — line break except a new row on the last row, #42), Shift+Enter multi-line cells, drag-to-resize **column widths only** (row height is auto, #52; persisted in localStorage), add/delete row and column affordances, a right-click context menu (that shows *only* the menu — WebKit-safe, no word-select, #43), inline-markdown rendering in the display face (including `#tag` chips, #41), `<br>`-carried bullet/number lists inside a cell that survive WebKit's contenteditable read-back (#15), in-cell `:emoji:` autocomplete (#49), no center alignment (#53), in-place Cmd+F match highlighting (never flips to source, #31), and image/media drop straight into a cell — including the packaged-Tauri native-drop path (#30). Focusing a cell never scrolls the viewport (#50). The modules involved are: the pure markdown↔grid model (`tableModel.ts`), shared CodeMirror state (`tableState.ts`), the widget itself (`tableWidget.ts`), inline-markdown rendering for display cells (`inlineMarkdown.ts`), the cell-list convention (`cellList.ts`, shared with the note reader `bases/markdown.ts`), and the in-cell emoji autocomplete (`cellEmoji.ts`).

---

## Table of Contents

1. [The Markdown–Grid Model (`tableModel.ts`)](#the-markdowngrid-model-tablemodelts)
2. [CodeMirror State (`tableState.ts`)](#codemirror-state-tablestatets)
3. [The Editable Widget (`tableWidget.ts`)](#the-editable-widget-tablewidgetts)
4. [Inline Markdown in Cells (`inlineMarkdown.ts`)](#inline-markdown-in-cells-inlinemarkdownts)
5. [Lists Inside Cells (`cellList.ts`)](#lists-inside-cells-celllistts)
6. [Integration with `livePreview.ts`](#integration-with-livepreviewts)
7. [Keyboard Navigation Reference](#keyboard-navigation-reference)
8. [Drag-Resize and Size Persistence](#drag-resize-and-size-persistence)
9. [Context Menu and Structural Edits](#context-menu-and-structural-edits)
10. [Source / Raw-Edit Mode](#source--raw-edit-mode)
11. [Find-in-Table Highlighting (#31)](#find-in-table-highlighting-31)
12. [File Drop Into a Cell (#30)](#file-drop-into-a-cell-30)
13. [Gotchas and Edge Cases](#gotchas-and-edge-cases)

---

## The Markdown–Grid Model (`tableModel.ts`)

This module is pure (no CodeMirror or DOM dependencies) and can be unit-tested in isolation. It implements the codec between GFM pipe-table markdown source and an in-memory cell grid.

### Types

```ts
type Align = "left" | "center" | "right" | "none";

interface TableBlock {
  startLine: number;   // 1-based; the header row
  endLine: number;     // 1-based; the last body row, inclusive
  cells: string[][];   // row 0 = header; separator row NOT included
  aligns: Align[];     // per-column alignment from the separator row
}

interface TableGrid {
  cells: string[][];   // row 0 = header
  aligns: Align[];     // per-column alignment
}
```

The separator row is consumed and discarded during parsing; it is reconstructed from `aligns` during serialization.

### Separator Row Detection: `isSeparatorRow(line, prev)`

```ts
isSeparatorRow("| --- | --- |", "| a | b |")  // true
isSeparatorRow("| --- |", "no pipes here")      // false — prev must have a |
isSeparatorRow("just text", "| a |")            // false — must contain -
```

The regex requires at least one pipe total and at least one dash. The preceding line must itself contain a pipe. This prevents accidental detection inside non-table content.

### Row Parsing: `parseTableRow(line)`

Splits one markdown table row into trimmed cell strings.

- Strips the leading and trailing empty pseudo-cells created by outer `|` rails.
- Unescapes `\|` → literal `|` in the returned display text (the grid holds display text; `serializeTable` re-escapes when writing back).
- Trims each cell.

```ts
parseTableRow("| a | b | c |")      // ["a", "b", "c"]
parseTableRow("a | b")               // ["a", "b"]  — no outer rails required
parseTableRow("|x|y|")               // ["x", "y"]
parseTableRow("| a \\| b | c |")    // ["a | b", "c"]  — unescaped
```

### Alignment Parsing: `parseAlign(cell)`

Maps one separator-row cell string to an `Align`:

| Separator cell | Result     |
| :------------- | :--------- |
| `---`          | `"none"`   |
| `:--`          | `"left"`   |
| `--:`          | `"right"`  |
| `:-:`          | `"center"` |

Leading/trailing whitespace is trimmed before testing.

> **Center alignment renders as LEFT (#53).** "Centering in tables should not be possible." A `:-:` separator still **parses** to `"center"` and **round-trips** through `serializeTable` (the source stays valid and is never rewritten), but the widget applies `text-align` only for `"left"` / `"right"` — a center column renders left. The widget offers **no** alignment UI (no cell/column menu item sets alignment; it comes only from the raw separator row), so there is no affordance that produces a centered cell. Reading-mode surfaces that use `marked`'s own table tokenizer (`app/src/bases/markdown.ts`) still emit `align="center"` for a `:-:` column — to make centering impossible everywhere, that renderer's `tablecell` should map `center` → `left` too.

### Block Parsing: `parseTableBlock(lines)`

Takes the raw lines of one table block (header at `lines[0]`, separator at `lines[1]`, body rows at `lines[2...]`) and returns `{ cells, aligns }`.

- The grid is always rectangular: ragged body rows are padded with empty strings to the header column count; extra cells in body rows are truncated.
- The `aligns` array is similarly padded/truncated to `cols`.

```ts
parseTableBlock([
  "| Name | Age |",
  "| :--- | --: |",
  "| Alice | 30 |",
  "| Bob |",           // ragged — padded to ["Bob", ""]
]);
// cells: [["Name","Age"],["Alice","30"],["Bob",""]]
// aligns: ["left","right"]
```

### Document Scanning: `groupTableBlocks(doc)`

Scans a full CodeMirror `Text` document and returns:

```ts
{ blocks: TableBlock[]; byLine: Map<number, TableBlock> }
```

- Iterates from line 2 upward (a table needs at least a header + separator).
- When a separator is found, extends forward greedily: any subsequent line containing `|` is included as a body row.
- `byLine` maps every 1-based line number inside a block to its `TableBlock` for O(1) lookup.
- Skips forward past the block's end, so blocks are never double-counted.

```ts
// Given a doc with a table at lines 3-6:
const { blocks, byLine } = groupTableBlocks(doc);
blocks[0].startLine  // 3
blocks[0].endLine    // 6
byLine.get(3)        // === blocks[0]
byLine.get(7)        // undefined
```

### Serialization: `serializeTable(cells, aligns)`

Converts a grid back to normalized, column-padded markdown. Rules:

- Column widths are the maximum encoded cell width per column, floored at 3 (GFM minimum).
- Separator cells respect `aligns`: `"left"` → `:----`, `"right"` → `----:`, `"center"` → `:--:`, `"none"` → `----`.
- Text alignment padding: `"right"` left-pads, `"center"` splits evenly, everything else right-pads.
- Literal `|` inside cells are re-escaped as `\|`. Newlines in cell text become spaces (a cell is one markdown line).
- Output rows are `| cell | cell |` with a single space on each side.

```ts
serializeTable(
  [["Name", "Age"], ["Alice", "30"]],
  ["left", "right"],
);
// "| Name  | Age |\n| :---- | --: |\n| Alice |  30 |"
```

**Round-trip guarantee**: `parseTableBlock(serializeTable(cells, aligns).split("\n"))` returns the same cells (verified in tests).

### Structural Row/Column Ops

Four pure grid transforms back the widget's right-click menu. Each takes a `TableGrid` and returns a **new** `TableGrid` (never mutates its input), so they compose cleanly and are unit-tested in isolation (`tableModel.test.ts`). Every op keeps the table well-formed — the header row (index 0) is never removed and the grid never drops to zero rows or zero columns — so `serializeTable` always emits valid GFM afterward.

| Op                          | Effect                                                                                     | Guard (returns an unchanged copy) |
| --------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| `insertRow(g, at)`          | Insert a blank body row at `at`, clamped to `[1, rows]`. `at = r` inserts above row `r`; `at = r + 1` below it. | Header stays first (clamp) |
| `deleteRow(g, at)`          | Remove body row `at`.                                                                       | `at ≤ 0` (header) or only 1 body row |
| `insertColumn(g, at)`       | Insert a blank column at `at`, clamped to `[0, cols]`, with a `none` alignment.             | — |
| `deleteColumn(g, at)`       | Remove column `at` from every row and its alignment.                                        | Only 1 column left |

---

## CodeMirror State (`tableState.ts`)

Two shared pieces of CodeMirror state, plus a facet, factored out to avoid circular imports between `tableWidget.ts` and `livePreview.ts`.

### `notePathFacet`

```ts
Facet.define<string | null, string | null>
```

The current note's vault path, supplied by the editor host. The widget reads it to scope size persistence in localStorage per note. Combined with `values[0] ?? null` (first-wins).

### `setActiveTableEffect`

```ts
StateEffect.define<number | null>
```

Dispatch this effect with a 1-based header-line number to flip a table block from the widget (rendered) mode to raw source mode, or pass `null` to clear. Used by the "Edit source" menu item and by `livePreview.ts`'s own toggle.

### `activeTableField`

```ts
StateField.define<number | null>
```

Holds the header-line number of the table block currently shown as raw source, or `null`. Update logic:

- Always accepts a `setActiveTableEffect` unconditionally.
- While a block is active (`value != null`), if the cursor moves outside the block's current line range (recomputed via `groupTableBlocks` on every selection change), the field resets to `null`. This means the block collapses back to the widget as soon as the cursor leaves it.
- When a transaction has no `setActiveTableEffect` and no doc/selection change, the value is left unchanged.

---

## The Editable Widget (`tableWidget.ts`)

`TableWidget extends WidgetType`. It receives `cells: string[][]`, `aligns: Align[]`, and optionally `notePath: string | null`.

### Lifecycle

#### `eq(other)`

Re-render is suppressed when `serializeTable(this.cells, this.aligns) === serializeTable(other.cells, other.aligns)`. This means a cursor move inside the same document keeps the existing DOM (and any in-progress edit) intact.

#### `toDOM(view)`

Builds the full DOM once. The root `<div class="cm-table-wrap">` is `contenteditable="false"` (atomic for CodeMirror) and contains:

1. `<table class="cm-table-rendered">` with a `<colgroup>` for drag-resize widths
2. `<button class="cm-table-edge cm-table-add-col">` (add column)
3. `<button class="cm-table-edge cm-table-add-row">` (add row)
4. `<div class="cm-table-overlay">` with per-column `.cm-col-resize` handles and per-row `.cm-row-resize` handles

#### `destroy(dom)`

Disconnects the `ResizeObserver` attached at `dom._tableRO`.

#### `ignoreEvent()`

Always returns `true` — CodeMirror should not process events that originate inside the widget; the cells handle their own input.

### Cell Dual-Face Architecture

Each `<th>` or `<td>` has **two faces** keyed by `data-editing`:

| State               | `data-editing` | Content                                         |
| :------------------ | :------------- | :---------------------------------------------- |
| Display (idle)      | `""` / unset   | **Full block render** — `renderCellBlockHtml(data-src)` (#15) |
| Edit (focused)      | `"1"`          | Raw markdown source, with `<br>` for line breaks |

**The display face renders through the note-reading BLOCK engine (#15, "the block thing").** `editor/cellBlockRender.ts` converts the cell's stored `<br>` markers to real newlines and runs `bases/markdown.ts renderNoteBody` — the exact engine reading mode / cards / transclusion use (marked with `breaks:true`, KaTeX with progressive self-upgrade, `[[wikilink]]` → `a.bismuth-wikilink[data-href]` anchors, `#tag` → `span.bismuth-tag`, code masking, DOMPurify sanitize). So `- a<br>- b<br>- c` renders a **real `<ul><li>`** exactly like a note body would, ordered/nested lists included; `line one<br>line two` keeps its soft break (`breaks:true`). This **supersedes the `<br>`-marker cellList rendering for the widget's display face** (`cellList.ts` remains the note-reader's own table-cell convention in `bases/markdown.ts`). **Embeds** (`![[img]]` / `![alt](url)`) are cut out *before* the block render into sanitize-surviving `span.cm-cell-embed-slot` placeholders and swapped for the real media DOM (`renderEmbedHtml`: img / pdf iframe / audio / video / note chip with GET /asset URLs) *after* `innerHTML` assignment (`upgradeCellEmbeds`) — DOMPurify would otherwise strip a PDF `<iframe>`. Cell-scoped CSS in `Editor.css` (`.cm-td p/ul/ol/...`) zeroes block margins so row height never explodes (still auto, #52); the reader's chips are styled there to match the editor's `.cm-wikilink`/`.cm-tag` marks, and the cell click handler opens **both** chip shapes (#33). The EDIT face and the read-back (`cellSourceFromDom`) are untouched.

The canonical cell source is stored in `data-src`. On `focusin` the widget calls `enterEdit`, which sets `innerHTML = srcToEditHtml(data-src)`, converting `<br>` markers in the stored source to real `<br>` DOM nodes. On `focusout` the widget calls `leaveEdit`, which reads the live DOM back via `cellSourceFromDom`, stores it in `data-src`, and re-renders the display face.

#### `srcToEditHtml(src)` — internal

Escapes HTML entities, then converts the `<br>` markers (`<br>` or `<BR>` or `<br/>` etc.) to real `<br>` DOM nodes. If the result ends with a `<br>`, appends a zero-width space (`​`) so the caret has a visible landing point after the break.

#### `cellSourceFromDom(cell)` — internal (exported for tests)

Walks the cell's DOM **recursively** into logical lines (`cellDomLines`), then joins them with the `<br>` marker, strips ZWSP fillers, and `.trim()`s. A contenteditable encodes an in-cell line break in one of **four** engine-dependent shapes, and every one is normalized to `<br>`:

| Break shape in the DOM | Produced by | Read-back |
| :--------------------- | :---------- | :-------- |
| a real `<br>` element (at **any** depth, not just a direct child) | Shift+Enter (`insertBreakAtCaret`), some paste | `<br>` |
| a raw `\n` **character** in a text node | some engines / paste | `<br>` |
| a **block wrapper per line** — `<div>` / `<p>` / … | **WebKit/Safari** contenteditable (its default block), Chromium continuation lines | `<br>` between blocks |
| — inline element (`<span>`/`<b>`/…) | rich paste | **no** break (text stays on its line) |

**The block-wrapper case is the reopened #15 in the packaged WebKit (Tauri WKWebView) app.** Safari wraps each continuation line in a `<div>`; the old direct-child-only `<br>` walk concatenated those with **no** separator, so a typed list `- a`⏎`- b`⏎`- c` read back glued (`- a- b- c`) — re-splittable by `splitCellItems` *only* when the previous item ends in a non-space char, and **lost entirely** for a trailing-space item (`- a `⏎`- b` → `- a - b`, which is deliberately not re-split — a space before the dash reads as prose) or a plain two-line cell (`line one`⏎`line two` → `line oneline two`, words merged). Emitting a `<br>` at each block boundary makes the read-back uniform across engines, so the cell re-renders as the list/lines the user typed. A block whose content already ended with a `<br>` doesn't double-count, and an **empty** block adds no spurious line (a trailing Shift+Enter break stays exactly one `<br>`). `.trim()` strips only surrounding whitespace, never the `<br>` markers. This is the inverse of `srcToEditHtml`.

**Why not `innerText`?** A trailing `<br>` followed by nothing is silently dropped by `innerText`, causing Shift+Enter line breaks at the end of a cell to not save. `cellSourceFromDom`'s explicit node walk captures them correctly.

### Click Handling

`mousedown` on a cell:

1. **Right-click (`button === 2`, #43):** `preventDefault()` + `stopPropagation()` and return immediately. `preventDefault` cancels **Chromium's** select-word-on-right-mousedown default without clearing an existing selection (right-clicking *on* a selection keeps it). But **WebKit/Safari** — the packaged Tauri WKWebView — word-selects on right-click *regardless* of the mousedown default: its selection is driven by the `selectstart` step of the gesture, not the mousedown. So the widget also installs `suppressRightClickWordSelect(cell)` for the press: a **capture-phase `selectstart` guard** that `preventDefault()`s (cancels WebKit's new word-selection before it starts) plus a **save/restore** of the pre-press selection (belt-and-suspenders for any engine that selects without a cancelable `selectstart`). An existing selection is preserved; a right-click with no prior selection ends with none. The guard is torn down (and the selection restored) on the gesture-ending `contextmenu` / `mouseup` — the capture-phase restore runs *before* the table's bubble-phase `contextmenu` opens the menu, so the menu sees the correct selection. The context menu itself is opened by the separate `contextmenu` listener. (Before this, the Chromium-only `preventDefault` left the packaged WebKit app still highlighting a word AND opening the menu.)
2. Calls `e.stopPropagation()` + `e.preventDefault()` to prevent CodeMirror from stealing the click (which would move the editor selection to the widget boundary).
3. Calls `cell.focus({ preventScroll: true })`. **The `preventScroll` is load-bearing (#50):** a plain `.focus()` scrolls the focused element into view, so clicking a cell — especially in a tall table that's partly off-screen — yanked the viewport down to that cell. `focusCell` (Tab/Enter cell-to-cell navigation and the Enter-grows-a-row focus) passes `preventScroll: true` for the same reason; where a table edit legitimately changes block height, the viewport is pinned by `dispatchKeepScroll`, never by a focus scroll.
4. Uses `caretRangeFromPoint` (Chrome/Safari) or `caretPositionFromPoint` (Firefox) to place the text caret at the exact click position, falling back to the end of cell content.

### Paste Handling

Paste is intercepted on every cell. HTML and rich-text payloads are discarded; only `text/plain` is used. Newlines in the pasted text are collapsed to spaces (since a cell is one markdown line).

### Commit Mechanism

The widget dispatches a CodeMirror change when focus leaves the entire table (`focusout` fires on the root `cm-table-wrap` when `relatedTarget` is outside the root). The commit:

1. Calls `currentRange(view, root)` to recompute the source range from the live document at commit time (so edits elsewhere between last render and commit do not desync).
2. Calls `readGrid(root)` to read all cell sources from the DOM. Cells with `data-editing="1"` (still in edit mode at commit time, e.g., when a menu action is triggered while a cell is focused) are read via `cellSourceFromDom`; all others via `data-src`.
3. Calls `serializeTable` and dispatches the change only if the markdown has actually changed (no-op guard).

The `commit` method accepts an optional `transform` callback of type `(g: TableGrid) => TableGrid | void`. Structural mutations (add/delete row or column) return the new grid from the pure `tableModel` ops; an in-place edit may instead mutate `g` and return `void`. Whatever is returned (or the mutated `g`) is serialized.

---

## Keyboard Navigation Reference

All key events inside cells are stopped from propagating to CodeMirror's keymap. The following behavior is implemented in the `keydown` listener:

| Key                 | Behavior                                                                                    |
| :------------------ | :------------------------------------------------------------------------------------------ |
| `Tab`               | Move to the next cell (right). Wraps to the first cell of the next row. Blurs if at the last cell of the table (triggers commit). |
| `Shift+Tab`         | Move to the previous cell (left). Wraps to the last cell of the previous row. Blurs if at the first cell. |
| `Enter`             | **Row-aware (#42).** On any row EXCEPT the last, Enter inserts a soft in-cell line break — exactly like Shift+Enter. On the **last** row it grows the table by appending a blank body row and drops the caret into that new row's same column. (An in-cell list line still continues the list first — see below.) The pure decision is `enterAction(rowIndex, rowCount)` → `"line-break" \| "new-row"` in `tableModel.ts`. |
| `Shift+Enter`       | Insert a soft line break within the current cell. Inserts a real `<br>` DOM node at the caret (not `execCommand("insertLineBreak")`). The break is stored as the literal string `<br>` in `data-src`. |
| `Escape`            | Blur the cell (triggers commit).                                                            |
| `Mod+A`             | Select all content in the focused cell (scoped to the cell; does not select the whole document). |
| `Mod+B / Mod+I / Mod+U` | Blocked. Native rich-text formatting commands (`<b>`, `<i>`, `<u>`) are suppressed. |

`focusCell(r, c)` moves focus programmatically by querying `[data-cell][data-r="${r}"][data-c="${c}"]` and placing the caret at the end of the cell.

---

## Drag-Resize and Size Persistence

GFM markdown has no syntax for cell sizes. **Only column width is user-adjustable** — row height is always automatic from content (#52). Column widths are stored **outside the markdown source** and applied as visual-only overrides.

### Storage

Sizes are persisted in `localStorage` under the key `bismuth:table-size:<notePath>`. The value is a JSON object mapping `sizeKey` (the JSON-serialized header row, e.g. `'["Name","Age"]'`) to `{ cols: (number | null)[], rows: (number | null)[] }`. The `rows` array is kept in the shape for backward-compatibility but is **always written empty** (`[]`) and **ignored on load** — height is auto (#52). Any row heights in older persisted data are silently dropped.

- If `notePath` is `null` (path-less buffer, not used in practice), sizes fall back to an in-memory `Map`.
- If `localStorage` is unavailable or throws, the same in-memory fallback is used.
- Sizes reset automatically if the **header row or column count changes** (the `sizeKey` changes). A body-only edit preserves sizes.

### Column Resize

Each column gets a `<div class="cm-col-resize">` positioned via an absolutely-positioned overlay (`cm-table-overlay`). The overlay is kept outside the contenteditable cells so its content is never clobbered by the dual-face swap.

On the first drag of a column, the table switches from `tableLayout: auto` to `tableLayout: fixed` and each `<col>` element's `width` is frozen to the current measured cell width. Subsequent drags move a `<col>`'s width directly. Minimum column width: 40px.

### Row Height (auto — not resizable, #52)

There is **no** row-resize handle. A row's height is always determined by its content (`min-height`/`line-height` on the cells). "Only width should be able to be changed in cells — column width, not row height; that should be automatic." The widget renders `cm-col-resize` handles only; there is no `cm-row-resize` element or drag path.

### Handle Layout

Handle positions are recomputed (`layout()`) on:
- `requestAnimationFrame` after widget attachment
- `pointerenter` (belt-and-suspenders: the first rAF may fire before CodeMirror has measured the freshly-attached widget)
- `ResizeObserver` callbacks on the `<table>` element

Sizes are persisted (`persist()`) on `mouseup` after a drag.

---

## Context Menu and Structural Edits

Right-clicking a cell dispatches a `CustomEvent("bismuth-context-menu")` with `{ x, y, items }` on `window`. App's shared `<ContextMenu>` component listens for this event. The menu items and their behaviors:

| Label                  | Icon      | Behavior                                              | Disabled when        |
| :--------------------- | :-------- | :---------------------------------------------------- | :------------------- |
| Insert row above       | ArrowUp   | `insertRow(g, r)`                                     | On the header row (`r === 0`) |
| Insert row below       | ArrowDown | `insertRow(g, r + 1)`                                 | Never                |
| Delete row             | Trash2    | `deleteRow(g, r)`                                     | Header row, or only 1 body row left |
| Insert column left     | ArrowLeft | `insertColumn(g, c)`                                  | Never                |
| Insert column right    | ArrowRight| `insertColumn(g, c + 1)`                              | Never                |
| Delete column          | Trash2    | `deleteColumn(g, c)`                                  | Only 1 column left   |
| Delete table (#59)     | Trash2    | Deletes the WHOLE block (+ one adjacent newline) in one dispatch → ONE undo step restores it | Never |
| Edit source            | Code      | Dispatches `setActiveTableEffect.of(line)` → raw mode | Never               |

A separator appears before "Insert column left" and before "Edit source". Every structural item calls a pure `tableModel` op (see [Structural Row/Column Ops](#structural-rowcolumn-ops)) that returns a new grid, so the serialized markdown stays valid after each edit.

> **Event name.** The menu is delivered via `CustomEvent("bismuth-context-menu")`, the same event `editor/contextMenu.ts` uses and that `App.tsx` listens for. (An earlier build dispatched the pre-rename `oa-context-menu`, which nothing listened for — so right-click did nothing; fixed to `bismuth-context-menu`.)

All row/column operations read the **live DOM grid** at the time `onSelect` fires (not a stale copy), so any in-flight cell edit is captured before the structural change commits. Each operation calls `this.commit(view, root, transform)`.

The `+` edge buttons on the table's bottom and right edges also add rows and columns (via the same `insertColumn` / `insertRow` ops):
- `.cm-table-add-col` (right edge): `insertColumn(g, cols)` — appends a blank column + a `"none"` align.
- `.cm-table-add-row` (bottom edge): `insertRow(g, rows)` — appends a blank row.

Both use `mousedown` with `preventDefault()` + `stopPropagation()` to avoid losing cell focus before the grid is read.

---

## Source / Raw-Edit Mode

A table block can be toggled to show its raw pipe-table source for structural or power edits. This is controlled by `activeTableField` in `tableState.ts`.

### Entering Raw Mode

1. Via the context menu: "Edit source" item dispatches `setActiveTableEffect.of(headerLine)` and moves the editor cursor to the block's start, then focuses the editor.
2. Via `livePreview.ts` (e.g., double-clicking a code block uses a similar pattern).

### Exiting Raw Mode

- Moving the cursor outside the block's line range automatically resets `activeTableField` to `null` (the `StateField.update` logic).
- The block immediately re-renders as the widget.

### Widget Rebuild After Raw Edits

When the user edits the raw source and then moves the cursor out, `tableWidgetField` in `livePreview.ts` rebuilds the `DecorationSet` via `buildTableWidgets`. The new `TableWidget` gets the freshly-parsed grid. `TableWidget.eq` compares serialized forms, so a semantic no-op edit (e.g., adding trailing space to a cell) does not force a DOM rebuild.

> **Find (Cmd+F) does NOT reveal source (#31).** The find bar never flips a table to raw markdown — that behavior was rejected outright ("cmd+f converts tables to source, which is stupid"). Only the **manual** "Edit source" menu item reveals source. See [Find-in-Table Highlighting](#find-in-table-highlighting-31).

---

## Find-in-Table Highlighting (#31)

A GFM table is an atomic block-replace widget that **hides its source**, so a Cmd+F match landing on a table line is invisible behind the widget. The find bar does **not** solve this by revealing raw source (rejected). Instead, matches are highlighted **in place, inside the rendered table DOM**.

- **`tableFindHighlight`** (a `ViewPlugin` in `tableWidget.ts`, added to the editor next to `findExtension()`) reacts to doc / selection / search-query / viewport / panel changes. It reads the live `getSearchQuery(view.state)` and `searchPanelOpen(view.state)` from `@codemirror/search` — no new state field.
- On each apply it **clears** every prior find `<mark>` from all `.cm-table-wrap`s (unwrap + `normalize`), then, while the panel is open with a valid non-empty query, walks each **display** cell's text nodes (skipping any cell in edit mode) and wraps each literal query occurrence in `<mark class="cm-table-find-match">`.
- The **active match** (the block the find selection is genuinely inside, resolved via `groupTableBlocks` + `cellCoordForOffset` → `parseRowCellSpans`) gets the extra `cm-table-find-active` class and is `scrollIntoView`-ed.
- Styling lives in `Editor.css` (`.cm-table-rendered mark.cm-table-find-match` / `.cm-table-find-active`), mirroring the prose `.cm-searchMatch` / `-selected` accent wash so a match reads the same in a cell as in prose.
- It **never dispatches a transaction or reveals source**, and only touches the display face — so an in-progress cell edit is never disturbed. Closing the bar (empty query / panel closed) clears every mark.

`findPanel.ts` therefore carries **zero** table logic — it just moves the selection like anywhere else, and the highlighter reacts.

---

## File Drop Into a Cell (#30)

Dropping an image/PDF/media file onto a rendered table cell embeds it **into that cell**, not the note body. Because the table is an atomic block widget whose `contenteditable` cells reroute the browser's native file drop before CodeMirror's own `drop` handler can see it, the widget installs **capture-phase** `dragover` + `drop` listeners on its root DOM (`toDOM`):

1. `dragover`: when the drag carries files, `preventDefault()` (marks the cell a valid drop target — without this no `drop` fires) + `stopPropagation()`.
2. `drop`: resolve the target cell via `tableCellDropTarget(view, e.target)`; if it's over a cell, `preventDefault()` + `stopPropagation()` (so CM's bubble-phase `drop` never also fires — no double insert) and dispatch a `bismuth-table-drop` window event carrying `{ view, files, target, altKey }`.

`Editor.tsx` listens for `bismuth-table-drop` (gated to its own `view`) and runs the **same** upload+embed flow as a note-body drop (`dropFilesIntoCell` → `uploadEmbed` → `insertEmbedsInTableCell` → `appendToCell`), so the file is saved into the vault and an `![[…]]` embed lands in the cell (which then renders as real media). `⌥`-drop or `attachments.onDrop: "reference"` inserts a bare `![[name]]` reference instead of copying.

### Packaged app: the native-drop path (the only one that fires in Tauri)

The capture-phase DOM `dragover`/`drop` listeners above **only fire in a browser** (dev-in-Chrome). In the **packaged Tauri app**, an OS file drag never reaches any DOM `drop` listener at all — Tauri's native drag-drop handler intercepts it and `app/src/nativeDrop.ts` re-broadcasts it as a `bismuth-native-drag` window event carrying the dropped **paths** + the cursor position in **client pixels**. So a real image-into-a-cell drop is served entirely by `Editor.tsx`'s native-drop consumer:

1. **Coordinate correction (the "wrong cell" fix).** The bridge divides Tauri's `PhysicalPosition` by `devicePixelRatio` — correct only when DPR is the full physical→CSS ratio. Bismuth applies a **persisted webview page zoom** (`zoom.ts` → `WKWebView.pageZoom`), and **WebKit does not fold page zoom into `devicePixelRatio`** (Chromium does) — so at ≠100% zoom the forwarded coords are window *points*, off from page CSS px by the zoom factor. A pane-sized rect (chat) tolerates that; a ~30px cell resolves one-or-more cells off. The consumer **measures** the true ratio (Tauri `innerSize()` physical width vs `window.innerWidth`) and multiplies by the residual factor `nativeDropScale(dpr, cssW, physW)` (`app/src/nativeDropRouting.ts`, pure, pinned by tests for all three worlds: no zoom → 1, Chromium zoom-in-DPR → 1, WebKit zoom-not-in-DPR → 1/zoom). Measurement failure degrades to factor 1.
2. **Pane routing** uses the SAME shared predicate as the (working) chat hit-test: `pointInDropRect(scrollDOM rect, x, y)` — including its 0×0 hidden-pane guard.
3. **Single-claim guard (the "double insert" fix).** One drop event fans out to every live listener; if a duplicated subscription ever exists (an editor rebuild, stacked panes), each would insert once. `claimNativeDrop(detail)` (WeakSet over the shared event detail) lets exactly ONE handler process a drop; tested as "two subscribe cycles + one drop → exactly one insert".
4. **Flush-before-insert.** A native drop does not blur a focused cell. If the drop targets a cell while another cell edit is uncommitted (the user deleted the previous embed and dropped without clicking away), the insert's doc change would rebuild the widget and discard that edit — resurrecting the deleted embed next to the new one. The consumer blurs the active cell first (focusout → commit) and re-resolves the target afterwards.
5. **Cell resolution is geometric**, via **`tableCellDropTargetAtPoint(view, x, y)`**: iterate this view's `.cm-table-wrap`s, and inside a containing wrap resolve via the pure `cellRectAtPoint(cellRects, x, y)` (`tableModel.ts`) — the **containing** cell, else the **nearest** (a drop on a border/gutter still lands in the visually-targeted table). NOT `elementFromPoint`, which the resize-overlay strips (pointer-events bands on every column border) intercept and whose answers WebKit has diverged on under zoom/transforms; rects and the (corrected) point live in the same CSS viewport space, so containment is engine-agnostic by construction. Iterating the view's own wraps scopes the hit to this editor (split panes).
6. On a cell hit it routes through **`embedNativePathsIntoCell`** — the native-path analog of `dropFilesIntoCell`: read each path's bytes via the Tauri fs plugin, `uploadEmbed`, then `insertEmbedsInTableCell` (falling back to a note-body insert if the table/cell has vanished). No cell hit → the existing note-body native embed (`embedNativePaths`).

A native drag carries **no modifier keys**, so reference-vs-copy comes only from `attachments.onDrop` here (there's no `⌥`-drop signal in the native event). The coordinate→cell mapping is pinned by pure tests (`cellRectAtPoint` in `tableModel.test.ts`, `nativeDropScale`/`claimNativeDrop` in `nativeDropRouting.test.ts`) plus rect-stubbed widget tests.

---

## Inline Markdown in Cells (`inlineMarkdown.ts`)

The display face of each cell renders its stored source through `renderInlineMarkdown(src)`. This is a synchronous HTML string generator (the result is set as `cell.innerHTML`).

### Why Not Just `marked.parseInline`?

`marked` does not understand `[[wikilinks]]` or `$inline math$`, and would mangle their `[[` and `$` delimiters. The function pre-splits the source into segments, routing wikilinks and math away from `marked`.

### Segmentation: `tokenizeInline(src)`

Returns `InlineSeg[]`:

```ts
type InlineSeg =
  | { type: "md"; raw: string }
  | { type: "wikilink"; target: string; alias: string | null }
  | { type: "math"; expr: string }
  | { type: "embed"; wiki: boolean; target: string; alt: string | null }
  | { type: "tag"; name: string };   // an Obsidian #tag chip (#41)
```

Segmentation rules (applied left to right, one character at a time):

1. **Wikilink** `[[target]]` or `[[target|alias]]`: detected at `[[`, scanned to the first `]]`. The alias separator is the first `|` inside the brackets.
2. **Display math** `$$…$$`: the `$$` fence is passed through literally as text so the inner single-`$` scanner does not misread it as two inline-math spans.
3. **Inline math** `$expr$`: detected when `$` is not followed by another `$`, not followed by space/tab, and the closing `$` is not preceded by space/tab and has no newline in between. `\$` inside the expression escapes the dollar. Currency-style `$5` (no closing match) falls through to `type: "md"`.
4. **Tag** `#tag` (#41): a `#` at the **start of the cell or right after whitespace**, whose body starts with a **letter** (`[A-Za-zÀ-ɏ]`) then word chars / `/` (nested tags) / `-`. These rules mirror the vault's tag matcher (`editor/tag.ts` + the reader's `bases/markdown.ts` `TAG_RE`), so `#123` (digit-led), `# heading` (space after `#`), `C#` (mid-word), and a URL fragment `x#y` are never treated as tags. A `#` inside a `[[wikilink]]` is a heading anchor and is consumed by the earlier wikilink rule, not this one.
5. **Everything else**: accumulated in a `buf`, emitted as `type: "md"` on flush.

```ts
tokenizeInline("see [[Note|Alias]] and $E=mc^2$")
// [
//   { type: "md", raw: "see " },
//   { type: "wikilink", target: "Note", alias: "Alias" },
//   { type: "md", raw: " and " },
//   { type: "math", expr: "E=mc^2" },
// ]
```

### Rendering Per Segment

| Segment type | Output                                                                                       |
| :----------- | :------------------------------------------------------------------------------------------- |
| `"md"`       | `inlineMarked.parseInline(raw)` — GFM-enabled isolated `Marked` instance (~~strikethrough~~ + autolinks) |
| `"wikilink"` | `<span class="cm-wikilink" data-wikilink="<target>"><alias or target></span>`               |
| `"math"`     | `<span class="cm-inline-math" data-math="<expr>"><katex html or empty></span>` — lazy KaTeX |
| `"tag"`      | `<span class="cm-tag" data-tag="<name>">#<name></span>` — the editor's tag mark (teal mono), so a tag in a cell reads identically to one in the note body (#41). Display-only, like tags in the editor body (no click navigation). |

### KaTeX Lazy Loading

`renderMath(expr, false)` (from `katexLoader.ts`) returns an empty string if KaTeX has not yet loaded. The widget registers an `onMathReady` callback that re-calls `renderDisplay(cell)` once KaTeX lands — unless the cell has since entered edit mode (`cell.dataset.editing !== "1"`).

### Supported Inline Syntax in Cells

| Syntax             | Result              |
| :----------------- | :------------------ |
| `**bold**`         | `<strong>bold</strong>` |
| `*italic*`         | `<em>italic</em>`   |
| `***bold+italic***`| `<em><strong>bold+italic</strong></em>` |
| `` `code` ``       | `<code>code</code>` |
| `~~strikethrough~~`| `<del>strikethrough</del>` |
| `[txt](url)`       | `<a href="url">txt</a>` |
| `[[Note]]`         | wikilink span        |
| `[[Note\|Alias]]`  | wikilink span (alias text) |
| `#tag`             | `.cm-tag` chip (letter-led, at start/after-whitespace; `#123`/`C#`/`# h` are not tags) |
| `$expr$`           | KaTeX rendered span  |
| `$$…$$`            | passed through literally (display math handled elsewhere) |

Raw HTML inside a cell is not further processed by this module; `marked` passes it through as-is (same model as `bases/markdown.ts`). The trust model is vault-owner content; no external sanitization is applied here.

### Emphasis Spanning Math / Wikilinks (#58)

Because `tokenizeInline` splits the source at math/wikilink/embed/tag boundaries and feeds each `md` run to `marked` **separately**, a bold/italic/strike token whose inner text *contains* one of those segments — `**Case 1: $hk \in H$.**` — used to reach `marked` as two non-closing runs (`**Case 1: ` and `.**`) and render literal `**` (the cell twin of the note-body #58 bug). A pre-pass in `renderInlineRun` now finds such **spanning** tokens on the whole source (`spanningEmphasisTokens`) and emits the HTML wrapper (`<strong>`/`<em>`/`<del>`, `<em><strong>` for `***…***`) around the recursively-rendered inner content. The reference semantics come from the note body's fix (`editor/inlineEmphasis.ts`, whose token regexes are imported — one source of truth): **only the delimiter runs must avoid math spans** — emphasis characters *inside* `$…$` are LaTeX and stay literal (`$a * b * c$` renders as one math span; a token whose closer sits mid-math is skipped). A plain emphasis token that spans nothing keeps the existing `marked` path unchanged.

---

## Lists Inside Cells (`cellList.ts`)

A GFM pipe-table cell is, by the spec, a **single line** of markdown: a literal newline can't live inside a `| … |` cell, and the inline lexer never promotes a `- x` to a real `<ul>`. The standard carrier for a line break inside a cell is a literal `<br>` (both `marked` and Obsidian render it), and Bismuth already stores Shift+Enter soft breaks as `<br>` (see [Keyboard Navigation](#keyboard-navigation-reference)). Lists in cells are built on that carrier.

### Convention

A cell renders as a real list when **both** hold:

1. its source is **two or more** `<br>`-separated segments (`<br>`, `<br/>`, `<br />`, any case), and
2. **every** non-empty segment starts with a list marker:
   - unordered — `- item` or `* item` → `<ul>`
   - ordered — `1. item` or `2) item` → `<ol>`

The marker (and the whitespace after it) is stripped and each item's remaining text is rendered as inline markdown (so `**bold**`, `[[wikilinks]]`, `$math$` work inside items). A cell whose segments are **not all** markers — a mix of bullets and prose, or a plain `a<br>b` two-line cell — is left as plain `<br>`-separated inline content (no list). A marker needs a space after it, so `*italic*` and `-5` are **not** bullets.

```
| Task     | Notes                        |
| -------- | ---------------------------- |
| Shopping | - milk<br>- eggs<br>- bread  |   →  a <ul> of three items
| Steps    | 1. mix<br>2. bake            |   →  an <ol> of two items
| Plain    | line one<br>line two         |   →  two soft-broken lines (no list)
```

### Round-trip and editing

The convention round-trips losslessly through the pipe-table markdown: `serializeTable` keeps the literal `<br>` markers (they carry no `|`), and the widget's [dual-face](#cell-dual-face-architecture) edit mode reveals each `<br>` as a real line break — so a cell edits as **one item per line**, and pressing **Shift+Enter** starts a new line where you type the next `- item`. On blur the DOM is re-encoded to `- a<br>- b` and the display face re-renders the list.

### Where it renders

`renderCellListHtml(src, renderItem)` (pure, in `cellList.ts`) is shared by both surfaces so they agree:

- **Editor widget** — `inlineMarkdown.ts` `renderInlineMarkdown` tries the list first, else renders the cell inline as before.
- **Note reader / cards / export** — `bases/markdown.ts` overrides `marked`'s `tablecell` renderer to emit the list, else falls back to marked's default inline cell.

Both emit `<ul class="bismuth-cell-list">` / `<ol …>`; a single global rule in `App.css` gives the list compact in-cell spacing.

### Limitations

- **Single level only** — no nested / indented sub-lists (a cell is one logical line, so there's no indentation to encode a hierarchy).
- **All-or-nothing** — one non-bullet segment demotes the whole cell to plain soft-broken lines.
- **Convention, not portable GFM** — the `<br>`-bullet carrier is a Bismuth/Obsidian idiom. A plain GitHub renderer shows `- a<br>- b` as literal text (with a line break), not a list.

---

## Integration with `livePreview.ts`

The table widget is wired into the editor's live-preview extension via three pieces:

1. **`activeTableField`** — imported from `tableState.ts` and included in the `livePreview` extension array.
2. **`tableWidgetField`** — a `StateField<DecorationSet>` defined inside `livePreview.ts`. Calls `buildTableWidgets(state)` whenever `tr.docChanged || tr.selection || activeChanged`. Each non-active table block is replaced with a `Decoration.replace({ widget: new TableWidget(...), block: true })` spanning the full block source range (header through last body row).
3. **`notePathFacet`** — supplied by the editor host (Editor.tsx) so the widget can scope localStorage keys per note.

Block decorations (like the table widget) must come from a `StateField` — CodeMirror forbids them from `ViewPlugin`. This is why `tableWidgetField` is a `StateField` even though it also reacts to view-level signals.

The widget's `eq` method prevents unnecessary DOM rebuilds: if the serialized markdown has not changed (e.g., a cursor moved elsewhere in the document), the existing DOM is kept and any in-progress cell edit is preserved.

---

## In-Cell Emoji Autocomplete (#49)

A table cell is a plain `contenteditable` DOM island that lives **outside** CodeMirror's input pipeline, so the editor's own `:emoji:` completion (`editor/autocomplete.ts` `emojiSource`) never runs inside it — the same class of gap as the in-cell wrap-on-type (`wrapCellSelectionOnType`, #45) and list-continuation features. `editor/cellEmoji.ts` restores it as a lightweight, self-contained popup:

- **Trigger (pure):** `emojiTokenBeforeCaret(beforeCaret)` reuses the editor's `matchEmojiPrefix`, so the trigger rules are identical — a `:` at the start of the cell line or after whitespace opens the popup (`key:value`, `http://x`, `12:30` never fire). It returns the bare `query` plus `tokenLen` (the character count the `:query[:]` token occupies before the caret).
- **Data source:** the SAME `searchEmoji(query)` the editor uses (`editor/emoji.ts` — one ranked dataset, same default cap of 50), so a cell shows the identical suggestions in the identical order.
- **Key handling (pure):** `emojiMenuKey(key)` maps Up/Down → navigate, Enter/Tab → accept, Escape / Left / Right / Home / End → close. While the menu is open, the cell's `keydown` gives it first refusal, so Enter accepts the glyph instead of growing the table or continuing a list, and Tab accepts instead of moving cells. A character key falls through to normal typing, which re-evaluates the popup on the resulting `input`.
- **Insertion (deterministic Range op):** `replaceTokenBeforeCaret(cell, tokenLen, glyph)` deletes the `:query[:]` token and inserts the glyph via a `Range` — **not** `execCommand` — so it behaves the same in every engine (mirroring `insertBreakAtCaret`).
- **Popup DOM — visually identical to the editor's autocomplete, by construction (#49 re-bounce).** `CellEmojiMenu` does **not** carry its own styles. It renders CodeMirror's exact tooltip structure — `.cm-tooltip.cm-tooltip-autocomplete > ul[role=listbox] > li[role=option]` (selected row marked `[aria-selected]`, like CM's) with one `.cm-completionLabel` per row whose text is the editor's exact emoji label (`${char}  :${name}:`, no icon — the editor's emoji rows render none either) — and mounts **inside the editor root** (`view.dom`), where both CM's base autocomplete theme and the app's `completionTheme` (`editor/completionDisplay.ts`, the single source of completion styling) are scoped. Every rule that styles the editor's popup therefore styles this one: container card, row metrics, selected wash, label typography, list max-height/scroll. A future theme change automatically hits both; `Editor.css` deliberately contains **zero** rules for it. Positioned `fixed` at the caret (like CM's tooltips), one instance per table widget, torn down on the cell's blur and the widget's `destroy`. Picking a row uses `mousedown` + `preventDefault` so the choice never blurs the cell (which would commit + destroy the edit face first).

The trigger + key decision are unit-tested as pure functions (`cellEmoji.test.ts`); the caret read, token replacement, end-to-end widget flow (type `:fire`, Enter inserts the glyph, no new row), and the structural parity with CM's popup (classes, ul/li/label shape, `[aria-selected]` movement, editor-root mounting) are covered under happy-dom (`tableWidget.test.ts`).

---

## No "Big Cursor" Beside a Table (#59)

A rendered table is an atomic block widget replacing its whole source range, so a cursor parked anywhere on that range — most visibly at the block's **boundary positions** when clicking beside/above/below the table — was drawn by CodeMirror as a caret the **full height of the widget** (the "big cursor"). `tableSelectionGuard` (a `transactionFilter` in `tableWidget.ts`, wired in `Editor.tsx`) forbids it: any **user** selection (`isUserEvent("select")` — clicks and arrow keys) whose *collapsed cursor* lands on a table block's line range is remapped to the nearest position outside, **directionally** (pure `remapCursorOffTable` in `tableModel.ts`) — ArrowDown from above skips *past* the table; clicking beside it lands on the neighboring line. Details:

- **Programmatic selections pass through** (no `userEvent`): the widget's own `commit()`/`insertEmbedsInTableCell` undo-anchoring dispatches (#44) and "Edit source" keep working unchanged.
- **Raw-source mode is exempt**: while a block is open via "Edit source" (`activeTableField`), its lines are ordinary editable text.
- **Range selections are never altered** (drag / Cmd+A across a table works as before).
- **Doc-edge tables keep their outer boundary reachable** (a table at the very start/end of the file): otherwise content could never be typed before/after it — pressing Enter there opens a fresh line. In practice files end with a newline, so this edge is rare.

Deleting a table is now an explicit affordance instead of caret-plus-backspace: the cell context menu's **"Delete table"** removes the whole block (plus one adjacent newline, so no stray blank line) in a single dispatch — **one undo step** restores the entire table with the cursor at the deletion site.

---

## Gotchas and Edge Cases

### Trailing `<br>` in Shift+Enter

A trailing `<br>` followed by nothing renders no visible empty line and the caret cannot land after it. The widget inserts a zero-width space (`​`) immediately after a trailing `<br>` (`srcToEditHtml`) and strips it on read-back (`cellSourceFromDom`). Without this, pressing Shift+Enter at the end of a cell and immediately committing would silently drop the break.

### `execCommand("insertLineBreak")` Not Used

`insertLineBreak` behaves inconsistently across browsers (yields `<br>`, `<div>`, or a literal `\n` depending on position and engine). The widget uses `insertBreakAtCaret()` which directly inserts a `<br>` DOM node and places the caret deterministically.

### `innerText` Not Used for Cell Read-Back

`innerText` silently drops a trailing `<br>` with no following content. `cellSourceFromDom` walks `childNodes` explicitly to capture all breaks.

### Column Sizes Reset on Header Change

The localStorage size key is `JSON.stringify(cells[0])` (the header row). Any change to the header text or column count changes the key and discards persisted sizes. Body-only edits preserve sizes.

### First Column Drag Freezes Layout

The first time any column is dragged, the table switches from `tableLayout: auto` to `tableLayout: fixed` and every column's current measured width is captured as an explicit `<col style="width: Npx">`. This prevents subsequent drags from causing columns to reflow. Once fixed layout is set it stays until the widget is rebuilt (page reload or header change).

### Active Table Collapses on Cursor Leave

`activeTableField` auto-resets to `null` as soon as the cursor moves outside the active block's line range (computed live via `groupTableBlocks`). The user cannot have two tables simultaneously in raw mode.

### Ragged Rows Are Padded

`parseTableBlock` normalizes all body rows to the header column count (padding with `""` or truncating). A round-trip through `serializeTable` produces a fully rectangular table even if the original source had jagged cells.

### Pipes Inside Cells

`parseTableRow` unescapes `\|` to the literal character `|` in the grid. `serializeTable` re-escapes `|` as `\|`. The entire round-trip is transparent; the display face shows the literal pipe.

### Mod+B/I/U Blocked

Native rich-text shortcuts that would inject `<b>`, `<i>`, `<u>` HTML elements into the contenteditable are explicitly suppressed. Markdown formatting (`**bold**`, `*italic*`) must be typed manually and is stored as source text.

### No Context Menu on the Header Row Separator

The separator row does not exist in the DOM (it is consumed during parse). The context menu rows all count from the `cells` grid, where row 0 is the header. "Delete row" is disabled when only the header row exists (`rowCount <= 1`).

Source: `app/src/editor/tableModel.ts`, `app/src/editor/tableState.ts`, `app/src/editor/tableWidget.ts`, `app/src/editor/inlineMarkdown.ts`, `app/src/editor/tableModel.test.ts`, `app/src/editor/inlineMarkdown.test.ts`, `app/src/editor/livePreview.ts`
