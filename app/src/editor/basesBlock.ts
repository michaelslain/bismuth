import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { render } from "solid-js/web";
import { BaseView } from "../bases/BaseView";

class BaseBlockWidget extends WidgetType {
  constructor(readonly source: string) { super(); }
  eq(other: BaseBlockWidget) { return other.source === this.source; }
  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "oa-base-block";
    // Solid render returns a dispose fn; store it for destroy().
    (container as unknown as { __dispose?: () => void }).__dispose = render(
      () => BaseView({ source: this.source }),
      container,
    );
    return container;
  }
  destroy(dom: HTMLElement) {
    const dispose = (dom as unknown as { __dispose?: () => void }).__dispose;
    if (typeof dispose === "function") dispose();
  }
  ignoreEvent() { return true; }
}

// Find ```base ... ``` fenced blocks and render each as a block widget placed
// after the closing fence. Block decorations MUST be provided via a StateField
// (CodeMirror forbids block decorations from view plugins), so this is a field
// that recomputes on document change.
function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = state.doc.toString();
  const fenceRe = /^```base[ \t]*\n([\s\S]*?)\n```/gm;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text))) {
    const to = m.index + m[0].length;
    const body = m[1];
    builder.add(
      to,
      to,
      Decoration.widget({ widget: new BaseBlockWidget(body), side: 1, block: true }),
    );
  }
  return builder.finish();
}

export const basesBlock = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(value, tr) {
    if (tr.docChanged) return buildDecorations(tr.state);
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});
