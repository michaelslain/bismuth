// app/src/editor/mathBlock.ts
//
// StateField extension that renders multi-line $$ ... $$ math blocks via KaTeX.
// Block-replace decorations MUST live in a StateField (not a ViewPlugin) — CM forbids
// `block: true` decorations from plugins.  This mirrors the pattern in fenceBlock.ts.

import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { renderMath, onMathReady } from "./katexLoader";

/** Matches a line whose entire trimmed content is exactly `$$`. */
const MATH_FENCE = /^\s*\$\$\s*$/;

/** Matches the start of a fenced code block (``` with optional info string). */
const CODE_FENCE = /^\s*```/;

class MathBlockWidget extends WidgetType {
  private readonly expr: string;

  constructor(expr: string) {
    super();
    this.expr = expr;
  }

  eq(other: MathBlockWidget): boolean {
    return other.expr === this.expr;
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-math-block";
    div.innerHTML = renderMath(this.expr, true);
    // If KaTeX wasn't loaded yet, renderMath returned "" and kicked off the lazy
    // load — fill the node in once the library is ready (same final output).
    if (!div.innerHTML) onMathReady(() => { div.innerHTML = renderMath(this.expr, true); });
    return div;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function build(state: EditorState): DecorationSet {
  const doc = state.doc;
  const head = state.selection.main.head;
  const decos: Range<Decoration>[] = [];

  let inFence = false;
  let i = 1;
  while (i <= doc.lines) {
    const line = doc.line(i);

    // Track fenced code blocks so $$ lines inside them are ignored.
    if (CODE_FENCE.test(line.text)) {
      inFence = !inFence;
      i++;
      continue;
    }

    if (!inFence && MATH_FENCE.test(line.text)) {
      // Found an opening $$. Search forward for the matching closing $$.
      let found = false;
      for (let j = i + 1; j <= doc.lines; j++) {
        const jLine = doc.line(j);

        // A code fence inside the $$ search — treat opener as plain text, stop searching.
        if (CODE_FENCE.test(jLine.text)) break;

        if (MATH_FENCE.test(jLine.text)) {
          // Collect inner lines (between open and close, exclusive).
          const innerLines: string[] = [];
          for (let k = i + 1; k < j; k++) {
            innerLines.push(doc.line(k).text);
          }
          const expr = innerLines.join("\n");

          const blockFrom = line.from;
          const blockTo = jLine.to;
          const cursorInside = head >= blockFrom && head <= blockTo;

          if (!cursorInside) {
            decos.push(
              Decoration.replace({
                widget: new MathBlockWidget(expr),
                block: true,
              }).range(blockFrom, blockTo),
            );
          }

          i = j + 1;
          found = true;
          break;
        }
      }
      if (!found) i++;
    } else {
      i++;
    }
  }

  return Decoration.set(decos, true);
}

/**
 * CodeMirror Extension that replaces multi-line `$$ ... $$` blocks with a
 * rendered KaTeX widget when the cursor is outside the block.
 */
export function mathBlock(): Extension {
  const field = StateField.define<DecorationSet>({
    create(state) {
      return build(state);
    },
    update(deco, tr) {
      if (tr.docChanged || tr.selection) {
        return build(tr.state);
      }
      return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [
    field,
    EditorView.theme({
      ".cm-math-block": { display: "block", "text-align": "left", margin: "0.4em 0" },
      ".cm-math-block .katex-display": { "text-align": "left", margin: "0" },
      ".cm-math-block .katex-display > .katex": { "text-align": "left" },
    }),
  ];
}
