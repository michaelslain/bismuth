// app/src/editor/tableModel.ts
// Pure helpers for GFM pipe tables: detect/group table blocks in a document,
// parse a block into a cell grid + column alignments, and serialize a grid back
// to normalized (column-padded) markdown. No CodeMirror or DOM deps so it can be
// unit-tested in isolation; the editable-table widget (tableWidget.ts) and the
// live-preview wiring (livePreview.ts) both consume these.
import type { Text } from "@codemirror/state";

export type Align = "left" | "center" | "right" | "none";

export interface TableBlock {
  /** 1-based line number of the header row. */
  startLine: number;
  /** 1-based line number of the last body row (inclusive). */
  endLine: number;
  /** Cell text grid. Row 0 is the header; the separator row is NOT included. */
  cells: string[][];
  /** Per-column alignment, derived from the separator row. */
  aligns: Align[];
}

// A separator row: optional leading pipe, then runs of `:`/`-`/space separated by
// pipes, at least one pipe overall. Mirrors the detector in livePreview's scan.
const SEP_RE = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

/** True if `line` is a GFM separator row AND `prev` looks like a header (has a pipe). */
export function isSeparatorRow(line: string, prev: string): boolean {
  return SEP_RE.test(line) && /\|/.test(prev) && /-/.test(line);
}

/** Split one markdown table row into trimmed cell strings. A `\|` escape is treated
 *  as a literal pipe inside a cell and UNESCAPED to `|` in the returned text (so the
 *  grid holds display text); serializeTable re-escapes it. The outer leading/trailing
 *  pipes (and the empty cells they create) are dropped. */
export function parseTableRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      cur += "|"; // unescape to literal pipe (display text)
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  // Drop the empty cell before the first `|` and after the last `|` (the outer rails).
  if (cells.length && cells[0].trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

/** Char-offset spans (relative to the row's line start) of each CONTENT cell in a raw table-row
 *  line, in grid-column order — the outer `|` rails and the empty pseudo-cells they create are
 *  dropped, mirroring `parseTableRow`. A `\|` escape counts as cell text, never a delimiter. Used
 *  to map a document offset that lands inside a table row to its grid COLUMN — e.g. the find bar
 *  locating which rendered cell an active match sits in (#31). Pure. */
export function parseRowCellSpans(line: string): { start: number; end: number }[] {
  const cells: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") { i++; continue; } // escaped pipe is cell text
    if (line[i] === "|") { cells.push({ start, end: i }); start = i + 1; }
  }
  cells.push({ start, end: line.length });
  const isEmpty = (s: { start: number; end: number }): boolean => line.slice(s.start, s.end).trim() === "";
  if (cells.length && isEmpty(cells[0])) cells.shift(); // leading rail
  if (cells.length && isEmpty(cells[cells.length - 1])) cells.pop(); // trailing rail
  return cells;
}

