// app/src/editor/livePreview.ts
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";

// Hide the "**"/"*" markers and style the inner text, unless the cursor is on that line.
const STRONG = /\*\*([^*]+)\*\*/g;
const EM = /(?<!\*)\*([^*]+)\*(?!\*)/g;
const HEAD = /^(#{1,6})\s+/;
const LINK = /\[\[([^\]]+?)\]\]/g;

const hide = Decoration.mark({ class: "cm-hidden-syntax" });
const strong = Decoration.mark({ class: "cm-strong" });
const em = Decoration.mark({ class: "cm-em" });
const link = Decoration.mark({ class: "cm-wikilink" });

function build(view: EditorView): DecorationSet {
  // Collect all ranges then let Decoration.set sort them (avoids "must be added
  // sorted by from position" errors when hide-close and inner-mark overlap).
  const ranges: Range<Decoration>[] = [];
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const onCursorLine = line.number === cursorLine;
      const text = line.text;

      const h = text.match(HEAD);
      if (h && !onCursorLine) ranges.push(hide.range(line.from, line.from + h[0].length));

      const apply = (re: RegExp, markLen: number, mark: Decoration) => {
        for (const m of text.matchAll(re)) {
          const s = line.from + (m.index ?? 0);
          const innerStart = s + markLen, innerEnd = s + m[0].length - markLen;
          if (!onCursorLine) {
            ranges.push(hide.range(s, innerStart));
            ranges.push(hide.range(innerEnd, s + m[0].length));
          }
          ranges.push(mark.range(innerStart, innerEnd));
        }
      };
      apply(STRONG, 2, strong);
      apply(EM, 1, em);
      for (const m of text.matchAll(LINK)) {
        const s = line.from + (m.index ?? 0);
        ranges.push(link.range(s, s + m[0].length));
      }
      pos = line.to + 1;
    }
  }
  // true = sort the ranges, required because we push them in arbitrary order
  return Decoration.set(ranges, true);
}

export const livePreview = [
  ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view); }
  }, { decorations: (v) => v.decorations }),
  EditorView.theme({
    ".cm-hidden-syntax": { display: "none" },
    ".cm-strong": { "font-weight": "bold" },
    ".cm-em": { "font-style": "italic" },
    ".cm-wikilink": { color: "#6496ff", cursor: "pointer", "text-decoration": "underline" },
  }),
];
