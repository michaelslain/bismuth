// app/src/editor/livePreview.ts
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { type Range, type Text } from "@codemirror/state";
import katex from "katex";
import { extractFrontmatterBoundary } from "./frontmatterUtils";

const hide = Decoration.mark({ class: "cm-hidden-syntax" });
const strong = Decoration.mark({ class: "cm-strong" });
const em = Decoration.mark({ class: "cm-em" });
const strike = Decoration.mark({ class: "cm-strike" });
const code = Decoration.mark({ class: "cm-inline-code" });
const link = Decoration.mark({ class: "cm-link" });
const wikilink = Decoration.mark({ class: "cm-wikilink" });
const headingLines = [1, 2, 3, 4, 5, 6].map((l) => Decoration.line({ class: `cm-h${l}` }));
const quoteLine = Decoration.line({ class: "cm-quote" });
const bulletLine = Decoration.line({ class: "cm-li" });
const codeBlockLine = Decoration.line({ class: "cm-codeblock" });
const frontmatterLine = Decoration.line({ class: "cm-frontmatter" });
const tableLine = Decoration.line({ class: "cm-table" });

// KaTeX widget for math rendering
class MathWidget extends WidgetType {
  private readonly expr: string;
  private readonly displayMode: boolean;

  constructor(expr: string, displayMode: boolean) {
    super();
    this.expr = expr;
    this.displayMode = displayMode;
  }