/** Map one separator cell (`:---`, `:--:`, `---:`, `---`) to its alignment. */
export function parseAlign(cell: string): Align {
  const t = cell.trim();
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

/** Parse the lines of a single table block (header, separator, body rows) into a grid.
 *  `lines[0]` is the header, `lines[1]` the separator, the rest are body rows. */
export function parseTableBlock(lines: string[]): { cells: string[][]; aligns: Align[] } {
  const header = parseTableRow(lines[0] ?? "");
  const aligns = parseTableRow(lines[1] ?? "").map(parseAlign);
  const cols = header.length;
  const norm = (row: string[]): string[] => {
    const r = row.slice(0, cols);
    while (r.length < cols) r.push("");
    return r;
  };
  const cells: string[][] = [norm(header)];
  for (let i = 2; i < lines.length; i++) cells.push(norm(parseTableRow(lines[i])));
  // Pad/truncate aligns to column count.
  const a = aligns.slice(0, cols);
  while (a.length < cols) a.push("none");
  return { cells, aligns: a };
}

/** Scan the whole document and group contiguous pipe-table lines into blocks.
 *  Returns the blocks plus a line-number → block index for O(1) per-line lookup. */
export function groupTableBlocks(doc: Text): { blocks: TableBlock[]; byLine: Map<number, TableBlock> } {
  const blocks: TableBlock[] = [];
  const byLine = new Map<number, TableBlock>();
  let i = 2; // a table needs a header (≥1) + separator (≥2)
  while (i <= doc.lines) {
    const sep = doc.line(i).text;
    const prev = doc.line(i - 1).text;
    if (isSeparatorRow(sep, prev)) {
      const startLine = i - 1;
      const lines = [prev, sep];
      let j = i + 1;
      while (j <= doc.lines && doc.line(j).text.includes("|")) {
        lines.push(doc.line(j).text);
        j++;
      }
      const endLine = j - 1;
      const { cells, aligns } = parseTableBlock(lines);
      const block: TableBlock = { startLine, endLine, cells, aligns };
      blocks.push(block);
      for (let k = startLine; k <= endLine; k++) byLine.set(k, block);
      i = j + 1;
      continue;
    }
    i++;
  }
  return { blocks, byLine };
}

/** True if `cp` is an East-Asian WIDE / FULLWIDTH code point (occupies TWO monospace
 *  columns): CJK, Hiragana/Katakana, Hangul, fullwidth forms, and emoji. Standard
 *  `is-fullwidth-code-point` ranges. Column padding must count these as 2 or the pipes in
 *  the raw-source view drift right of the header (the #25 "columns don't line up" bug). */
function isWideCodePoint(cp: number): boolean {
  return (
    cp >= 0x1100 &&
    (cp <= 0x115f || // Hangul Jamo
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0x303e) || // CJK Radicals … Kangxi … CJK symbols
      (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana … Katakana … CJK compat
      (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
      (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
      (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
      (cp >= 0xa960 && cp <= 0xa97c) || // Hangul Jamo Ext A
      (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
      (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
      (cp >= 0xfe10 && cp <= 0xfe19) || // Vertical forms
      (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Compatibility Forms
      (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth Forms
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) || // emoji + symbols
      (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      (cp >= 0x20000 && cp <= 0x3fffd)) // CJK Ext B+
  );
}

/** True if `cp` renders in ZERO monospace columns: a combining mark or a zero-width space.
 *  These attach to the previous glyph, so counting them widens the column spuriously. */
function isZeroWidthCodePoint(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritics
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) || // combining marks for symbols
    (cp >= 0xfe20 && cp <= 0xfe2f) || // combining half marks
    cp === 0x200b || // zero-width space
    cp === 0x200c ||
    cp === 0x200d || // ZWJ (emoji sequences)
    cp === 0xfeff
  );
}

/** Monospace DISPLAY width of a string, in columns. CJK / fullwidth / emoji code points
 *  count as 2 and combining/zero-width marks as 0; everything else as 1. `String.length`
 *  (UTF-16 units) over-counts astral emoji (surrogate pairs) and under-counts wide CJK, so
 *  padding built on it never lines up in a monospace view — this is what `padCell` /
 *  `serializeTable` measure by so the aligned raw source actually aligns (#25). */
export function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isZeroWidthCodePoint(cp)) continue;
    w += isWideCodePoint(cp) ? 2 : 1;
  }
  return w;
}

function alignSep(align: Align, width: number): string {
  const w = Math.max(width, 3); // GFM needs at least one dash; keep it readable
  switch (align) {
    case "left":
      return ":" + "-".repeat(w - 1);
    case "right":
      return "-".repeat(w - 1) + ":";
    case "center":
      return ":" + "-".repeat(Math.max(w - 2, 1)) + ":";
    default:
      return "-".repeat(w);
  }
}

/** Escape a display cell back to source: literal pipes become `\|`, newlines become
 *  spaces (a cell is a single line). */
function encodeCell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function padCell(text: string, width: number, align: Align): string {
  // Pad by DISPLAY width, not `.length`, so a cell holding wide CJK / emoji still lines up.
  const pad = Math.max(width - displayWidth(text), 0);
  if (align === "right") return " ".repeat(pad) + text;
  if (align === "center") {
    const l = Math.floor(pad / 2);
    return " ".repeat(l) + text + " ".repeat(pad - l);
  }
  return text + " ".repeat(pad);
}

/** A table's editable content: the cell grid (row 0 = header) plus per-column alignment.
 *  The unit the structural row/column ops below transform. */
export interface TableGrid {
  cells: string[][];
  aligns: Align[];
}

/** Column count of a grid (header row width, falling back to aligns / widest row). */
function gridCols(g: TableGrid): number {
  return Math.max(g.cells[0]?.length ?? 0, g.aligns.length, ...g.cells.map((r) => r.length));
}

function blankRow(cols: number): string[] {
  return Array.from({ length: cols }, () => "");
}

// ── Structural row/column ops ────────────────────────────────────────────────
// Pure grid transforms behind the table widget's right-click menu (insert/delete
// row & column). Each returns a NEW grid (never mutates its input) and keeps the
// table well-formed: the header row (index 0) is never removed and the grid never
// drops to zero rows or zero columns, so `serializeTable` always emits valid GFM.

/** Insert a blank body row at index `at` (clamped to `[1, rows]` so the header stays
 *  first). `at = r` inserts ABOVE row r; `at = r + 1` inserts below it. */
export function insertRow(g: TableGrid, at: number): TableGrid {
  const rows = g.cells.length;
  const idx = Math.min(Math.max(at, 1), rows);
  const cells = g.cells.map((r) => r.slice());
  cells.splice(idx, 0, blankRow(gridCols(g)));
  return { cells, aligns: g.aligns.slice() };
}

/** Delete body row `at`. The header (0) is never deletable and the last body row is
 *  kept (a table always has ≥1 body row after the header), so out-of-range / guarded
 *  requests return an unchanged copy of the grid. */
export function deleteRow(g: TableGrid, at: number): TableGrid {
  const cells = g.cells.map((r) => r.slice());
  // Refuse to delete the header (0), an out-of-range row, or the LAST body row
  // (`length <= 2` = header + one body) — a table keeps ≥1 body row.
  if (at <= 0 || at >= cells.length || cells.length <= 2) return { cells, aligns: g.aligns.slice() };
  cells.splice(at, 1);
  return { cells, aligns: g.aligns.slice() };
}

/** Insert a blank column at index `at` (clamped to `[0, cols]`) in every row, with a
 *  `none` alignment. `at = c` inserts LEFT of column c; `at = c + 1` inserts to its right. */
export function insertColumn(g: TableGrid, at: number): TableGrid {
  const cols = gridCols(g);
  const idx = Math.min(Math.max(at, 0), cols);
  const cells = g.cells.map((r) => {
    const row = r.slice();
    while (row.length < cols) row.push("");
    row.splice(idx, 0, "");
    return row;
  });
  const aligns = g.aligns.slice();
  while (aligns.length < cols) aligns.push("none");
  aligns.splice(idx, 0, "none");
  return { cells, aligns };
}

/** Delete column `at` from every row and its alignment. The last column is kept (a
 *  table always has ≥1 column), so a guarded / out-of-range request returns an
 *  unchanged copy of the grid. */
export function deleteColumn(g: TableGrid, at: number): TableGrid {
  const cols = gridCols(g);
  const cells = g.cells.map((r) => r.slice());
  if (at < 0 || at >= cols || cols <= 1) return { cells, aligns: g.aligns.slice() };
  for (const row of cells) if (at < row.length) row.splice(at, 1);
  const aligns = g.aligns.slice();
  if (at < aligns.length) aligns.splice(at, 1);
  return { cells, aligns };
}

/** Append `addition` to the cell at (r, c), on its OWN in-cell line (a `<br>` marker joins
 *  it to any existing content) so a dropped image lands under, not merged into, the cell's
 *  text. Used by the file-drop handler (#30) to place an `![[…]]` embed into the cell the
 *  image was dropped on. Returns a NEW grid; out-of-range (r, c) returns an unchanged copy. */
export function appendToCell(g: TableGrid, r: number, c: number, addition: string): TableGrid {
  const cells = g.cells.map((row) => row.slice());
  const row = cells[r];
  if (!row || c < 0 || c >= row.length) return { cells, aligns: g.aligns.slice() };
  const existing = (row[c] ?? "").trim();
  // A GFM cell is one source line; `<br>` is the in-cell line break (see cellSourceFromDom).
  row[c] = existing ? `${existing}<br>${addition}` : addition;
  return { cells, aligns: g.aligns.slice() };
}

/** Serialize a cell grid + alignments back to normalized, column-padded markdown lines.
 *  Column widths are the max visible width per column so the raw source stays tidy. */
export function serializeTable(cells: string[][], aligns: Align[]): string {
  const cols = Math.max(0, ...cells.map((r) => r.length), aligns.length);
  const enc = cells.map((row) => Array.from({ length: cols }, (_, c) => encodeCell(row[c] ?? "")));
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = 3; // separator needs ≥3 dashes; floor the column width there
    for (const row of enc) w = Math.max(w, displayWidth(row[c])); // DISPLAY width (CJK/emoji-aware)
    widths.push(w);
  }
  const al = (c: number): Align => aligns[c] ?? "none";
  const rowLine = (row: string[]): string =>
    "| " + Array.from({ length: cols }, (_, c) => padCell(row[c] ?? "", widths[c], al(c))).join(" | ") + " |";
  const out: string[] = [];
  if (enc.length) out.push(rowLine(enc[0]));
  out.push("| " + Array.from({ length: cols }, (_, c) => alignSep(al(c), widths[c])).join(" | ") + " |");
  for (let r = 1; r < enc.length; r++) out.push(rowLine(enc[r]));
  return out.join("\n");
}

/** Pretty-print a table grid to normalized, column-padded GFM markdown — the canonical
 *  serializer the editable-table widget writes back to source, so the raw markdown stays
 *  aligned and readable by a human OR an LLM. A thin `TableGrid` wrapper over
 *  `serializeTable` (which does the column-width padding). */
export function formatTable(g: TableGrid): string {
  return serializeTable(g.cells, g.aligns);
}

/** Line-surgical rewrite for an IN-PLACE cell edit (#46): replace only the source lines of
 *  rows whose cells actually changed, keeping every other line BYTE-IDENTICAL — deliberately
 *  NO column repadding. A formatTable() commit repads the whole table whenever a cell edit
 *  changes a column's max width, turning a one-cell edit into a whole-table diff; the
 *  save-time three-way merge then sees any concurrent EXTERNAL edit to another row of the
 *  same table as overlapping and drops it, and undo's inverse restores the whole pre-commit
 *  table, wiping it there too. Alignment drift on the edited line is the accepted cost;
 *  structural ops (add/delete row/column, Enter-new-row) still go through formatTable.
 *  Returns null when the shapes don't line up — the caller falls back to formatTable. */
export function surgicalTableEdit(before: string, orig: string[][], next: string[][]): string | null {
  if (next.length !== orig.length) return null; // row count changed: structural, not in-place
  const lines = before.split("\n");
  if (lines.length !== next.length + 1) return null; // header + separator + body rows
  const out = lines.slice();
  for (let r = 0; r < next.length; r++) {
    const a = orig[r] ?? [];
    const b = next[r];
    if (b.length === a.length && b.every((c, i) => c === a[i])) continue; // untouched row
    out[r === 0 ? 0 : r + 1] = "| " + b.map((c) => encodeCell(c)).join(" | ") + " |";
  }
  return out.join("\n");
}

/** Re-format a block of raw table markdown LINES into aligned GFM (parse → pretty
 *  serialize). Prettifies source that was authored by hand (unpadded pipes) so revealing
 *  it as raw markdown shows tidy, aligned columns. `lines[0]` is the header, `lines[1]`
 *  the separator, the rest body rows — the same shape `parseTableBlock` consumes. */
export function prettifyTableBlock(lines: string[]): string {
  const { cells, aligns } = parseTableBlock(lines);
  return serializeTable(cells, aligns);
}

// ── Cursor remap off table blocks (pure, #59) ─────────────────────────────────
// A rendered table is an atomic block widget replacing its whole source range, so a CURSOR
// landing anywhere on that range — most visibly at the block's boundary positions when the
// user clicks beside the table — is drawn as a caret the FULL HEIGHT of the widget (the "big
// cursor"). Selection shouldn't be able to sit there at all: this remaps such a head to the
// nearest position OUTSIDE the block, in the direction the selection was moving (so ArrowDown
// from above skips past the table instead of bouncing back). The widget's own cells handle
// their clicks before CodeMirror sees them, so only genuine boundary/margin selections reach
// this. Table deletion has its own affordance (the cell context menu's "Delete table").

/** Remap a cursor head that falls on a (non-source-mode) table block's line range to just
 *  outside it. `prevHead` decides direction (>= means forward/down). `activeStartLine` is the
 *  block currently open as raw source (its lines ARE editable text) — skipped. Edge blocks:
 *  a table at the very start/end of the doc keeps its outer boundary reachable (else content
 *  could never be typed before/after it — pressing Enter there makes a fresh line). Pure. */
export function remapCursorOffTable(
  doc: Text,
  head: number,
  prevHead: number,
  activeStartLine: number | null,
): number {
  const { blocks } = groupTableBlocks(doc);
  for (const b of blocks) {
    if (b.startLine === activeStartLine) continue; // raw-source mode: its lines are editable
    const from = doc.line(b.startLine).from;
    const to = doc.line(b.endLine).to;
    if (head < from || head > to) continue;
    const forward = head >= prevHead;
    if (forward) return to < doc.length ? to + 1 : to; // next line start, else the end boundary
    return from > 0 ? from - 1 : from; // previous line end, else the start boundary
  }
  return head;
}

// ── Coordinate → cell resolution (pure, #30) ──────────────────────────────────
// Resolving which table cell a native (Tauri) file drop landed on. The widget collects
// each cell's client rect from the DOM; THIS function makes the geometric decision, so
// the exact coordinate→cell mapping is pinned by unit tests with fake rects. Geometry
// (rect containment, mirroring the shared pane-routing predicate pointInDropRect in
// nativeDrop.ts) instead of document.elementFromPoint, which is hit-test-dependent —
// the resize-overlay strips (pointer-events:auto bands on every column border) intercept
// it, and engines disagree about it under transforms/zoom. Rects and the point live in
// the same CSS viewport space, so the comparison is engine-agnostic by construction.

/** One cell's client rect + its grid coordinate, as collected from the widget DOM. */
export interface CellRect {
  r: number;
  c: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Squared distance from a point to a rect (0 when inside). */
function rectDist2(rect: CellRect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return dx * dx + dy * dy;
}

/** The cell at client point (x, y): the CONTAINING cell when the point is inside one, else
 *  the NEAREST cell (the point sits on a border/gutter or the wrap's edge-button margin —
 *  the user still dropped visually ON the table, so snap rather than lose the drop to the
 *  note body). Returns null only for an empty list. Pure. */
export function cellRectAtPoint(cells: CellRect[], x: number, y: number): CellRect | null {
  let best: CellRect | null = null;
  let bestD = Infinity;
  for (const cell of cells) {
    const d = rectDist2(cell, x, y);
    if (d === 0) return cell; // containing cell wins outright
    if (d < bestD) {
      bestD = d;
      best = cell;
    }
  }
  return best;
}

// ── Cell keydown decision (pure) ──────────────────────────────────────────────
// The table widget's contenteditable cell is an "editing island": it must handle the
// keys it needs for cell navigation/editing while letting the app's GLOBAL keyboard
// shortcuts (Cmd/Ctrl combos like the quick-switcher / command palette / find) bubble
// out to the document. Keeping that decision pure + DOM-free lets us unit-test the
// tricky part — which keys the cell OWNS vs. which must pass through to App's handler.

/** The subset of a `KeyboardEvent` the cell's keydown logic reads. */
export interface CellKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/** What the editable table cell should do with a keydown. */
export type CellKeyAction =
  | "select-cell" // Mod+A: select this cell's contents (native would grab the whole editor)
  | "block-format" // Mod+B/I/U: swallow — no rich-text markup in a plain-markdown cell
  | "pass-through" // any other Cmd/Ctrl combo: a global app shortcut — DON'T stop it, let it bubble
  | "tab-next" // Tab: next cell (wraps to next row / commits past the last cell)
  | "tab-prev" // Shift+Tab: previous cell
  | "newline" // Shift+Enter: soft line break within the cell
  | "next-row" // Enter: move to the cell below (or commit on the last row)
  | "leave" // Escape: blur the cell
  | "edit"; // everything else: native contenteditable input (stop it reaching CM's keymap)

/** Classify a cell keydown. The one line that fixes "global shortcuts don't work inside a
 *  table": every Cmd/Ctrl combo the cell doesn't itself own is `pass-through`, so the
 *  widget leaves it alone and it reaches App.tsx's window keydown handler. */
export function decideCellKey(e: CellKeyEvent): CellKeyAction {
  const mod = e.metaKey || e.ctrlKey;
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === "a") return "select-cell";
    if (k === "b" || k === "i" || k === "u") return "block-format";
    return "pass-through";
  }
  if (e.key === "Tab") return e.shiftKey ? "tab-prev" : "tab-next";
  if (e.key === "Enter") return e.shiftKey ? "newline" : "next-row";
  if (e.key === "Escape") return "leave";
  return "edit";
}

// ── In-cell list continuation (pure) ──────────────────────────────────────────
// A GFM cell renders as a bulleted/numbered list when it's a `<br>`-separated run of
// `- `/`* ` or `N.`/`N)` items (see cellList.ts). To let a user CREATE one by typing,
// pressing Enter inside a cell that's on a list-item line should open the next marker
// on a new in-cell line instead of jumping to the next row. This decides that, purely
// from the caret's current line text; the widget does the DOM insert/delete.

/** How Enter should treat the caret's current line inside a table cell:
 *   - `{ marker }` → a non-empty list item: open this marker on a new line;
 *   - "exit"       → an empty marker (just `- ` / `2. `): drop it and leave the list;
 *   - null         → not a list item: Enter keeps its normal next-row behavior. */
export type CellListEnter = { marker: string } | "exit" | null;

// A list-item line needs whitespace after the marker (so a lone `-` isn't a list); the
// content may be empty (`- ` / `1. `), which is the signal to exit the list.
const CELL_UL_ITEM = /^([-*])[ \t]+(.*)$/;
const CELL_OL_ITEM = /^(\d+)([.)])[ \t]+(.*)$/;

