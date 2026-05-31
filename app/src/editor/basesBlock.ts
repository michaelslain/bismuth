import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { mountSolid, SolidWidget } from "./solidWidget";
import { BaseView } from "../bases/BaseView";

// Inline base block (```base …```). Source is the YAML between the fences;
// hostPath is the note we're rendering inside (used so the embedded base
// can resolve `this.*` against the host's frontmatter).
class BaseBlockWidget extends SolidWidget {
  constructor(readonly source: string, readonly hostPath: string) { super("oa-base-block"); }

  eq(other: BaseBlockWidget): boolean {
    return other.source === this.source && other.hostPath === this.hostPath;
  }

  protected renderSolid(container: HTMLElement): void {
    mountSolid(container, () => BaseView({ source: this.source, hostPath: this.hostPath }));
  }
}

// `![[file.base]]` transclusion. Renders the full referenced .base file as a
// block widget, with the host note's frontmatter available as `this.*`.
class BaseEmbedWidget extends SolidWidget {
  constructor(readonly basePath: string, readonly hostPath: string) { super("oa-base-embed"); }

  eq(other: BaseEmbedWidget): boolean {
    return other.basePath === this.basePath && other.hostPath === this.hostPath;
  }

  protected renderSolid(container: HTMLElement): void {
    mountSolid(container, () => BaseView({ path: this.basePath, hostPath: this.hostPath }));
  }
}

// Find ```base ... ``` fenced blocks AND `![[*.base]]` embeds, and render
// each as a block widget after the matched range. Block decorations MUST be
// provided via a StateField (CodeMirror forbids them from view plugins).
function buildDecorations(state: EditorState, getHostPath: () => string | null): DecorationSet {
  const hostPath = getHostPath() ?? "";
  const text = state.doc.toString();
  const matches: { to: number; widget: WidgetType }[] = [];

  // Base code block: ```base ... ```
  const fenceRe = /^```base[ \t]*\n([\s\S]*?)\n```/gm;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text))) {
    matches.push({ to: match.index + match[0].length, widget: new BaseBlockWidget(match[1], hostPath) });
  }

  // Transclusion: `![[foo.base]]` or `![[path/to/foo.base|alias]]` (standalone embeds only).
  const embedRe = /^!\[\[([^\]\n|]+\.base)(?:\|[^\]\n]*)?\]\][ \t]*$/gm;
  while ((match = embedRe.exec(text))) {
    matches.push({ to: match.index + match[0].length, widget: new BaseEmbedWidget(match[1], hostPath) });
  }

  // RangeSetBuilder requires sorted insertions.
  matches.sort((a, b) => a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { to, widget } of matches) {
    builder.add(to, to, Decoration.widget({ widget, side: 1, block: true }));
  }
  return builder.finish();
}

// Factory: the editor passes a getter for the current note path. The returned
// StateField rebuilds whenever doc text changes (host-path changes drop+remount
// the whole editor, so we don't need a separate signal for that).
export function basesBlock(getHostPath: () => string | null) {
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
