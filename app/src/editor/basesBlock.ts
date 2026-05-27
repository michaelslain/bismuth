import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { render } from "solid-js/web";
import { BaseView } from "../bases/BaseView";

class BaseBlockWidget extends WidgetType {
  constructor(readonly source: string) { super(); }
  eq(other: BaseBlockWidget) { return other.source === this.source; }
  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "oa-base-block";
    // Solid render returns a dispose fn; store it for destroy().
    (container as any).__dispose = render(() => BaseView({ source: this.source }), container);
    return container;
  }
  destroy(dom: HTMLElement) {
    const dispose = (dom as any).__dispose;
    if (typeof dispose === "function") dispose();
  }
  ignoreEvent() { return true; }
}

// Find ```base ... ``` fenced blocks and replace each with a widget covering
// the block region. Editing the source still works because the widget is a
// block decoration placed after the fence; clicking into the lines reveals them.
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
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

export const basesBlock = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildDecorations(view); }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view); }
  },
  { decorations: (v) => v.decorations },
);
