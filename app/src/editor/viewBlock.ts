// CodeMirror extension that renders ```view blocks via the unified BaseView host.
// A StateField scans for ```view fences and block-replaces each (when the cursor is
// outside it) with a widget that resolves the block's source (base/notes/tasks) and
// renders the chosen view type. Block-replacing decorations must come from a StateField,
// not a ViewPlugin. Mirrors the tasksQuery extension's replace+reveal pattern.
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { render } from "solid-js/web";
import { BaseView } from "../bases/BaseView";
import { parseViewBlock } from "../../../core/src/bases/viewBlock";

const OPEN = /^\s*```+\s*view\s*$/i; // opening fence with the "view" info string
const CLOSE = /^\s*```+\s*$/; // a bare fence line

class ViewBlockWidget extends WidgetType {
  constructor(private readonly source: string, private readonly hostPath: string) {
    super();
  }

  eq(other: ViewBlockWidget): boolean {
    return other.source === this.source && other.hostPath === this.hostPath;
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "oa-view-block";
    const spec = parseViewBlock(this.source);
    const dispose = render(() => BaseView({ view: spec, hostPath: this.hostPath }), container);
    (container as unknown as { __dispose?: () => void }).__dispose = dispose;
    return container;
  }

  destroy(dom: HTMLElement): void {
    const dispose = (dom as unknown as { __dispose?: () => void }).__dispose;
    if (typeof dispose === "function") dispose();
  }

  // Keep the rendered view interactive (kanban drag, calendar clicks, flashcard buttons).
  ignoreEvent(): boolean {
    return true;
  }
}

function build(state: EditorState, getHostPath: () => string | null): DecorationSet {
  const hostPath = getHostPath() ?? "";
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
              widget: new ViewBlockWidget(bodyLines.join("\n"), hostPath),
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

/** Renders ```view blocks inline (block-replace; revealed for editing when the cursor enters). */
export function viewBlock(getHostPath: () => string | null): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, getHostPath),
    update(deco, tr) {
      if (tr.docChanged || tr.selection) return build(tr.state, getHostPath);
      return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
