// Shared fence-block scanner for CodeMirror StateField extensions.
//
// Both tasksQuery and viewBlock need the same machinery:
//   - find OPEN lines (```` ```<info> ````)
//   - collect body lines until a bare CLOSE fence
//   - compute blockFrom/blockTo, detect cursor-inside
//   - push a block-replace Decoration only when the cursor is outside
//   - wrap everything in a StateField that rebuilds on docChanged || selection
//
// Usage:
//   import { fenceBlockField } from "./fenceBlock";
//   export const myExt = fenceBlockField("tasks", (body) => new MyWidget(body));

import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/** Bare fence close pattern (``` with optional indentation). */
const CLOSE = /^\s*```+\s*$/;

/** Build the open-fence regex for a given info string (case-insensitive). */
function openRe(infoString: string): RegExp {
  return new RegExp(`^\\s*\`\`\`+\\s*${infoString}\\s*$`, "i");
}

/**
 * Scan the document for fenced blocks whose opening fence matches `infoString`
 * and produce block-replace decorations for any block whose range does NOT
 * contain the cursor. Widget instances are produced by `makeWidget(bodyText)`.
 *
 * `extraArgs` is forwarded to `makeWidget` as additional parameters — used by
 * viewBlock to pass `hostPath`.
 */
function buildFenceDecorations<A extends unknown[]>(
  state: EditorState,
  OPEN: RegExp,
  makeWidget: (body: string, ...args: A) => WidgetType,
  extraArgs: A,
): DecorationSet {
  const doc = state.doc;
  const head = state.selection.main.head;
  const decos: Range<Decoration>[] = [];

  let i = 1;
  while (i <= doc.lines) {
    const line = doc.line(i);
    if (OPEN.test(line.text)) {
      const bodyLines: string[] = [];
      let j = i + 1;
      while (j <= doc.lines && !CLOSE.test(doc.line(j).text)) {
        bodyLines.push(doc.line(j).text);
        j++;
      }
      if (j <= doc.lines) {
        const blockFrom = line.from;
        const blockTo = doc.line(j).to;
        const cursorInside = head >= blockFrom && head <= blockTo;
        if (!cursorInside) {
          decos.push(
            Decoration.replace({
              widget: makeWidget(bodyLines.join("\n"), ...extraArgs),
              block: true,
            }).range(blockFrom, blockTo),
          );
        }
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return Decoration.set(decos, true);
}

/**
 * Factory that returns a complete CodeMirror Extension for a fenced-block type.
 *
 * @param infoString  The fence info word (e.g. "tasks", "view").
 * @param makeWidget  Factory that receives the body text and any extra args and
 *                    returns a WidgetType.  Extra args are re-evaluated on every
 *                    rebuild via `getExtraArgs()`.
 * @param getExtraArgs  Called on each rebuild to get extra arguments for
 *                      `makeWidget`.  Defaults to `() => []` (no extras).
 */
export function fenceBlockField<A extends unknown[] = []>(
  infoString: string,
  makeWidget: (body: string, ...args: A) => WidgetType,
  getExtraArgs: () => A = () => [] as unknown as A,
): Extension {
  const OPEN = openRe(infoString);
  return StateField.define<DecorationSet>({
    create(state) {
      return buildFenceDecorations(state, OPEN, makeWidget, getExtraArgs());
    },
    update(deco, tr) {
      if (tr.docChanged || tr.selection) {
        return buildFenceDecorations(tr.state, OPEN, makeWidget, getExtraArgs());
      }
      return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
