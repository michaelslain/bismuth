// app/src/editor/cellList.ts
// Lists inside GFM pipe-table cells.
//
// A GFM pipe-table cell is, by the spec, a SINGLE line of markdown — a literal newline
// can't live inside a `| … |` cell, and the inline lexer never promotes a `- x` to a real
// `<ul>`. The standard carrier for a line break inside a cell is a literal `<br>` (marked
// and Obsidian both render it). So we build the "list in a cell" feature on that carrier:
//
//   CONVENTION — a cell renders as a bulleted / numbered list when its source is two or
//   more `<br>`-separated segments AND every non-empty segment starts with a list marker:
//     • unordered: `- item` or `* item`   → <ul>
//     • ordered:   `1. item` or `2) item` → <ol>
//   The marker is stripped and each item's remaining text is rendered as inline markdown.
//   A cell whose segments are NOT all markers (mixed, or plain `a<br>b`) is left as plain
//   `<br>`-separated inline content — no list.
//
// This round-trips losslessly through the pipe-table markdown: `serializeTable` keeps the
// literal `<br>` markers (they carry no `|`), and the widget's edit face reveals each `<br>`
// as a real line break (one item per line, Shift+Enter to add one) then re-encodes on blur.
//
// LIMITATIONS (documented in docs/editor/tables.md):
//   • single level only — no nested / indented sub-lists (a cell is one logical line);
//   • all-or-nothing — one non-bullet segment demotes the whole cell to plain lines;
//   • the `<br>`-bullet carrier is a Bismuth/Obsidian convention: a plain GitHub renderer
//     shows `- a<br>- b` as literal text, not a list.
//
// Pure (no DOM / CodeMirror / marked deps) so it can be unit-tested and shared by BOTH the
// editor table widget (inlineMarkdown.ts) and the note renderer (bases/markdown.ts).

/** Split a cell source on its literal `<br>` / `<br/>` / `<br />` line-break markers. */
const BR_SPLIT_RE = /<br\s*\/?>/i;
// A marker + optional whitespace-led content. Bare `-` / `1.` (an empty item) is allowed;
// `-5` / `*bold*` (no space after the marker) is NOT a bullet — matching markdown.
const UL_ITEM_RE = /^[-*](?:[ \t]+(.*))?$/;
const OL_ITEM_RE = /^\d+[.)](?:[ \t]+(.*))?$/;

export interface CellList {
  ordered: boolean;
  /** Item texts with the list marker stripped (still raw inline markdown). */
  items: string[];
}

/** Parse a cell source into a list, or null if it isn't one (see the convention above). */
export function parseCellList(src: string): CellList | null {
  const segments = src.split(BR_SPLIT_RE).map((s) => s.trim());
  // A list needs at least one `<br>` (≥2 segments) and ≥2 non-empty items.
  if (segments.length < 2) return null;
  const nonEmpty = segments.filter((s) => s !== "");
  if (nonEmpty.length < 2) return null;

  const match = (re: RegExp): string[] | null => {
    const items: string[] = [];
    for (const seg of nonEmpty) {
      const m = re.exec(seg);
      if (!m) return null;
      items.push(m[1] ?? "");
    }
    return items;
  };

  const ul = match(UL_ITEM_RE);
  if (ul) return { ordered: false, items: ul };
  const ol = match(OL_ITEM_RE);
  if (ol) return { ordered: true, items: ol };
  return null;
}

/** Render a cell source as a `<ul>`/`<ol>` if it follows the list convention, else null.
 *  `renderItem` renders one item's inline markdown (each caller supplies its own inline
 *  engine so math / wikilinks render exactly as they do elsewhere in that surface). */
export function renderCellListHtml(src: string, renderItem: (item: string) => string): string | null {
  const parsed = parseCellList(src);
  if (!parsed) return null;
  const tag = parsed.ordered ? "ol" : "ul";
  const body = parsed.items.map((it) => `<li>${renderItem(it)}</li>`).join("");
  return `<${tag} class="bismuth-cell-list">${body}</${tag}>`;
}
