# GFM Pipe Tables — Interactive Widget

This document covers everything about how Bismuth renders and edits GitHub Flavored Markdown (GFM) pipe tables inside the CodeMirror editor. A GFM table in a note is replaced by a fully interactive `<table>` DOM widget with contenteditable cells, Tab/Enter navigation, Shift+Enter multi-line cells, drag-to-resize columns and rows (persisted in localStorage), add/delete row and column affordances, a right-click context menu, and inline-markdown rendering in the display face. The four modules involved are: the pure markdown↔grid model (`tableModel.ts`), shared CodeMirror state (`tableState.ts`), the widget itself (`tableWidget.ts`), and inline-markdown rendering for display cells (`inlineMarkdown.ts`).

---

## Table of Contents

1. [The Markdown–Grid Model (`tableModel.ts`)](#the-markdowngrid-model-tablemodelts)
2. [CodeMirror State (`tableState.ts`)](#codemirror-state-tablestatets)
3. [The Editable Widget (`tableWidget.ts`)](#the-editable-widget-tablewidgetts)
4. [Inline Markdown in Cells (`inlineMarkdown.ts`)](#inline-markdown-in-cells-inlinemarkdownts)
5. [Integration with `livePreview.ts`](#integration-with-livepreviewts)
6. [Keyboard Navigation Reference](#keyboard-navigation-reference)
7. [Drag-Resize and Size Persistence](#drag-resize-and-size-persistence)
8. [Context Menu and Structural Edits](#context-menu-and-structural-edits)
9. [Source / Raw-Edit Mode](#source--raw-edit-mode)
10. [Gotchas and Edge Cases](#gotchas-and-edge-cases)

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
| Display (idle)      | `""` / unset   | `renderInlineMarkdown(data-src)` → rendered HTML |
| Edit (focused)      | `"1"`          | Raw markdown source, with `<br>` for line breaks |

The canonical cell source is stored in `data-src`. On `focusin` the widget calls `enterEdit`, which sets `innerHTML = srcToEditHtml(data-src)`, converting `<br>` markers in the stored source to real `<br>` DOM nodes. On `focusout` the widget calls `leaveEdit`, which reads the live DOM back via `cellSourceFromDom`, stores it in `data-src`, and re-renders the display face.

#### `srcToEditHtml(src)` — internal

Escapes HTML entities, then converts the `<br>` markers (`<br>` or `<BR>` or `<br/>` etc.) to real `<br>` DOM nodes. If the result ends with a `<br>`, appends a zero-width space (`​`) so the caret has a visible landing point after the break.

#### `cellSourceFromDom(cell)` — internal

Iterates `cell.childNodes`. Each `BR` node becomes the literal string `<br>`; all other nodes contribute their `textContent`. Strips ZWSP fillers and collapses stray newline characters to spaces (a cell occupies exactly one markdown line). This is the inverse of `srcToEditHtml`.

**Why not `innerText`?** A trailing `<br>` followed by nothing is silently dropped by `innerText`, causing Shift+Enter line breaks at the end of a cell to not save. `cellSourceFromDom`'s explicit node walk captures them correctly.

### Click Handling

`mousedown` on a cell:

1. Calls `e.stopPropagation()` + `e.preventDefault()` to prevent CodeMirror from stealing the click (which would move the editor selection to the widget boundary).
2. Calls `cell.focus()`.
3. Uses `caretRangeFromPoint` (Chrome/Safari) or `caretPositionFromPoint` (Firefox) to place the text caret at the exact click position, falling back to the end of cell content.

### Paste Handling

Paste is intercepted on every cell. HTML and rich-text payloads are discarded; only `text/plain` is used. Newlines in the pasted text are collapsed to spaces (since a cell is one markdown line).

### Commit Mechanism

The widget dispatches a CodeMirror change when focus leaves the entire table (`focusout` fires on the root `cm-table-wrap` when `relatedTarget` is outside the root). The commit:

1. Calls `currentRange(view, root)` to recompute the source range from the live document at commit time (so edits elsewhere between last render and commit do not desync).
2. Calls `readGrid(root)` to read all cell sources from the DOM. Cells with `data-editing="1"` (still in edit mode at commit time, e.g., when a menu action is triggered while a cell is focused) are read via `cellSourceFromDom`; all others via `data-src`.
3. Calls `serializeTable` and dispatches the change only if the markdown has actually changed (no-op guard).

The `commit` method accepts an optional `transform` callback of type `(g: { cells, aligns }) => void` that mutations (add/delete row or column) apply before serialization.

---

## Keyboard Navigation Reference

All key events inside cells are stopped from propagating to CodeMirror's keymap. The following behavior is implemented in the `keydown` listener:

| Key                 | Behavior                                                                                    |
| :------------------ | :------------------------------------------------------------------------------------------ |
| `Tab`               | Move to the next cell (right). Wraps to the first cell of the next row. Blurs if at the last cell of the table (triggers commit). |
| `Shift+Tab`         | Move to the previous cell (left). Wraps to the last cell of the previous row. Blurs if at the first cell. |
| `Enter`             | Move to the cell directly below (same column). Blurs on the last row (triggers commit).    |
| `Shift+Enter`       | Insert a soft line break within the current cell. Inserts a real `<br>` DOM node at the caret (not `execCommand("insertLineBreak")`). The break is stored as the literal string `<br>` in `data-src`. |
| `Escape`            | Blur the cell (triggers commit).                                                            |
| `Mod+A`             | Select all content in the focused cell (scoped to the cell; does not select the whole document). |
| `Mod+B / Mod+I / Mod+U` | Blocked. Native rich-text formatting commands (`<b>`, `<i>`, `<u>`) are suppressed. |

`focusCell(r, c)` moves focus programmatically by querying `[data-cell][data-r="${r}"][data-c="${c}"]` and placing the caret at the end of the cell.

---

## Drag-Resize and Size Persistence

GFM markdown has no syntax for cell sizes. Sizes are stored **outside the markdown source** and applied as visual-only overrides.

### Storage

Sizes are persisted in `localStorage` under the key `bismuth:table-size:<notePath>`. The value is a JSON object mapping `sizeKey` (the JSON-serialized header row, e.g. `'["Name","Age"]'`) to `{ cols: (number | null)[], rows: (number | null)[] }`.

- If `notePath` is `null` (path-less buffer, not used in practice), sizes fall back to an in-memory `Map`.
- If `localStorage` is unavailable or throws, the same in-memory fallback is used.
- Sizes reset automatically if the **header row or column count changes** (the `sizeKey` changes). A body-only edit preserves sizes.

### Column Resize

Each column gets a `<div class="cm-col-resize">` positioned via an absolutely-positioned overlay (`cm-table-overlay`). The overlay is kept outside the contenteditable cells so its content is never clobbered by the dual-face swap.

On the first drag of a column, the table switches from `tableLayout: auto` to `tableLayout: fixed` and each `<col>` element's `width` is frozen to the current measured cell width. Subsequent drags move a `<col>`'s width directly. Minimum column width: 40px.

### Row Resize

Each row gets a `<div class="cm-row-resize">` handle in the overlay. Dragging sets `tr.style.height`. Minimum row height: 24px.

### Handle Layout

Handle positions are recomputed (`layout()`) on:
- `requestAnimationFrame` after widget attachment
- `pointerenter` (belt-and-suspenders: the first rAF may fire before CodeMirror has measured the freshly-attached widget)
- `ResizeObserver` callbacks on the `<table>` element

Sizes are persisted (`persist()`) on `mouseup` after a drag.

---

## Context Menu and Structural Edits

Right-clicking a cell dispatches a `CustomEvent("oa-context-menu")` with `{ x, y, items }` on `window`. App's shared `<ContextMenu>` component listens for this event. The menu items and their behaviors:

| Label                  | Icon      | Behavior                                              | Disabled when        |
| :--------------------- | :-------- | :---------------------------------------------------- | :------------------- |
| Insert row above       | ArrowUp   | `cells.splice(r, 0, blankRow)`                        | Never                |
| Insert row below       | ArrowDown | `cells.splice(r + 1, 0, blankRow)`                   | Never                |
| Delete row             | Trash2    | `cells.splice(r, 1)`                                  | Only 1 row left      |
| Insert column left     | ArrowLeft | `cells[*].splice(c, 0, "")` + `aligns.splice(c, 0, "none")` | Never          |
| Insert column right    | ArrowRight| `cells[*].splice(c + 1, 0, "")` + `aligns.splice(c + 1, 0, "none")` | Never   |
| Delete column          | Trash2    | `cells[*].splice(c, 1)` + `aligns.splice(c, 1)`      | Only 1 column left   |
| Edit source            | Code      | Dispatches `setActiveTableEffect.of(line)` → raw mode | Never               |

A separator appears before "Insert column left" and before "Edit source".

All row/column operations read the **live DOM grid** at the time `onSelect` fires (not a stale copy), so any in-flight cell edit is captured before the structural change commits. Each operation calls `this.commit(view, root, transform)`.

The `+` edge buttons on the table's bottom and right edges also add rows and columns:
- `.cm-table-add-col` (right edge): appends an empty cell to every row + a `"none"` align.
- `.cm-table-add-row` (bottom edge): appends a new blank row.

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
  | { type: "math"; expr: string };
```

Segmentation rules (applied left to right, one character at a time):

1. **Wikilink** `[[target]]` or `[[target|alias]]`: detected at `[[`, scanned to the first `]]`. The alias separator is the first `|` inside the brackets.
2. **Display math** `$$…$$`: the `$$` fence is passed through literally as text so the inner single-`$` scanner does not misread it as two inline-math spans.
3. **Inline math** `$expr$`: detected when `$` is not followed by another `$`, not followed by space/tab, and the closing `$` is not preceded by space/tab and has no newline in between. `\$` inside the expression escapes the dollar. Currency-style `$5` (no closing match) falls through to `type: "md"`.
4. **Everything else**: accumulated in a `buf`, emitted as `type: "md"` on flush.

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
| `$expr$`           | KaTeX rendered span  |
| `$$…$$`            | passed through literally (display math handled elsewhere) |

Raw HTML inside a cell is not further processed by this module; `marked` passes it through as-is (same model as `bases/markdown.ts`). The trust model is vault-owner content; no external sanitization is applied here.

---

## Integration with `livePreview.ts`

The table widget is wired into the editor's live-preview extension via three pieces:

1. **`activeTableField`** — imported from `tableState.ts` and included in the `livePreview` extension array.
2. **`tableWidgetField`** — a `StateField<DecorationSet>` defined inside `livePreview.ts`. Calls `buildTableWidgets(state)` whenever `tr.docChanged || tr.selection || activeChanged`. Each non-active table block is replaced with a `Decoration.replace({ widget: new TableWidget(...), block: true })` spanning the full block source range (header through last body row).
3. **`notePathFacet`** — supplied by the editor host (Editor.tsx) so the widget can scope localStorage keys per note.

Block decorations (like the table widget) must come from a `StateField` — CodeMirror forbids them from `ViewPlugin`. This is why `tableWidgetField` is a `StateField` even though it also reacts to view-level signals.

The widget's `eq` method prevents unnecessary DOM rebuilds: if the serialized markdown has not changed (e.g., a cursor moved elsewhere in the document), the existing DOM is kept and any in-progress cell edit is preserved.

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
