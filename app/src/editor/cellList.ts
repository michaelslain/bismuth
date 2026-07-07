// app/src/editor/cellList.ts
// Lists inside GFM pipe-table cells.
//
// A GFM pipe-table cell is, by the spec, a SINGLE line of markdown — a literal newline
// can't live inside a `| … |` cell, and the inline lexer never promotes a `- x` to a real
// `<ul>`. The standard carrier for a line break inside a cell is a literal `<br>` (marked
// and Obsidian both render it). So we build the "list in a cell" feature on that carrier:
//
//   CONVENTION — a cell renders as a bulleted / numbered list when it holds two or more
//   items, each starting with a list marker:
//     • unordered: `- item` or `* item`   → <ul>
//     • ordered:   `1. item` or `2) item` → <ol>
//   The marker is stripped and each item's remaining text is rendered as inline markdown.
//   A cell whose items are NOT all markers (mixed, or plain `a<br>b`) is left as plain
//   inline content — no list.
//
// ── Why we split on MORE than just `<br>` (the #15 root cause) ─────────────────────────
// The editor's editable-table widget stores a cell as raw source via `cellSourceFromDom`
// (tableWidget.ts), which maps only DIRECT-child `<br>` nodes to `<br>` markers. But when a
// user types a list in a `contenteditable` <td>, Chromium routinely wraps each continuation
// line in a `<div>` block, so the `<br>` (or the whole line) ends up NESTED and its
// `textContent` is empty — the break is DROPPED and the items are concatenated with NO
// separator:
//     typed  "- a" ⏎ "b" ⏎ "c"   →  stored  "- a- b- c"   (not "- a<br>- b<br>- c")
// The old parser split ONLY on `<br>`, so "- a- b- c" was one segment → NOT a list, and the
// cell rendered as the literal text "- a- b- c". (That is why the two prior "real-text bullet
// marker" fixes were rejected: the marker code was correct but NEVER ran — the source that
// reached it was never list-shaped.) So `splitCellItems` below recognizes ALL the shapes a
// real cell can carry: `<br>` markers, real newlines, AND a collapsed run where a marker is
// glued straight onto the previous item's last non-space char. A prose " - " (spaces on BOTH
// sides) is left intact, so ordinary sentences are never chopped into a list.
//
// LIMITATIONS (documented in docs/editor/tables.md):
//   • single level only — no nested / indented sub-lists (a cell is one logical line);
//   • all-or-nothing — one non-bullet item demotes the whole cell to plain content;
//   • the bullet carrier is a Bismuth/Obsidian convention: a plain GitHub renderer shows
//     `- a<br>- b` as literal text, not a list.
//
// Pure (no DOM / CodeMirror / marked deps) so it can be unit-tested and shared by BOTH the
// editor table widget (inlineMarkdown.ts) and the note renderer (bases/markdown.ts).

/** Every clean line-break carrier a cell source can use: a literal `<br>` / `<br/>` /
 *  `<br />` marker (Bismuth/Obsidian convention) or a real newline (some surfaces). */
const BR_OR_NL_RE = /<br\s*\/?>|\r?\n/gi;
// A dropped-break boundary (see the header note): a list marker glued directly onto the
// previous item's last NON-space char, e.g. the `- b` in "- a- b". The captured `\S` keeps a
// prose " - " (space before the dash) from ever matching, so a real sentence isn't split; and
// a marker that already follows a `<br>`/newline is preceded by whitespace, so a CLEAN list is
// left untouched — only genuinely-concatenated markers get re-broken.
//
// The unordered form matches ONLY `-` (not `*`): a `*` bullet is indistinguishable from
// emphasis, and `**bold** x` / `*italic* x` would false-split on the `* ` before the space.
// A `*`-bulleted list is still detected on the CLEAN `<br>`/newline convention (UL_ITEM_RE
// accepts `* item`); only the rarer COLLAPSED `*` case is passed over — the safe trade. The
// ordered form is digit-led, so it never collides with markdown emphasis.
const GLUED_UL_RE = /(\S)(-[ \t])/g;
const GLUED_OL_RE = /(\S)(\d+[.)][ \t])/g;
// A marker + optional whitespace-led content. Bare `-` / `1.` (an empty item) is allowed;
// `-5` / `*bold*` (no space after the marker) is NOT a bullet — matching markdown.
const UL_ITEM_RE = /^[-*](?:[ \t]+(.*))?$/;
const OL_ITEM_RE = /^\d+[.)](?:[ \t]+(.*))?$/;

export interface CellList {
  ordered: boolean;
  /** Item texts with the list marker stripped (still raw inline markdown). */
  items: string[];
}

/** Split a cell source into its item candidates (trimmed). Normalizes the clean `<br>`/newline
 *  carriers to line breaks AND re-inserts the breaks the editor's DOM read dropped (a marker
 *  concatenated straight onto the previous item — see the header note). Pure. */
export function splitCellItems(src: string): string[] {
  let s = src.replace(BR_OR_NL_RE, "\n");
  // Re-break a glued run: "- a- b- c" → "- a\n- b\n- c" (and "1. a2. b" → "1. a\n2. b").
  s = s.replace(GLUED_UL_RE, "$1\n$2").replace(GLUED_OL_RE, "$1\n$2");
  return s.split("\n").map((seg) => seg.trim());
}

/** Parse a cell source into a list, or null if it isn't one (see the convention above). */
export function parseCellList(src: string): CellList | null {
  const segments = splitCellItems(src);
  // A list needs ≥2 non-empty items, each starting with a marker (checked below).
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
