// #58 — bold/italic spans CONTAINING inline `$…$` math showed their literal `**`/`*` markers
// (and no bold/italic styling) in live preview, while the math itself rendered fine. Mechanism:
// livePreview's emphasis pass skipped any token OVERLAPPING a math span — the guard meant to
// keep markdown emphasis off LaTeX `*`/`_`/`~` INSIDE `$…$` also killed legitimate tokens whose
// inner text merely contains math. The fix (inlineEmphasis.ts pushInline) tests only the two
// DELIMITER runs against the protected spans.
//
// Two layers here:
//   1. Pure range tests on pushEmphasis — the exact decoration ranges for the repro shapes.
//   2. Mounted-EditorView DOM tests (happy-dom, the tableWidget.test.ts pattern): a minimal
//      live-preview-like extension composing math REPLACE widgets + pushEmphasis, asserting the
//      rendered DOM the user sees — `**` hidden (cm-hidden-syntax), cm-strong applied, the math
//      widget present. livePreview.ts itself can't be imported under bun test (it pulls Solid
//      .tsx the test transform can't compile) — it calls this same exported pushEmphasis.

import { GlobalWindow } from "happy-dom";
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { StateField, EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { pushEmphasis } from "./inlineEmphasis";

// ── layer 1: pure decoration-range tests ─────────────────────────────────────────────

/** The editor's single-line inline-math regex (livePreview.ts INLINE_MATH_RE). */
const INLINE_MATH_RE = /(?<!\$)\$([^$\n]+)\$(?!\$)/g;

function mathSpansOf(text: string): { from: number; to: number }[] {
  return [...text.matchAll(INLINE_MATH_RE)].map((m) => ({ from: m.index ?? 0, to: (m.index ?? 0) + m[0].length }));
}

type Simple = { from: number; to: number; cls: string };

/** Run the emphasis pass over one line (lineFrom 0) and project the ranges to {from,to,class}. */
function emphasize(text: string, reveal = false): Simple[] {
  const spans = mathSpansOf(text);
  const inMath = (s: number, e: number) => spans.some((h) => s < h.to && e > h.from);
  const deco: Range<Decoration>[] = [];
  pushEmphasis(deco, text, 0, () => reveal, inMath);
  return deco
    .map((r) => ({ from: r.from, to: r.to, cls: (r.value.spec as { class?: string }).class ?? "" }))
    .sort((a, b) => a.from - b.from);
}

describe("pushEmphasis — bold containing inline math (#58 repro shapes)", () => {
  test("**($\\Rightarrow$)** hides both ** and bolds the inner text", () => {
    const text = "**($\\Rightarrow$)**";
    const d = emphasize(text);
    expect(d).toContainEqual({ from: 0, to: 2, cls: "cm-hidden-syntax" });
    expect(d).toContainEqual({ from: text.length - 2, to: text.length, cls: "cm-hidden-syntax" });
    expect(d).toContainEqual({ from: 2, to: text.length - 2, cls: "cm-strong" });
  });

  test("**Case 1: $hk \\in H$.** hides both ** and bolds the inner text", () => {
    const text = "**Case 1: $hk \\in H$.**";
    const d = emphasize(text);
    expect(d).toContainEqual({ from: 0, to: 2, cls: "cm-hidden-syntax" });
    expect(d).toContainEqual({ from: text.length - 2, to: text.length, cls: "cm-hidden-syntax" });
    expect(d).toContainEqual({ from: 2, to: text.length - 2, cls: "cm-strong" });
  });

  test("**bold with $x$ math inside** works; control **plain bold** unchanged", () => {
    for (const text of ["**bold with $x$ math inside**", "**plain bold**"]) {
      const d = emphasize(text);
      expect(d.filter((r) => r.cls === "cm-strong")).toEqual([{ from: 2, to: text.length - 2, cls: "cm-strong" }]);
      expect(d.filter((r) => r.cls === "cm-hidden-syntax").length).toBe(2);
    }
  });

  test("italic *…$x$…* and strike ~~…$x$…~~ containing math also style", () => {
    const it = emphasize("*italic $x$ inside*");
    expect(it).toContainEqual({ from: 1, to: 18, cls: "cm-em" });
    const st = emphasize("~~gone $x$ gone~~");
    expect(st).toContainEqual({ from: 2, to: 15, cls: "cm-strike" });
  });

  test("underscore bold __b $x$ b__ containing math styles", () => {
    const d = emphasize("__b $x$ b__");
    expect(d).toContainEqual({ from: 2, to: 9, cls: "cm-strong" });
  });

  test("revealed (caret on token): delimiters get cm-syntax-mark, not hidden", () => {
    const d = emphasize("**Case 1: $hk \\in H$.**", true);
    expect(d.filter((r) => r.cls === "cm-syntax-mark").length).toBe(2);
    expect(d.filter((r) => r.cls === "cm-hidden-syntax").length).toBe(0);
    expect(d.some((r) => r.cls === "cm-strong")).toBe(true);
  });
});

describe("pushEmphasis — LaTeX inside $…$ stays protected", () => {
  test("emphasis-looking `*b*` INSIDE math is never styled", () => {
    const d = emphasize("$a *b* c$");
    expect(d.length).toBe(0);
  });

  test("a token whose CLOSING delimiter sits inside math is skipped", () => {
    // `**a $b** c$` — the closing ** lives inside the math span; styling it would corrupt LaTeX.
    const d = emphasize("**a $b** c$");
    expect(d.filter((r) => r.cls === "cm-strong").length).toBe(0);
  });

  test("subscript underscores inside math never italicize/bold", () => {
    const d = emphasize("$x_i + y_j$ and $a__b$");
    expect(d.length).toBe(0);
  });
});

// Bold+italic (***…***): STRONG_STAR_RE matches the middle `**…**` leaving the outer single
// `*`s unmatched (EM_RE's lookarounds reject a `*` adjacent to another `*`). That's the
// PRE-EXISTING behavior for plain ***bi*** — this locks that math inside doesn't make it worse.
test("***bi $x$ bi*** styles the strong middle exactly like plain ***bi***", () => {
  const plain = emphasize("***bi bi***");
  const math = emphasize("***bi $x$ bi***");
  expect(plain.filter((r) => r.cls === "cm-strong").length).toBe(1);
  expect(math.filter((r) => r.cls === "cm-strong").length).toBe(1);
  expect(math.filter((r) => r.cls === "cm-hidden-syntax").length).toBe(2);
});

// ── layer 2: mounted EditorView — the DOM the user sees ─────────────────────────────

const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "Text",
  "DocumentFragment", "MutationObserver", "Range", "NodeFilter", "DOMRect",
  "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "getSelection", "Selection",
  "getComputedStyle", "HTMLDivElement", "HTMLSpanElement",
];
const installed: string[] = [];

