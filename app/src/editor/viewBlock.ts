import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { render } from "solid-js/web";
import { BaseView } from "../bases/BaseView";
import { parseViewBlock } from "../../../core/src/bases/viewBlock";

// Inline ```view block. The body is parsed into a ViewBlock spec (of/from/as/where),
// resolved against base/notes/tasks, and rendered by BaseView. hostPath lets the
// block resolve `this.*` against the host note's frontmatter.
class ViewBlockWidget extends WidgetType {
  constructor(readonly source: string, readonly hostPath: string) {
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

  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(state: EditorState, getHostPath: () => string | null): DecorationSet {
  const hostPath = getHostPath() ?? "";
  const text = state.doc.toString();
  const matches: { to: number; widget: WidgetType }[] = [];

  const fenceRe = /^```view[ \t]*\n([\s\S]*?)\n```/gm;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text))) {
    matches.push({ to: match.index + match[0].length, widget: new ViewBlockWidget(match[1], hostPath) });
  }

  matches.sort((a, b) => a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { to, widget } of matches) {
    builder.add(to, to, Decoration.widget({ widget, side: 1, block: true }));
  }
  return builder.finish();
}

/** Renders ```view blocks inline. Block decorations must be a StateField (not a view plugin). */
export function viewBlock(getHostPath: () => string | null) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, getHostPath);
    },
    update(value, tr) {
      if (tr.docChanged) return buildDecorations(tr.state, getHostPath);
      return value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
