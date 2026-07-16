// app/src/editor/graphBlock.ts
//
// The ```graph embedded block — a custom graph (nodes + edges) authored as a small DSL
// in the note body and rendered INLINE as an interactive canvas graph (the same renderer
// as the knowledge graph). The block is a full markdown ⇄ graph round-trip: editing the
// graph through the widget's tools (add node, connect/disconnect, rename, delete) writes
// the updated canonical markdown BACK into this same fence via an ordinary editor
// transaction, so it autosaves exactly like typed text and undoes with Cmd+Z.
//
// Structure mirrors queryBlock.ts (the ONE embedded-block precedent): the fence is
// replaced by the rendered widget; the widget's SOURCE control reveals the raw fence for
// inline text editing, which collapses back once the caret leaves the block; livePreview
// (blockRegions.ts) skips `graph` fences so they aren't ALSO rendered as code blocks.
// The DSL's pure parser/serializer live in core/src/graphBlock.ts (unit-tested round-trip).

import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { StateField, StateEffect, type EditorState, type Extension } from "@codemirror/state";
import { mountSolid, disposeSolid } from "./solidWidget";
import { EmbeddedGraph } from "../graph/EmbeddedGraph";
import { numberedLine, codeLineNumberTheme } from "./codeLineNumbers";

const GRAPH_FENCE = /^```graph[ \t]*\n([\s\S]*?)\n```/gm;

interface GraphRange { from: number; to: number; bodyFrom: number; body: string }

/** All ```graph fences in the document, in order. */
function graphRanges(state: EditorState): GraphRange[] {
  const text = state.doc.toString();
  const out: GraphRange[] = [];
  GRAPH_FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GRAPH_FENCE.exec(text))) {
    const from = m.index;
    const bodyFrom = from + m[0].indexOf("\n") + 1; // first char after the ```graph line
    out.push({ from, to: from + m[0].length, bodyFrom, body: m[1] });
  }
  return out;
}

// Toggle a graph block (by document-order index) between rendered and raw-editable.
const toggleGraphSource = StateEffect.define<number>();

/** Indices of graph blocks currently revealed as raw source for inline editing. A block
 *  is added by the SOURCE control and auto-removed once the caret leaves it. */
const revealedField = StateField.define<Set<number>>({
  create: () => new Set(),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(toggleGraphSource)) {
        next = new Set(next);
        if (next.has(e.value)) next.delete(e.value);
        else next.add(e.value);
      }
    }
    if ((tr.selection || tr.docChanged) && next.size) {
      const ranges = graphRanges(tr.state);
      const head = tr.state.selection.main.head;
      const stillIn = new Set<number>();
      next.forEach((i) => { const r = ranges[i]; if (r && head >= r.from && head <= r.to) stillIn.add(i); });
      if (stillIn.size !== next.size) next = stillIn;
    }
    return next;
  },
});

class GraphBlockWidget extends WidgetType {
  private view?: EditorView;
  private dom?: HTMLElement;

  constructor(readonly source: string) {
    super();
  }

  eq(other: GraphBlockWidget): boolean {
    return other.source === this.source;
  }

  /** This block's CURRENT range, located by DOM position (robust to edits above). */
  private myRange(): GraphRange | null {
    const view = this.view, dom = this.dom;
    if (!view || !dom) return null;
    let pos: number;
    try { pos = view.posAtDOM(dom); } catch { return null; }
    return graphRanges(view.state).find((r) => pos >= r.from && pos <= r.to + 1) ?? null;
  }

  // Reveal THIS block's raw fence for inline text editing and drop the caret into it.
  private reveal = () => {
    const view = this.view;
    if (!view) return;
    const ranges = graphRanges(view.state);
    const r = this.myRange();
    const idx = r ? ranges.indexOf(r) : -1;
    if (idx < 0) return;
    view.dispatch({ effects: toggleGraphSource.of(idx), selection: { anchor: ranges[idx].bodyFrom } });
    view.focus();
  };

  // THE write-back half of the round-trip: replace this block's body with the new
  // canonical markdown via an ordinary transaction (undoable, autosaved like typing).
  private write = (newBody: string) => {
    const view = this.view;
    if (!view) return;
    const r = this.myRange();
    if (!r || newBody === r.body) return;
    const bodyTo = r.bodyFrom + r.body.length;
    view.dispatch({ changes: { from: r.bodyFrom, to: bodyTo, insert: newBody } });
  };

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const container = document.createElement("div");
    container.className = "bismuth-graph-block";
    this.dom = container;
    mountSolid(container, () => EmbeddedGraph({ source: this.source, onReveal: this.reveal, onChange: this.write }));
    return container;
  }

  destroy(dom: HTMLElement): void {
    disposeSolid(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// A revealed-source fence line (the ```graph / closing ``` lines): monospace, no number.
const graphBodyLine = Decoration.line({ class: "cm-graphblock-body" });

// Replace each ```graph fence with its rendered widget — except blocks currently
// revealed for inline source editing, which show as the raw fence (numbered body lines,
// matching the ```query source view).
function buildDecorations(state: EditorState): DecorationSet {
  const revealed = state.field(revealedField);
  const doc = state.doc;
  const deco: ReturnType<Decoration["range"]>[] = [];
  graphRanges(state).forEach((r, i) => {
    if (revealed.has(i)) {
      const openLine = doc.lineAt(r.from).number;
      const closeLine = doc.lineAt(r.to).number;
      for (let ln = openLine; ln <= closeLine; ln++) {
        const line = doc.line(ln);
        const isBody = ln > openLine && ln < closeLine;
        deco.push((isBody ? numberedLine("cm-graphblock-body", ln - openLine) : graphBodyLine).range(line.from));
      }
    } else {
      deco.push(Decoration.replace({ widget: new GraphBlockWidget(r.body), block: true }).range(r.from, r.to));
    }
  });
  return Decoration.set(deco, true);
}

// Monospace the revealed source, matching the editor's code font (same as ```query).
const graphTheme = EditorView.theme({
  ".cm-graphblock-body": {
    fontFamily: "'Monaspace Xenon', ui-monospace, monospace",
    fontSize: "calc(1em * var(--mono-scale, 0.85))",
  },
});

// Collapse any open source block when the user clicks outside it (keyboard nav is
// handled by revealedField's selection check; clicks into the rendered widget don't
// move the caret, so they need this explicit handler — same rationale as queryBlock).
const collapseOnClickOutside = EditorView.domEventHandlers({
  mousedown(e, view) {
    const revealed = view.state.field(revealedField);
    if (!revealed.size) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const ranges = graphRanges(view.state);
    const toClose: number[] = [];
    revealed.forEach((i) => {
      const r = ranges[i];
      if (!r || pos == null || pos < r.from || pos > r.to) toClose.push(i);
    });
    if (toClose.length) view.dispatch({ effects: toClose.map((i) => toggleGraphSource.of(i)) });
    return false; // never prevent the click itself
  },
});

/** The ```graph embedded-block extension. Rebuilds when the doc changes or a block's
 *  revealed state flips. */
export function graphBlock(): Extension {
  const decoField = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state);
    },
    update(value, tr) {
      const revChanged = tr.startState.field(revealedField) !== tr.state.field(revealedField);
      if (tr.docChanged || revChanged) return buildDecorations(tr.state);
      return value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [revealedField, collapseOnClickOutside, graphTheme, codeLineNumberTheme, decoField];
}