beforeAll(() => {
  const win = new GlobalWindow();
  for (const key of DOM_GLOBALS) {
    if (!(key in globalThis) && key in win) {
      (globalThis as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
      installed.push(key);
    }
  }
});

afterAll(() => {
  for (const k of installed) delete (globalThis as Record<string, unknown>)[k];
});

/** Stand-in for livePreview's MathWidget (which renders KaTeX — irrelevant here); same
 *  class name + replace-decoration shape, so the emphasis/math DOM interaction is faithful. */
class StubMathWidget extends WidgetType {
  constructor(private readonly expr: string) {
    super();
  }

  eq(other: StubMathWidget): boolean {
    return other.expr === this.expr;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-math";
    span.textContent = this.expr;
    return span;
  }
}

/** Minimal live-preview-like extension: math `$…$` → replace widgets, then the SAME
 *  pushEmphasis composition livePreview runs (unfocused editor → nothing revealed). */
function previewField(): Extension {
  const build = (state: EditorState): DecorationSet => {
    const deco: Range<Decoration>[] = [];
    for (let i = 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i);
      const spans: { from: number; to: number }[] = [];
      for (const m of line.text.matchAll(INLINE_MATH_RE)) {
        const s = line.from + (m.index ?? 0);
        const e = s + m[0].length;
        spans.push({ from: s, to: e });
        deco.push(Decoration.replace({ widget: new StubMathWidget(m[1]) }).range(s, e));
      }
      const inMath = (s: number, e: number) => spans.some((h) => s < h.to && e > h.from);
      pushEmphasis(deco, line.text, line.from, () => false, inMath);
    }
    return Decoration.set(deco, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (v, tr) => (tr.docChanged ? build(tr.state) : v),
    provide: (f) => EditorView.decorations.from(f),
  });
}

