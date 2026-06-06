import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { mountSolid, SolidWidget } from "./solidWidget";
import { BaseView } from "../bases/BaseView";
import { parseQueryBlock } from "../../../core/src/bases/queryBlock";

// The ONE embedded block: ```query — the view INTO a base/notes. There is no ```base,
// ```view, or ```tasks block; everything that reads into a base/notes is a query (a
// base itself is a `type: base` md file, and tasks are queried with `tasks: <dsl>`).
//
// Body routing:
//   - a full inline base config (top-level views:/filters:/formulas:/source:) -> rendered inline
//   - else a flat query spec (of:/tasks:/where:/group:/view:) -> parseQueryBlock
const QUERY_FENCE = /^```query[ \t]*\n([\s\S]*?)\n```/gm;

/** A body is a full inline base config when it declares a top-level base key. Flat
 *  query specs (of:/tasks:/where:/view:/group:/limit:/from:) match none of these. */
function looksLikeBaseConfig(body: string): boolean {
  return /^(views|filters|formulas|properties|schema|source)\s*:/m.test(body);
}

class QueryBlockWidget extends SolidWidget {
  constructor(readonly source: string, readonly hostPath: string) {
    super("oa-query-block");
  }

  eq(other: QueryBlockWidget): boolean {
    return other.source === this.source && other.hostPath === this.hostPath;
  }

  protected renderSolid(container: HTMLElement): void {
    const hostPath = this.hostPath;
    if (looksLikeBaseConfig(this.source)) {
      mountSolid(container, () => BaseView({ source: this.source, hostPath }));
    } else {
      mountSolid(container, () => BaseView({ view: parseQueryBlock(this.source), hostPath }));
    }
  }
}

// Find ```query fenced blocks and render each as a block widget after the matched
// range. Block decorations MUST be provided via a StateField (CodeMirror forbids them
// from view plugins).
function buildDecorations(state: EditorState, getHostPath: () => string | null): DecorationSet {
  const hostPath = getHostPath() ?? "";
  const text = state.doc.toString();
  const builder = new RangeSetBuilder<Decoration>();
  const re = new RegExp(QUERY_FENCE.source, "gm"); // fresh instance: reset lastIndex per build
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const to = match.index + match[0].length;
    builder.add(to, to, Decoration.widget({ widget: new QueryBlockWidget(match[1], hostPath), side: 1, block: true }));
  }
  return builder.finish();
}

// Factory: the editor passes a getter for the current note path. The returned
// StateField rebuilds whenever doc text changes (host-path changes drop+remount
// the whole editor, so we don't need a separate signal for that).
export function queryBlock(getHostPath: () => string | null) {
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
