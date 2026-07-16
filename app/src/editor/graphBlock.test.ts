// app/src/editor/graphBlock.test.ts
//
// Coverage for the NON-PURE half of the ```graph block — the CodeMirror wiring in
// editor/graphBlock.ts. The DSL itself (parse/serialize/mutate) is pure and covered in
// core/test/graphBlock.test.ts; what THAT suite cannot see is the layer where the widget
// meets the document:
//
//   1. SOURCE (onReveal) → the block's raw fence actually becomes revealed.
//   2. A graph edit (onChange) → the RIGHT fence's body is rewritten in place.
//   3. A block whose source has parse errors can still reach SOURCE — the documented
//      (and only) recovery path out of the "Fix the source to enable graph editing" state.
//
// These are locate()-shaped guarantees: both reveal() and write() must map "this widget's
// DOM node" → "this fence's range AND its document-order index". The original code took the
// range and the index from TWO SEPARATE graphRanges() calls and recovered the index with
// Array.indexOf — but graphRanges() allocates fresh object literals per call, so indexOf
// compared deep-equal-but-distinct objects by reference and returned -1 forever. reveal()
// bailed on every click (SOURCE was dead on every graph block; revealedField could never
// become non-empty), which in turn made the parse-error state unrecoverable. Every test
// below fails against that code and passes now.
//
// Mounting: the widget renders a Solid component (graph/EmbeddedGraph.tsx), which cannot be
// imported here — bun resolves `solid-js/web` to its SERVER build, where lucide-solid's Icon
// throws "Client-only API called on the server side" at import time. So the presentational
// component and the Solid mount seam are mocked to capture the two callbacks graphBlock.ts
// hands down; the EditorView, the extension, the decorations and posAtDOM are all REAL, which
// is exactly where the bug lived. (Same real-EditorView rationale as tableWidget.test.ts.)

import { GlobalWindow } from "happy-dom";
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

interface GraphProps { source: string; onReveal: () => void; onChange: (body: string) => void }

/** Props of every EmbeddedGraph mounted by the extension, in document order. */
const mounted: GraphProps[] = [];

// Must be registered BEFORE graphBlock.ts is imported (below, dynamically) so its static
// import of the .tsx never loads the real module.
mock.module("../graph/EmbeddedGraph", () => ({
  EmbeddedGraph: (props: GraphProps) => {
    mounted.push(props);
    return null;
  },
}));
mock.module("./solidWidget", () => ({
  // Run the component eagerly instead of handing it to Solid's render(): we only need the
  // props it was called with, and real render() is unavailable in the server build.
  mountSolid: (_container: HTMLElement, component: () => unknown) => { component(); },
  disposeSolid: () => {},
}));

const { graphBlock, revealedGraphBlocks } = await import("./graphBlock");

// Same install/restore discipline as tableWidget.test.ts + undoRedoScroll.test.ts: add only
// the globals this file needs and remove exactly those, so a leaked DOM can't leak into the
// intentionally-headless test files sharing this `bun test app` process.
const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "Text",
  "DocumentFragment", "MutationObserver", "Range", "NodeFilter", "DOMParser",
  "HTMLDivElement", "HTMLSpanElement", "DOMRect", "ResizeObserver", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame", "getSelection", "Selection",
];
const installed: string[] = [];
const views: EditorView[] = [];

beforeAll(() => {
  const win = new GlobalWindow();
  for (const key of DOM_GLOBALS) {
    if (!(key in globalThis) && key in win) {
      (globalThis as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
      installed.push(key);
    }
  }
});

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  mounted.length = 0;
});

afterAll(() => {
  for (const key of installed) delete (globalThis as Record<string, unknown>)[key];
});

function mount(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [graphBlock()] }) });
  views.push(view);
  return view;
}

const ONE = "```graph\na -> b\n```";
// A block inside a note: prose gives the caret somewhere to be that is OUTSIDE the fence
// (in ONE the fence starts at position 0, so even position 0 counts as inside it).
const IN_NOTE = "intro\n\n```graph\na -> b\n```\n";
// Two blocks with DIFFERENT bodies, plus prose around/between them: the second block's
// range only lines up if the widget locates itself rather than assuming index 0.
const TWO = "intro\n\n```graph\na -> b\n```\n\nmiddle\n\n```graph\nz\n```\n\noutro\n";

describe("the extension mounts one widget per fence", () => {
  test("each ```graph fence renders a widget over its own body", () => {
    mount(TWO);
    expect(mounted.map((m) => m.source)).toEqual(["a -> b", "z"]);
  });
});