/** Decide how Enter continues an in-cell list, given the caret's current line text. The
 *  next ordered marker increments the number; unordered repeats the bullet. Mirrors the
 *  markers cellList.ts renders. */
export function cellListContinuation(lineText: string): CellListEnter {
  const ul = CELL_UL_ITEM.exec(lineText);
  if (ul) return ul[2].trim() === "" ? "exit" : { marker: `${ul[1]} ` };
  const ol = CELL_OL_ITEM.exec(lineText);
  if (ol) return ol[3].trim() === "" ? "exit" : { marker: `${parseInt(ol[1], 10) + 1}${ol[2]} ` };
  return null;
}

// ── Enter action (pure, #42) ──────────────────────────────────────────────────
// Pressing Enter inside a table cell should ONLY create a new row when the caret is in the
// table's LAST row; on every other row Enter behaves like Shift+Enter (a soft line break
// inside the cell). This keeps a mid-table Enter from stealing the caret to the row below
// (the old `next-row` behavior) while letting a user grow the table by pressing Enter at the
// bottom. `rowIndex` is 0-based over `cells` (row 0 = header); `rowCount` is the total row
// count including the header. (In-cell list continuation is decided separately and wins.)
export type EnterAction = "line-break" | "new-row";

/** Enter creates a new row only on the last row; otherwise it inserts an in-cell line break. */
export function enterAction(rowIndex: number, rowCount: number): EnterAction {
  return rowIndex >= rowCount - 1 ? "new-row" : "line-break";
}
