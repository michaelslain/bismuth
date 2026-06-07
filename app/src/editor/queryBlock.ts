import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { RangeSetBuilder, StateField, StateEffect, type EditorState, type Extension } from "@codemirror/state";
import { mountSolid, disposeSolid } from "./solidWidget";
import { BaseView } from "../bases/BaseView";
import { parseQueryBlock } from "../../../core/src/bases/queryBlock";

// The ONE embedded block: ```query — the view INTO a base/notes. There is no ```base,
// ```view, or ```tasks block; everything that reads into a base/notes is a query (a
// base itself is a `type: base` md file, and tasks are queried with `tasks: <dsl>`).
//
// The fence is replaced by the rendered view, so the raw query never shows on its own.
// Pressing the view's SOURCE icon REVEALS the raw fence inline in the editor (just the
// markdown — edited and auto-saved like any other text, no save dialog), and it collapses
// back to the rendered view as soon as the caret leaves the block. livePreview skips
// `query` fences so it doesn't also render them as a code block.
const QUERY_FENCE = /^```query[ \t]*\n([\s\S]*?)\n```/gm;

/** A body is a full inline base config when it declares a top-level base key. Flat
 *  query specs (of:/tasks:/where:/view:/group:/limit:/from:) match none of these. */
function looksLikeBaseConfig(body: string): boolean {
  return /^(views|filters|formulas|properties|schema|source)\s*:/m.test(body);
}

interface QueryRange { from: number; to: number; bodyFrom: number; body: string }

/** All ```query fences in the document, in order. */
function queryRanges(state: EditorState): QueryRange[] {
  const text = state.doc.toString();
  const out: QueryRange[] = [];
  const re = new RegExp(QUERY_FENCE.source, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const from = m.index;
    const bodyFrom = from + m[0].indexOf("\n") + 1; // first char after the ```query line
    out.push({ from, to: from + m[0].length, bodyFrom, body: m[1] });
  }
  return out;
}

// Toggle a query block (by document-order index) between rendered and raw-editable.
const toggleQuerySource = StateEffect.define<number>();

/** Indices of query blocks currently revealed as raw source for inline editing. A block
 *  is added by the SOURCE icon and auto-removed once the caret is no longer inside it. */
const revealedField = StateField.define<Set<number>>({
  create: () => new Set(),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(toggleQuerySource)) {
        next = new Set(next);
        if (next.has(e.value)) next.delete(e.value);
        else next.add(e.value);
      }
    }
    if ((tr.selection || tr.docChanged) && next.size) {
      const ranges = queryRanges(tr.state);
      const head = tr.state.selection.main.head;
      const stillIn = new Set<number>();
      next.forEach((i) => { const r = ranges[i]; if (r && head >= r.from && head <= r.to) stillIn.add(i); });
      if (stillIn.size !== next.size) next = stillIn;
    }
    return next;
  },
});

class QueryBlockWidget extends WidgetType {
  private view?: EditorView;
  private dom?: HTMLElement;

  constructor(readonly source: string, readonly hostPath: string) {
    super();
  }

  eq(other: QueryBlockWidget): boolean {
    return other.source === this.source && other.hostPath === this.hostPath;
  }

  // Reveal THIS block's raw fence for inline editing: find its current index by DOM
  // position (robust to edits above) and drop the caret into its body.
  private reveal = () => {
    const view = this.view, dom = this.dom;
    if (!view || !dom) return;
    let pos: number;
    try { pos = view.posAtDOM(dom); } catch { return; }
    const ranges = queryRanges(view.state);
    const idx = ranges.findIndex((r) => pos >= r.from && pos <= r.to + 1);
    if (idx < 0) return;
    view.dispatch({ effects: toggleQuerySource.of(idx), selection: { anchor: ranges[idx].bodyFrom } });
    view.focus();
  };

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const container = document.createElement("div");
    container.className = "oa-query-block";
    this.dom = container;
    const embeddedSource = { onReveal: this.reveal };
    if (looksLikeBaseConfig(this.source)) {
      mountSolid(container, () => BaseView({ source: this.source, hostPath: this.hostPath, embeddedSource }));
    } else {
      mountSolid(container, () => BaseView({ view: parseQueryBlock(this.source), hostPath: this.hostPath, embeddedSource }));
    }
    return container;
  }

  destroy(dom: HTMLElement): void {
    disposeSolid(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const queryBodyMark = Decoration.mark({ class: "cm-query-body" });

// Replace each ```query fence with its rendered view — except blocks currently revealed
// for inline source editing, which show as the raw fence in the editor's monospace code
// font (edited like any code, auto-saved).
function buildDecorations(state: EditorState, hostPath: string): DecorationSet {
  const revealed = state.field(revealedField);
  const builder = new RangeSetBuilder<Decoration>();
  queryRanges(state).forEach((r, i) => {
    if (revealed.has(i)) builder.add(r.from, r.to, queryBodyMark); // raw, monospace
    else builder.add(r.from, r.to, Decoration.replace({ widget: new QueryBlockWidget(r.body, hostPath), block: true }));
  });
  return builder.finish();
}

// Monospace the revealed source, matching the editor's code font.
const queryTheme = EditorView.theme({
  ".cm-query-body": {
    fontFamily: "'Monaspace Xenon', ui-monospace, monospace",
    fontSize: "calc(1em * var(--mono-scale, 0.85))",
  },
});

// Collapse any open source block when the user clicks outside it. (Selection-move
// collapse in revealedField handles keyboard nav, but clicking the rendered task widgets
// below doesn't move the caret — they swallow the event — so a click outside needs its
// own handler to feel automatic.)
const collapseOnClickOutside = EditorView.domEventHandlers({
  mousedown(e, view) {
    const revealed = view.state.field(revealedField);
    if (!revealed.size) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const ranges = queryRanges(view.state);
    const toClose: number[] = [];
    revealed.forEach((i) => {
      const r = ranges[i];
      if (!r || pos == null || pos < r.from || pos > r.to) toClose.push(i);
    });
    if (toClose.length) view.dispatch({ effects: toClose.map((i) => toggleQuerySource.of(i)) });
    return false; // never prevent the click itself
  },
});

// Factory: the editor passes a getter for the current note path. Rebuilds when the doc
// changes or a block's revealed state flips (host-path changes drop+remount the editor).
export function queryBlock(getHostPath: () => string | null): Extension {
  const decoField = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, getHostPath() ?? "");
    },
    update(value, tr) {
      const revChanged = tr.startState.field(revealedField) !== tr.state.field(revealedField);
      if (tr.docChanged || revChanged) return buildDecorations(tr.state, getHostPath() ?? "");
      return value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [revealedField, collapseOnClickOutside, queryTheme, decoField];
}