describe("SOURCE reveals THIS block (the dead-button regression)", () => {
  test("onReveal marks the block revealed", () => {
    const view = mount(ONE);
    expect(revealedGraphBlocks(view.state).size).toBe(0); // nothing revealed initially
    mounted[0].onReveal();
    // Was 0 forever: reveal() recovered its index with indexOf across two graphRanges()
    // arrays, got -1, and returned before dispatching.
    expect([...revealedGraphBlocks(view.state)]).toEqual([0]);
  });

  test("onReveal drops the caret INTO the revealed block's body", () => {
    const view = mount(ONE);
    mounted[0].onReveal();
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf("a -> b"));
  });

  test("the SECOND block reveals itself — not block 0", () => {
    const view = mount(TWO);
    mounted[1].onReveal();
    expect([...revealedGraphBlocks(view.state)]).toEqual([1]);
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf("\nz\n") + 1);
  });

  test("revealing collapses again once the caret leaves the block", () => {
    const view = mount(IN_NOTE);
    mounted[0].onReveal();
    expect(revealedGraphBlocks(view.state).size).toBe(1);
    view.dispatch({ selection: { anchor: 0 } }); // caret out to the prose above
    expect(revealedGraphBlocks(view.state).size).toBe(0);
    expect(mounted.at(-1)!.source).toBe("a -> b"); // and the graph renders again
  });
});

describe("a graph edit writes back to the RIGHT fence", () => {
  test("onChange replaces this block's body in place", () => {
    const view = mount(ONE);
    mounted[0].onChange("x -> y");
    expect(view.state.doc.toString()).toBe("```graph\nx -> y\n```");
  });

  test("the second block's write-back leaves the first block and the prose untouched", () => {
    const view = mount(TWO);
    mounted[1].onChange("q -> r: hello");
    expect(view.state.doc.toString()).toBe(
      "intro\n\n```graph\na -> b\n```\n\nmiddle\n\n```graph\nq -> r: hello\n```\n\noutro\n",
    );
  });

  test("a multi-line body replaces the whole body, not just its first line", () => {
    const view = mount(TWO);
    mounted[0].onChange("a\nb\na -> b");
    expect(view.state.doc.toString()).toBe(
      "intro\n\n```graph\na\nb\na -> b\n```\n\nmiddle\n\n```graph\nz\n```\n\noutro\n",
    );
  });

  test("write-back is an ordinary undoable doc change (round-trips the markdown)", () => {
    const view = mount(ONE);
    mounted[0].onChange("x -> y");
    // The doc change re-renders the block from the new markdown — the round-trip's
    // second half: what the widget shows comes back out of the document.
    expect(mounted.at(-1)!.source).toBe("x -> y");
  });

  test("an identical body dispatches nothing", () => {
    const view = mount(ONE);
    const before = view.state.doc.toString();
    mounted[0].onChange("a -> b");
    expect(view.state.doc.toString()).toBe(before);
  });
});

// Blocker: a hand-written/pasted block with a typo disables every edit tool ("Fix the
// source to enable graph editing"), so SOURCE is the ONLY way back — and it must work
// while the block is in exactly that state, or the block is permanently bricked.
describe("a block with parse errors can still be recovered via SOURCE", () => {
  const BAD = "intro\n\n```graph\na b\n```\n"; // `a b` — a forgotten arrow: "unexpected text"

  test("the erroring block still reveals its source", () => {
    const view = mount(BAD);
    mounted[0].onReveal();
    expect([...revealedGraphBlocks(view.state)]).toEqual([0]);
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf("a b"));
  });

  // The whole documented escape, end to end: SOURCE → hand-fix the typo → caret leaves →
  // the block is a working graph again. Every step of this was unreachable before.
  test("fixing the typo in the revealed source restores a clean graph", () => {
    const view = mount(BAD);
    mounted[0].onReveal();
    expect(revealedGraphBlocks(view.state).size).toBe(1); // the raw fence is reachable at all
    const at = view.state.doc.toString().indexOf("a b");
    view.dispatch({ changes: { from: at, to: at + 3, insert: "a -> b" } }); // hand-edit
    expect(view.state.doc.toString()).toBe(IN_NOTE);
    view.dispatch({ selection: { anchor: 0 } }); // caret leaves → collapses back
    expect(revealedGraphBlocks(view.state).size).toBe(0);
    expect(mounted.at(-1)!.source).toBe("a -> b"); // re-renders as a real graph again
  });
});
