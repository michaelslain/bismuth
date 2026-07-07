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
  const pad = Math.max(width - text.length, 0);
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

/** Serialize a cell grid + alignments back to normalized, column-padded markdown lines.
 *  Column widths are the max visible width per column so the raw source stays tidy. */
export function serializeTable(cells: string[][], aligns: Align[]): string {
  const cols = Math.max(0, ...cells.map((r) => r.length), aligns.length);
  const enc = cells.map((row) => Array.from({ length: cols }, (_, c) => encodeCell(row[c] ?? "")));
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = 3; // separator needs ≥3 dashes; floor the column width there
    for (const row of enc) w = Math.max(w, row[c].length);
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