  eq(other: MathWidget): boolean {
    return other.expr === this.expr && other.displayMode === this.displayMode;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.displayMode ? "cm-math-block" : "cm-math-inline";
    span.innerHTML = katex.renderToString(this.expr, {
      throwOnError: false,
      displayMode: this.displayMode,
    });
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Hide the delimiters of an inline token (off the cursor line) and style the inner text. */
function pushInline(
  deco: Range<Decoration>[], text: string, lineFrom: number, onCursor: boolean,
  re: RegExp, markLen: number, mark: Decoration,
) {
  for (const m of text.matchAll(re)) {
    const s = lineFrom + (m.index ?? 0);
    const end = s + m[0].length;
    const innerStart = s + markLen, innerEnd = end - markLen;
    if (innerEnd <= innerStart) continue;
    deco.push(mark.range(innerStart, innerEnd));
    if (!onCursor) {
      deco.push(hide.range(s, innerStart));
      deco.push(hide.range(innerEnd, end));
    }
  }
}

interface BlockRegions {
  frontmatterLines: Set<number>;
  fenceLines: Set<number>;
  codeLines: Set<number>;
  tableLineSet: Set<number>;
}

/** Scan the whole document once and return the block-region sets.
 *  Called only when the document content changes (or on first construction). */
function computeBlockRegions(doc: Text): BlockRegions {
  const fenceLines = new Set<number>(); // the ``` marker lines
  const codeLines = new Set<number>();  // lines inside a fence
  let inFence = false;
  for (let i = 1; i <= doc.lines; i++) {
    if (/^\s*```/.test(doc.line(i).text)) { fenceLines.add(i); inFence = !inFence; }
    else if (inFence) codeLines.add(i);
  }

  // precompute YAML frontmatter lines from the shared boundary helper (single source
  // of truth for the fence range, also used by validation + autocomplete + Harper).
  const frontmatterLines = new Set<number>();
  const fmRange = extractFrontmatterBoundary(doc.toString());
  if (fmRange) {
    const firstLine = doc.lineAt(fmRange.from).number;     // line after the opening fence
    const lastBodyLine = fmRange.to > fmRange.from ? doc.lineAt(fmRange.to).number : firstLine - 1;
    // include the opening fence line, the body lines, and the closing fence line
    for (let i = firstLine - 1; i <= lastBodyLine + 1; i++) {
      if (i >= 1 && i <= doc.lines) frontmatterLines.add(i);
    }
  }

  // precompute GFM table line sets (scan whole doc)
  const tableLineSet = new Set<number>();
  // A table separator line: starts with optional whitespace, then |?[:-| chars]+
  const sepRe = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
  for (let i = 1; i <= doc.lines; i++) {
    const lineText = doc.line(i).text;
    const prevLineText = i > 1 ? doc.line(i - 1).text : "";
    // check if this is a separator row
    if (sepRe.test(lineText) && prevLineText.includes("|")) {
      // mark the header line (i-1), the separator (i), and following contiguous pipe lines
      if (!tableLineSet.has(i - 1)) tableLineSet.add(i - 1);
      tableLineSet.add(i);
      // collect following rows
      for (let j = i + 1; j <= doc.lines; j++) {
        if (doc.line(j).text.includes("|")) {
          tableLineSet.add(j);
        } else {
          break;
        }
      }
    }
  }

  return { frontmatterLines, fenceLines, codeLines, tableLineSet };
}

/** Run the per-visible-line decoration pass using pre-computed block regions.
 *  This is cheap: it only iterates view.visibleRanges and must run on every
 *  update (including cursor moves) so that the cursor-line reveal stays correct. */
function buildDecorations(view: EditorView, regions: BlockRegions): DecorationSet {
  const { frontmatterLines, fenceLines, codeLines, tableLineSet } = regions;
  const deco: Range<Decoration>[] = [];
  const doc = view.state.doc;
  const cursorLine = doc.lineAt(view.state.selection.main.head).number;

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const onCursor = line.number === cursorLine;
      const text = line.text;

      // frontmatter: dim lines and skip inline markdown
      if (frontmatterLines.has(line.number)) {
        deco.push(frontmatterLine.range(line.from));
        pos = line.to + 1;
        continue;
      }

      // fenced code: style the block monospace and skip inline-markdown processing inside it
      if (fenceLines.has(line.number) || codeLines.has(line.number)) {
        deco.push(codeBlockLine.range(line.from));
        pos = line.to + 1;
        continue;
      }

      // GFM table: monospace and skip inline rules
      if (tableLineSet.has(line.number)) {
        deco.push(tableLine.range(line.from));
        pos = line.to + 1;
        continue;
      }

      // headings: size the whole line, hide the leading "#"s off the cursor line
      const hm = text.match(/^(#{1,6})\s+/);
      if (hm) {
        deco.push(headingLines[hm[1].length - 1].range(line.from));
        if (!onCursor) deco.push(hide.range(line.from, line.from + hm[0].length));
      }

      // blockquote
      const qm = text.match(/^>\s?/);
      if (qm) {
        deco.push(quoteLine.range(line.from));
        if (!onCursor) deco.push(hide.range(line.from, line.from + qm[0].length));
      }

      // bullet list line (CSS adds the dot)
      if (/^\s*[-*+]\s+/.test(text)) deco.push(bulletLine.range(line.from));

      // math: process $$...$$ (block) before $...$ (inline) — skip if cursor is on this line
      if (!onCursor) {
        // block math: $$...$$  (single-line, non-empty inner)
        const blockMathRe = /\$\$([^$]+)\$\$/g;
        for (const m of text.matchAll(blockMathRe)) {
          const s = line.from + (m.index ?? 0);
          const end = s + m[0].length;
          const expr = m[1];
          deco.push(Decoration.replace({ widget: new MathWidget(expr, true) }).range(s, end));
        }

        // inline math: $...$ (not $$, at least one non-$ char inside)
        // negative lookbehind/ahead for $ to avoid matching $$
        const inlineMathRe = /(?<!\$)\$([^$\n]+)\$(?!\$)/g;
        for (const m of text.matchAll(inlineMathRe)) {
          const s = line.from + (m.index ?? 0);
          const end = s + m[0].length;
          const expr = m[1];
          deco.push(Decoration.replace({ widget: new MathWidget(expr, false) }).range(s, end));
        }
      }

      // inline tokens
      pushInline(deco, text, line.from, onCursor, /\*\*([^*]+)\*\*/g, 2, strong);
      pushInline(deco, text, line.from, onCursor, /__([^_]+)__/g, 2, strong);
      pushInline(deco, text, line.from, onCursor, /(?<![*\w])\*(?!\*)([^*\n]+?)\*(?![*\w])/g, 1, em);
      pushInline(deco, text, line.from, onCursor, /~~([^~]+)~~/g, 2, strike);
      pushInline(deco, text, line.from, onCursor, /`([^`]+)`/g, 1, code);

      // markdown links [text](url): show text as a link, hide the brackets/url off the cursor line
      for (const m of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
        const s = line.from + (m.index ?? 0);
        const end = s + m[0].length;
        const textStart = s + 1, textEnd = s + 1 + m[1].length;
        deco.push(link.range(textStart, textEnd));
        if (!onCursor) {
          deco.push(hide.range(s, textStart));
          deco.push(hide.range(textEnd, end));
        }
      }

      // wikilinks [[target]] — underline; click handled in Editor.tsx
      for (const m of text.matchAll(/\[\[([^\]]+?)\]\]/g)) {
        const s = line.from + (m.index ?? 0);
        deco.push(wikilink.range(s, s + m[0].length));
      }

      pos = line.to + 1;
    }
  }
  // sort=true: CodeMirror sorts the ranges (avoids manual add-order constraints)
  return Decoration.set(deco, true);
}

export const livePreview = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      /** Cached block-region sets — recomputed only when the document changes. */
      private blockRegions: BlockRegions;

      constructor(view: EditorView) {
        this.blockRegions = computeBlockRegions(view.state.doc);
        this.decorations = buildDecorations(view, this.blockRegions);
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) {
          // Refresh the block-region cache only when document content changes.
          // On selectionSet / viewportChanged alone, reuse the cached sets —
          // the per-line decoration pass (which handles cursor-line reveal) still runs every time.
          if (u.docChanged) {
            this.blockRegions = computeBlockRegions(u.view.state.doc);
          }
          this.decorations = buildDecorations(u.view, this.blockRegions);
        }
      }
    },
    { decorations: (v) => v.decorations },
  ),
  EditorView.theme({
    ".cm-hidden-syntax": { display: "none" },
    ".cm-strong": { "font-weight": "bold" },
    ".cm-em": { "font-style": "italic" },
    ".cm-strike": { "text-decoration": "line-through", opacity: "0.7" },
    ".cm-inline-code": { "font-family": "'Monaspace Xenon', ui-monospace, monospace", background: "rgba(140,140,140,0.18)", padding: "0 3px", "border-radius": "3px" },
    ".cm-link": { color: "#6496ff", cursor: "pointer", "text-decoration": "underline" },
    ".cm-wikilink": { color: "#6496ff", cursor: "pointer", "text-decoration": "underline" },
    ".cm-h1": { "font-size": "1.8em", "font-weight": "700", "line-height": "1.3" },
    ".cm-h2": { "font-size": "1.5em", "font-weight": "700", "line-height": "1.3" },
    ".cm-h3": { "font-size": "1.3em", "font-weight": "700" },
    ".cm-h4": { "font-size": "1.15em", "font-weight": "600" },
    ".cm-h5": { "font-size": "1.05em", "font-weight": "600" },
    ".cm-h6": { "font-size": "1em", "font-weight": "600", opacity: "0.85" },
    ".cm-quote": { "border-left": "3px solid #555", "padding-left": "8px", opacity: "0.85" },
    ".cm-li": { "padding-left": "2px" },
    ".cm-codeblock": { "font-family": "'Monaspace Xenon', ui-monospace, monospace", background: "rgba(140,140,140,0.10)", "font-size": "0.92em" },
    ".cm-frontmatter": { opacity: "0.5", "font-family": "'Monaspace Xenon', ui-monospace, monospace", "font-size": "0.85em" },
    ".cm-table": { "font-family": "'Monaspace Xenon', ui-monospace, monospace" },
    ".cm-math-inline": { display: "inline-block", "vertical-align": "middle" },
    ".cm-math-block": { display: "inline-block", "vertical-align": "middle" },
    ".cm-diagnostic-error": { "border-left": "3px solid #e5484d" },
    ".cm-diagnostic-warning": { "border-left": "3px solid #f5a623" },
    ".cm-lintRange-error": { "background": "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"6\" height=\"3\"><path d=\"m0 3 l3 -3 l3 3\" fill=\"none\" stroke=\"%23e5484d\"/></svg>') left bottom repeat-x" },
    ".cm-lintRange-warning": { "background": "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"6\" height=\"3\"><path d=\"m0 3 l3 -3 l3 3\" fill=\"none\" stroke=\"%23f5a623\"/></svg>') left bottom repeat-x" },
  }),
];
