// app/src/editor/inlineMarkdown.ts
// Render the inline markdown held in a table cell to display HTML. A table cell is a
// single line of markdown source; in display (non-editing) mode the editable-table
// widget shows it formatted — bold/italic/code/strikethrough/links via `marked`, plus
// the two marks `marked` doesn't know about: Obsidian `[[wikilinks]]` and inline
// `$math$` (rendered with the lazy KaTeX loader, exactly like the rest of the editor).
//
// Wikilinks and math are split OUT of the source first so `marked` never sees (and
// mangles) their `[[` / `$` syntax; the remaining runs go through `marked.parseInline`.
// Vault text is the user's own (trusted) and injected as innerHTML — the same trust
// model as app/src/bases/markdown.ts. Raw HTML inside a cell is intentionally NOT
// handled here (it's owned by the separate HTML pass); `marked` passes it through.
import { Marked } from "marked";
import { renderMath } from "./katexLoader";
import { escapeHtml } from "../htmlEscape";
import { renderCellListHtml } from "./cellList";

// An isolated `marked` instance so our config never leaks into the global one that
// bases/markdown.ts configures (and vice-versa). GFM gives ~~strikethrough~~ + autolinks.
const inlineMarked = new Marked({ gfm: true });

export type InlineSeg =
  | { type: "md"; raw: string }
  | { type: "wikilink"; target: string; alias: string | null }
  | { type: "math"; expr: string };

// NOTE: this attr-escape additionally escapes `>` (via escapeHtml) — a different set
// than the canonical escapeAttr (`& < "`) — so it stays local to preserve behavior.
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/** If a `$` at `open` begins an inline-math span, return the index just past its closing
 *  `$`; else -1. Common rule: no whitespace just inside either delimiter, not `$$`
 *  (that's display math, handled elsewhere), single line, `\$` escapes a literal dollar. */
function matchMath(src: string, open: number): number {
  if (src[open] !== "$" || src[open + 1] === "$") return -1;
  const after = src[open + 1];
  if (after === undefined || after === " " || after === "\t") return -1;
  for (let j = open + 1; j < src.length; j++) {
    const ch = src[j];
    if (ch === "\\") { j++; continue; } // skip the escaped char (e.g. \$)
    if (ch === "\n") return -1;
    if (ch === "$") {
      const prev = src[j - 1];
      return prev === " " || prev === "\t" ? -1 : j + 1;
    }
  }
  return -1;
}

/** Split a cell's markdown into segments, pulling wikilinks and inline math out of the
 *  text so the standard-markdown engine only ever sees plain inline markdown. Pure. */
export function tokenizeInline(src: string): InlineSeg[] {
  const segs: InlineSeg[] = [];
  let buf = "";
  const flush = () => {
    if (buf) { segs.push({ type: "md", raw: buf }); buf = ""; }
  };
  let i = 0;
  while (i < src.length) {
    // [[wikilink]] / [[target|alias]]
    if (src[i] === "[" && src[i + 1] === "[") {
      const close = src.indexOf("]]", i + 2);
      if (close !== -1) {
        flush();
        const inner = src.slice(i + 2, close);
        const bar = inner.indexOf("|");
        segs.push(
          bar === -1
            ? { type: "wikilink", target: inner.trim(), alias: null }
            : { type: "wikilink", target: inner.slice(0, bar).trim(), alias: inner.slice(bar + 1).trim() },
        );
        i = close + 2;
        continue;
      }
    }
    // `$$…$$` is DISPLAY math (owned by the math-block path) — pass the fence through
    // literally so the inner single-`$` scan below doesn't misread it as inline math.
    if (src[i] === "$" && src[i + 1] === "$") {
      buf += "$$";
      i += 2;
      continue;
    }
    // inline $math$
    if (src[i] === "$") {
      const end = matchMath(src, i);
      if (end !== -1) {
        flush();
        segs.push({ type: "math", expr: src.slice(i + 1, end - 1) });
        i = end;
        continue;
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return segs;
}

function renderSeg(seg: InlineSeg): string {
  if (seg.type === "wikilink") {
    const text = seg.alias ?? seg.target;
    return `<span class="cm-wikilink" data-wikilink="${escapeAttr(seg.target)}">${escapeHtml(text)}</span>`;
  }
  if (seg.type === "math") {
    // "" until KaTeX lazy-loads; the widget re-renders the cell via onMathReady.
    const html = renderMath(seg.expr, false);
    return `<span class="cm-inline-math" data-math="${escapeAttr(seg.expr)}">${html}</span>`;
  }
  return inlineMarked.parseInline(seg.raw, { async: false }) as string;
}

/** Render a run of a cell's inline markdown (wikilinks/math split out, the rest via
 *  `marked`). One list item, or a whole non-list cell, is one run. */
function renderInlineRun(src: string): string {
  return tokenizeInline(src).map(renderSeg).join("");
}

/** Render a cell's markdown source to display HTML (synchronous). A cell whose source is
 *  `<br>`-separated bullet/number markers renders as a real `<ul>`/`<ol>` (see cellList.ts);
 *  otherwise its inline markdown renders as-is (a `<br>` stays a soft line break). */
export function renderInlineMarkdown(src: string): string {
  return renderCellListHtml(src, renderInlineRun) ?? renderInlineRun(src);
}
