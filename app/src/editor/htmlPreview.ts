// app/src/editor/htmlPreview.ts
//
// Obsidian-style raw-HTML rendering for the live-preview editor. The editor is a
// custom per-line CodeMirror decorator (see livePreview.ts), not a markdown→HTML
// pipeline, so raw HTML would otherwise show as literal text. This module adds:
//
//   • BLOCK HTML  (<div>…</div>, <details>…</details>, <table>…</table>, comments,
//     etc.) — a StateField that replaces a whole blank-line-delimited HTML block
//     with one rendered widget, collapsing back to raw source while the cursor is
//     inside it (the same reveal pattern code fences + tables use).
//   • INLINE HTML (<br>, <b>…</b>, <span style=…>…</span>, <sub>, <mark>, …) —
//     helpers the per-line pass calls to replace each grouped inline span with a
//     rendered widget off the cursor line, and to dim the raw tags on it.
//
// All rendered HTML passes through sanitizeHtml() before innerHTML injection.
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { type EditorState, type Range, StateField, type Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { sanitizeHtml } from "../sanitizeHtml";

// ---- block-level HTML --------------------------------------------------------

// CommonMark "type 6" HTML block tag set: a line whose first non-blank token is
// `<tag` / `</tag` for one of these begins a block that runs to the next blank
// line. Inline-only tags (span, b, i, mark, sub, sup, …) are intentionally NOT
// here — they render inline instead.
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption",
  "center", "col", "colgroup", "dd", "details", "dialog", "dir", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "frame", "frameset",
  "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hr", "html", "iframe", "legend",
  "li", "link", "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup", "option",
  "p", "param", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead",
  "title", "tr", "track", "ul",
]);

export interface HtmlBlock {
  fromLine: number; // 1-based first line
  toLine: number;   // 1-based last line
  from: number;     // doc offset of fromLine start
  to: number;       // doc offset of toLine end
}

/** True if `text` begins (after leading whitespace) an HTML block. */
export function startsHtmlBlock(text: string): boolean {
  const t = text.trimStart();
  if (t.startsWith("<!--")) return true;
  const m = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(t);
  return !!m && BLOCK_TAGS.has(m[1].toLowerCase());
}

/** Scan the document for blank-line-delimited HTML blocks, skipping fenced code
 *  regions. Pure + synchronous (independent of the async Lezer parse) so the
 *  block decorations never flicker right after an edit. */
