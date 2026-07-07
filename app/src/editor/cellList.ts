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
 *  engine so math / wikilinks render exactly as they do elsewhere in that surface).
 *
 *  The bullet / number marker is emitted as REAL TEXT CONTENT (a `.bismuth-cell-mk` span)
 *  and the list's native marker is suppressed with an INLINE `list-style:none` — NOT left to
 *  a stylesheet's `list-style-type`. This is deliberate (#15): a cell renders inside a
 *  `contenteditable` `<td>` nested in a CodeMirror block widget, where `list-style` is
 *  inherited and the native `<li>` marker was being silently suppressed by the surrounding
 *  cascade (an ancestor `list-style:none`, a UA contenteditable quirk), so the earlier
 *  class-based `list-style-type: disc` rule never actually painted a bullet. Rendering the
 *  glyph as content can't be suppressed by ANY rule, and the inline `list-style:none` stops
 *  a native marker from doubling it. Inline styles keep the layout self-contained (no
 *  external CSS needed) so this renders identically in the editor widget AND on every reading
 *  surface (bases/markdown.ts) that shares this function. */
export function renderCellListHtml(src: string, renderItem: (item: string) => string): string | null {
  const parsed = parseCellList(src);
  if (!parsed) return null;
  const tag = parsed.ordered ? "ol" : "ul";
  const body = parsed.items
    .map((it, i) => {
      const marker = parsed.ordered ? `${i + 1}.` : "•"; // "•" for bullets, "N." for numbers
      return (
        `<li class="bismuth-cell-li" style="display:flex;gap:0.4em;list-style:none;margin:0.05em 0">` +
        `<span class="bismuth-cell-mk" style="flex:0 0 auto;opacity:0.75">${marker}</span>` +
        `<span class="bismuth-cell-it">${renderItem(it)}</span></li>`
      );
    })
    .join("");
  return `<${tag} class="bismuth-cell-list" style="margin:0;padding-left:0.2em;list-style:none">${body}</${tag}>`;
}