function mount(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({ state: EditorState.create({ doc, extensions: [previewField()] }), parent });
}

function texts(view: EditorView, sel: string): string[] {
  return [...view.dom.querySelectorAll(sel)].map((el) => el.textContent ?? "");
}

describe("mounted live-preview DOM — bold containing math (#58)", () => {
  test("**Case 1: $hk \\in H$.** — ** markers hidden, cm-strong applied, math widget present", () => {
    const view = mount("**Case 1: $hk \\in H$.**");
    try {
      // Both ** delimiter runs are wrapped in cm-hidden-syntax (display:none in the app theme).
      expect(texts(view, ".cm-hidden-syntax")).toEqual(["**", "**"]);
      // The non-math text renders inside cm-strong spans (bold), the math widget between them.
      const strongText = texts(view, ".cm-strong").join("");
      expect(strongText).toContain("Case 1:");
      expect(strongText).toContain(".");
      expect(texts(view, ".cm-math")).toEqual(["hk \\in H"]);
      // No literal ** remains outside the hidden-syntax spans.
      const visible = view.contentDOM.cloneNode(true) as HTMLElement;
      for (const el of visible.querySelectorAll(".cm-hidden-syntax")) el.remove();
      expect(visible.textContent ?? "").not.toContain("**");
    } finally {
      view.destroy();
    }
  });

  test("**($\\Rightarrow$)** — markers hidden, parens bold, widget present", () => {
    const view = mount("**($\\Rightarrow$)**");
    try {
      expect(texts(view, ".cm-hidden-syntax")).toEqual(["**", "**"]);
      // NB: CodeMirror nests the (replace-widget) math element INSIDE the cm-strong mark span,
      // so the strong text includes the widget's own text — assert both parens are in there.
      const strongText = texts(view, ".cm-strong").join("");
      expect(strongText.startsWith("(")).toBe(true);
      expect(strongText.endsWith(")")).toBe(true);
      expect(texts(view, ".cm-math")).toEqual(["\\Rightarrow"]);
    } finally {
      view.destroy();
    }
  });

  test("italic *…$x$…* hides the * markers and applies cm-em", () => {
    const view = mount("*italic $x$ inside*");
    try {
      expect(texts(view, ".cm-hidden-syntax")).toEqual(["*", "*"]);
      const emText = texts(view, ".cm-em").join("");
      expect(emText).toContain("italic");
      expect(emText).toContain("inside");
      expect(texts(view, ".cm-math")).toEqual(["x"]);
    } finally {
      view.destroy();
    }
  });

  test("control: **plain bold** still hides markers and bolds", () => {
    const view = mount("**plain bold**");
    try {
      expect(texts(view, ".cm-hidden-syntax")).toEqual(["**", "**"]);
      expect(texts(view, ".cm-strong").join("")).toBe("plain bold");
    } finally {
      view.destroy();
    }
  });

  test("protection: `$a *b* c$` renders as ONE math widget, no cm-em anywhere", () => {
    const view = mount("$a *b* c$");
    try {
      expect(texts(view, ".cm-math")).toEqual(["a *b* c"]);
      expect(view.dom.querySelectorAll(".cm-em").length).toBe(0);
      expect(view.dom.querySelectorAll(".cm-strong").length).toBe(0);
    } finally {
      view.destroy();
    }
  });
});