export function scanHtmlBlocks(doc: Text): HtmlBlock[] {
  const blocks: HtmlBlock[] = [];
  let inFence = false;
  let i = 1;
  while (i <= doc.lines) {
    const text = doc.line(i).text;
    if (/^\s*```/.test(text)) {
      inFence = !inFence;
      i++;
      continue;
    }
    if (!inFence && startsHtmlBlock(text)) {
      const startLine = i;
      let j = i;
      // Extend while the next line is non-blank and not a code fence (a blank
      // line — or a ``` — ends the block, matching CommonMark type 6).
      while (j + 1 <= doc.lines) {
        const next = doc.line(j + 1).text;
        if (next.trim() === "" || /^\s*```/.test(next)) break;
        j++;
      }
      blocks.push({ fromLine: startLine, toLine: j, from: doc.line(startLine).from, to: doc.line(j).to });
      i = j + 1;
      continue;
    }
    i++;
  }
  return blocks;
}

class HtmlBlockWidget extends WidgetType {
  constructor(private readonly html: string, private readonly from: number) {
    super();
  }

  eq(other: HtmlBlockWidget): boolean {
    return other.html === this.html;
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-html-block";
    // Click handler (in livePreview.ts) reads this to drop the cursor into the
    // block so it reveals raw source for editing.
    div.setAttribute("data-from", String(this.from));
    div.innerHTML = sanitizeHtml(this.html);
    return div;
  }

  ignoreEvent(): boolean {
    return false; // let clicks through so the block can be entered / links work
  }
}

/** Build the block-replace decoration set: each HTML block not currently holding
 *  the cursor is replaced by its rendered widget. */
function buildHtmlBlocks(state: EditorState): DecorationSet {
  const doc = state.doc;
  const headLine = doc.lineAt(state.selection.main.head).number;
  const deco: Range<Decoration>[] = [];
  for (const b of scanHtmlBlocks(doc)) {
    if (headLine >= b.fromLine && headLine <= b.toLine) continue; // editing → raw
    const html = doc.sliceString(b.from, b.to);
    deco.push(Decoration.replace({ widget: new HtmlBlockWidget(html, b.from), block: true }).range(b.from, b.to));
  }
  return Decoration.set(deco, true);
}

// Block decorations may not come from a ViewPlugin — they live in a StateField,
// rebuilt whenever the doc changes or the selection moves (either can flip a
// block between rendered and raw). Mirrors tableWidgetField in livePreview.ts.
export const htmlBlockField = StateField.define<DecorationSet>({
  create: (state) => buildHtmlBlocks(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection) return buildHtmlBlocks(tr.state);
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- inline HTML -------------------------------------------------------------

export interface InlineTag {
  from: number;
  to: number;
  text: string;
}

export type TagKind = "void" | "open" | "close" | "comment";

// HTML void elements: they never have a matching close tag.
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

/** Classify a raw inline tag string. */
export function classifyTag(text: string): TagKind {
  if (text.startsWith("<!--")) return "comment";
  if (text.startsWith("</")) return "close";
  if (/\/\s*>$/.test(text)) return "void"; // self-closing <img/>, <br/>
  const m = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(text);
  const name = m ? m[1].toLowerCase() : "";
  if (VOID_TAGS.has(name)) return "void";
  return "open";
}

/** Group a line's inline HTML tags into the maximal spans to render as one unit:
 *  an outermost open…matching-close pair (nesting tracked by depth, name-agnostic)
 *  or a lone void/comment tag. Unmatched closes are ignored (left raw). Pure. */
export function groupInlineHtml(tags: InlineTag[]): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  let depth = 0;
  let start = -1;
  for (const t of tags) {
    const kind = classifyTag(t.text);
    if (kind === "open") {
      if (depth === 0) start = t.from;
      depth++;
    } else if (kind === "close") {
      if (depth > 0) {
        depth--;
        if (depth === 0) {
          spans.push({ from: start, to: t.to });
          start = -1;
        }
      }
    } else {
      // void / comment: a standalone unit only when not nested inside an open tag
      if (depth === 0) spans.push({ from: t.from, to: t.to });
    }
  }
  return spans;
}

/** Collect inline `HTMLTag` nodes overlapping [from, to] from the parse tree.
 *  Using the syntax tree (not a regex) means tags inside inline code / fenced
 *  blocks are correctly excluded. */
export function inlineHtmlTags(state: EditorState, from: number, to: number): InlineTag[] {
  const tags: InlineTag[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === "HTMLTag") {
        tags.push({ from: node.from, to: node.to, text: state.doc.sliceString(node.from, node.to) });
      }
    },
  });
  return tags;
}

class HtmlInlineWidget extends WidgetType {
  constructor(private readonly html: string) {
    super();
  }

  eq(other: HtmlInlineWidget): boolean {
    return other.html === this.html;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-html-inline";
    span.innerHTML = sanitizeHtml(this.html);
    return span;
  }

  ignoreEvent(): boolean {
    return false; // let a click position the cursor on the line → reveals raw
  }
}

// Raw inline tags on the cursor line render in dim Monaspace (same treatment the
// other markdown delimiters get when revealed).
const htmlSyntaxMark = Decoration.mark({ class: "cm-syntax-mark" });

/** Push inline-HTML decorations for one line into `deco`.
 *  - Off the cursor line: replace each grouped HTML span with a rendered widget.
 *    Returns the covered spans so the caller can skip other REPLACE decorations
 *    (math) that would otherwise overlap them.
 *  - On the cursor line: dim the raw tags and render nothing (returns []). */
export function pushInlineHtml(
  deco: Range<Decoration>[], state: EditorState, lineFrom: number, lineTo: number, onCursor: boolean,
): Array<{ from: number; to: number }> {
  const tags = inlineHtmlTags(state, lineFrom, lineTo);
  if (tags.length === 0) return [];
  if (onCursor) {
    for (const t of tags) deco.push(htmlSyntaxMark.range(t.from, t.to));
    return [];
  }
  const spans = groupInlineHtml(tags);
  for (const s of spans) {
    if (s.to <= s.from) continue;
    deco.push(Decoration.replace({ widget: new HtmlInlineWidget(state.doc.sliceString(s.from, s.to)) }).range(s.from, s.to));
  }
  return spans;
}
