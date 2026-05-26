// app/src/editor/livePreview.ts
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type Range } from "@codemirror/state";

// marks
const hide = Decoration.mark({ class: "cm-hidden-syntax" });
const strong = Decoration.mark({ class: "cm-strong" });
const em = Decoration.mark({ class: "cm-em" });
const strike = Decoration.mark({ class: "cm-strike" });
const code = Decoration.mark({ class: "cm-inline-code" });
const link = Decoration.mark({ class: "cm-link" });
const wikilink = Decoration.mark({ class: "cm-wikilink" });
// line decorations
const headingLine = [1, 2, 3, 4, 5, 6].map((l) => Decoration.line({ class: `cm-h${l}` }));
const quoteLine = Decoration.line({ class: "cm-quote" });
const bulletLine = Decoration.line({ class: "cm-li" });
const codeBlockLine = Decoration.line({ class: "cm-codeblock" });

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

function build(view: EditorView): DecorationSet {
  const deco: Range<Decoration>[] = [];
  const doc = view.state.doc;
  const cursorLine = doc.lineAt(view.state.selection.main.head).number;

  // precompute fenced code regions (scan whole doc so viewport offsets don't matter)
  const fenceLines = new Set<number>(); // the ``` marker lines
  const codeLines = new Set<number>();  // lines inside a fence
  let inFence = false;
  for (let i = 1; i <= doc.lines; i++) {
    if (/^\s*```/.test(doc.line(i).text)) { fenceLines.add(i); inFence = !inFence; }
    else if (inFence) codeLines.add(i);
  }

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const onCursor = line.number === cursorLine;
      const text = line.text;

      // fenced code: style the block monospace and skip inline-markdown processing inside it
      if (fenceLines.has(line.number) || codeLines.has(line.number)) {
        deco.push(codeBlockLine.range(line.from));
        pos = line.to + 1;
        continue;
      }

      // headings: size the whole line, hide the leading "#"s off the cursor line
      const hm = text.match(/^(#{1,6})\s+/);
      if (hm) {
        deco.push(headingLine[hm[1].length - 1].range(line.from));
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
      constructor(view: EditorView) { this.decorations = build(view); }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  ),
  EditorView.theme({
    ".cm-hidden-syntax": { display: "none" },
    ".cm-strong": { "font-weight": "bold" },
    ".cm-em": { "font-style": "italic" },
    ".cm-strike": { "text-decoration": "line-through", opacity: "0.7" },
    ".cm-inline-code": { "font-family": "ui-monospace, monospace", background: "rgba(140,140,140,0.18)", padding: "0 3px", "border-radius": "3px" },
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
    ".cm-codeblock": { "font-family": "ui-monospace, monospace", background: "rgba(140,140,140,0.10)", "font-size": "0.92em" },
  }),
];
