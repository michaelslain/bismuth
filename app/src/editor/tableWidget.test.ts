// Mounted-widget tests for the editable GFM table widget (editor/tableWidget.ts). These assert on
// the RENDERED WIDGET DOM — cell markdown in → the DOM the user actually sees out — for the bugs
// whose failure only shows up in the live widget, not in a pure model function:
//   #15  a list cell renders as a real <ul>/<ol>, incl. the DOM->source read-back path
//   #41  a #tag in a cell renders as a .cm-tag chip
//   #42  Enter is a line break except on the last row, where it grows the table
//   #43  right-click shows only the menu — it never word-selects
//   #30  a file dropped on a cell is intercepted + routed to that cell
//   #31  Cmd+F highlights matches IN the rendered table (never flips it to raw source)
//
// The widget mounts inside a REAL EditorView (so posAtDOM / commit / find all work) via a minimal
// table-only decoration extension — we can't import livePreview.ts here (it pulls in Solid .tsx that
// bun's test transform can't compile), but livePreview does nothing more than wrap this same
// TableWidget in a block-replace decoration, so this is a faithful mount.

import { GlobalWindow } from "happy-dom";
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { StateField, EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { setSearchQuery, SearchQuery } from "@codemirror/search";
import { groupTableBlocks } from "./tableModel";
import { TableWidget, tableFindHighlight, hasActiveCellEdit, cellSourceFromDom, suppressRightClickWordSelect, TABLE_FIND_MATCH_CLASS, TABLE_FIND_ACTIVE_CLASS } from "./tableWidget";
import { parseCellList } from "./cellList";
import { findExtension } from "./findPanel";
import { history, undo } from "@codemirror/commands";
import { externalReconcileSpec } from "./reconcileDispatch";

const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "Text",
  "DocumentFragment", "InputEvent", "KeyboardEvent", "MouseEvent",
  "DragEvent", "DataTransfer", "FocusEvent", "ClipboardEvent",
  "DOMParser", "XMLSerializer", "getComputedStyle", "MutationObserver", "Range", "NodeFilter",
  "HTMLDivElement", "HTMLSpanElement", "HTMLTableCellElement", "DOMRect", "ResizeObserver",
  "requestAnimationFrame", "cancelAnimationFrame", "getSelection", "Selection", "File", "Blob",
];
// happy-dom's dispatchEvent instanceof-checks against ITS OWN Event class, so events we (and the
// widget) construct must be happy-dom's — not bun's built-in Event/CustomEvent. Force the whole
// Event family from happy-dom for this file, saving + restoring the originals so we don't pollute
// other test files (the cross-file DOM-global hazard the milkdown tests document).
const EVENT_CLASSES = ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "DragEvent", "InputEvent", "ClipboardEvent"];
const installed: string[] = [];
const savedEventClasses: Record<string, unknown> = {};

beforeAll(() => {
  const win = new GlobalWindow();
  for (const key of DOM_GLOBALS) {
    if (!(key in globalThis) && key in win) {
      (globalThis as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
      installed.push(key);
    }
  }
  for (const k of EVENT_CLASSES) {
    if (k in win) {
      savedEventClasses[k] = (globalThis as Record<string, unknown>)[k];
      (globalThis as Record<string, unknown>)[k] = (win as unknown as Record<string, unknown>)[k];
    }
  }
});

afterAll(() => {
  for (const k of installed) delete (globalThis as Record<string, unknown>)[k];
  for (const k of Object.keys(savedEventClasses)) {
    if (savedEventClasses[k] === undefined) delete (globalThis as Record<string, unknown>)[k];
    else (globalThis as Record<string, unknown>)[k] = savedEventClasses[k];
  }
});

// A minimal live-preview-like extension: replace every GFM table block with the TableWidget. This
// is exactly what livePreview.ts does (a block-replace Decoration over the widget), minus the rest
// of the editor — so the widget's own DOM + event wiring is exercised for real.
function tableDecoField(): Extension {
  const build = (state: EditorState) => {
    const doc = state.doc;
    const { blocks } = groupTableBlocks(doc);
    const decos = blocks.map((b) =>
      Decoration.replace({ widget: new TableWidget(b.cells, b.aligns, "note.md"), block: true }).range(
        doc.line(b.startLine).from,
        doc.line(b.endLine).to,
      ),
    );
    return Decoration.set(decos, true);
  };
  return StateField.define({
    create: build,
    update: (v, tr) => (tr.docChanged ? build(tr.state) : v),
    provide: (f) => EditorView.decorations.from(f),
  });
}

function mount(doc: string, extra: Extension[] = []): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({ parent, state: EditorState.create({ doc, extensions: [tableDecoField(), ...extra] }) });
}

/** Build one cell's rendered DISPLAY DOM directly (no CM view needed) for pure render assertions. */
function renderCellDom(src: string): HTMLElement {
  const view = new EditorView({ state: EditorState.create({ doc: "x" }) });
  const w = new TableWidget([["H"], [src]], ["none"], null);
  const dom = w.toDOM(view);
  const cell = dom.querySelectorAll<HTMLElement>("[data-cell]")[1];
  view.destroy();
  return cell;
}

/** Place a collapsed caret at the end of a cell's contents (so keydown handlers see a caret). */
function caretAtEnd(cell: HTMLElement): void {
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// ── #15: lists inside a table cell render as a real <ul>/<ol> ──────────────────
describe("#15 lists in table cells", () => {
  test("a <br>-separated bullet cell renders as a <ul> with visible bullet markers", () => {
    const cell = renderCellDom("- milk<br>- eggs<br>- bread");
    const ul = cell.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(cell.querySelectorAll("li").length).toBe(3);
    // The bullet glyph is REAL content (a .bismuth-cell-mk span), so no cascade can strip it.
    expect(cell.querySelectorAll(".bismuth-cell-mk").length).toBe(3);
    expect(cell.textContent).toContain("•");
  });

  test("a 1.<br>2. cell renders as an <ol> with numbered markers", () => {
    const cell = renderCellDom("1. mix<br>2. bake");
    expect(cell.querySelector("ol")).not.toBeNull();
    expect(cell.querySelectorAll("li").length).toBe(2);
    expect(cell.textContent).toContain("1.");
    expect(cell.textContent).toContain("2.");
  });

  // THE reopened root cause: a contenteditable can encode in-cell line breaks as raw `\n`
  // CHARACTERS (not <br> elements). The read-back USED to collapse those to a SPACE, turning a
  // typed list "- a\n- b" into "- a - b" — which is deliberately NOT re-split (space-before-dash
  // reads as prose), so the list silently vanished. cellSourceFromDom now maps `\n` → `<br>`.
  test("a cell edited with \\n line breaks reads back as <br> source and re-renders as a list", () => {
    const view = mount("| Task | Notes |\n| ---- | ----- |\n| Shop | x |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const cell = wrap.querySelectorAll<HTMLElement>("[data-cell]")[3]; // body row, col 1
    // Simulate the browser having stored the typed list as newline-separated text (the failing shape).
    cell.dataset.editing = "1";
    cell.textContent = "- a\n- b\n- c";
    // Blur the cell → leaveEdit reads the DOM back into data-src and re-renders the display face.
    cell.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(cell.dataset.src).toBe("- a<br>- b<br>- c"); // breaks preserved, NOT collapsed to spaces
    expect(cell.querySelector("ul")).not.toBeNull(); // and it renders as the list the user typed
    expect(cell.querySelectorAll("li").length).toBe(3);
    view.destroy();
  });
});

// ── #15 (WEBKIT read-back): cellSourceFromDom normalizes EVERY engine's break shape ───────────
// The pure render path (renderInlineMarkdown → cellList) is engine-agnostic and Chrome-verified, so
// the live "lists don't render in the packaged app" failure is the WEBKIT READ-BACK: Tauri's
// WKWebView is Safari, whose contenteditable wraps each continuation line in a <div> (its default
// block) rather than emitting a direct-child <br>. The OLD read-back walked ONLY direct-child <br>
// nodes and concatenated everything else's textContent with NO separator, so a typed list came back
// glued ("- a- b- c") — re-splittable ONLY when the previous item ends in a non-space char, and LOST
// entirely for a trailing-space item or a plain two-line cell. These feed the EXACT WebKit DOM shapes
// through cellSourceFromDom and assert a clean <br>-joined source that list detection then accepts.
describe("#15 WebKit read-back: cellSourceFromDom normalizes div/p/br/\\n shapes", () => {
  // Build a <td> and populate it from a builder, so a test can assemble the precise DOM WebKit
  // produces (bare text, sibling <div>s, nested <br>, <p> wrappers, …).
  const td = (build: (cell: HTMLElement) => void): HTMLElement => {
    const cell = document.createElement("td");
    build(cell);
    return cell;
  };
  const div = (html: string): HTMLElement => { const d = document.createElement("div"); d.innerHTML = html; return d; };
  const p = (html: string): HTMLElement => { const el = document.createElement("p"); el.innerHTML = html; return el; };

  test("WebKit sibling <div> lines (the default block) → <br>-joined, renders as a list", () => {
    const cell = td((c) => { c.appendChild(div("- a")); c.appendChild(div("- b")); c.appendChild(div("- c")); });
    expect(cellSourceFromDom(cell)).toBe("- a<br>- b<br>- c");
    expect(parseCellList(cellSourceFromDom(cell))).toEqual({ ordered: false, items: ["a", "b", "c"] });
  });

  test("WebKit first-line-bare + <div> continuation lines → <br>-joined", () => {
    const cell = td((c) => { c.appendChild(document.createTextNode("- a")); c.appendChild(div("- b")); c.appendChild(div("- c")); });
    expect(cellSourceFromDom(cell)).toBe("- a<br>- b<br>- c");
  });

  test("a <br> NESTED inside a <div> is still a break (not just direct children)", () => {
    const cell = td((c) => { c.appendChild(div("- a<br>- b")); });
    expect(cellSourceFromDom(cell)).toBe("- a<br>- b");
  });

  test("<p>-wrapped lines (some engines / paste) → <br>-joined ordered list", () => {
    const cell = td((c) => { c.appendChild(p("1. mix")); c.appendChild(p("2. bake")); });
    expect(cellSourceFromDom(cell)).toBe("1. mix<br>2. bake");
    expect(parseCellList(cellSourceFromDom(cell))).toEqual({ ordered: true, items: ["mix", "bake"] });
  });

  test("raw \\n characters in one text node still map to <br> (the prior fix, kept)", () => {
    const cell = td((c) => { c.appendChild(document.createTextNode("- a\n- b\n- c")); });
    expect(cellSourceFromDom(cell)).toBe("- a<br>- b<br>- c");
  });

  test("trailing-SPACE list items survive (the case glued re-split can't recover)", () => {
    // "- item one " ends in a SPACE, so the old glued concatenation "- item one - item two" was NOT
    // re-split (space-before-dash reads as prose) and the list vanished. Block boundaries fix it.
    const cell = td((c) => { c.appendChild(div("- item one ")); c.appendChild(div("- item two")); });
    expect(parseCellList(cellSourceFromDom(cell))).toEqual({ ordered: false, items: ["item one", "item two"] });
  });

  test("a plain two-line WebKit cell keeps its break (no word-merge)", () => {
    // The most damning WebKit merge: "line one" + <div>line two</div> USED to read "line oneline two".
    const cell = td((c) => { c.appendChild(document.createTextNode("line one")); c.appendChild(div("line two")); });
    expect(cellSourceFromDom(cell)).toBe("line one<br>line two");
  });

  test("a trailing empty block (Shift+Enter at end) yields ONE trailing break, not two", () => {
    const cell = td((c) => { c.appendChild(div("a")); c.appendChild(div("<br>")); });
    expect(cellSourceFromDom(cell)).toBe("a<br>");
  });

  test("a single empty block / lone <br> reads back empty (no phantom line)", () => {
    expect(cellSourceFromDom(td((c) => c.appendChild(div("<br>"))))).toBe("");
    expect(cellSourceFromDom(td((c) => c.appendChild(document.createElement("br"))))).toBe("");
  });

  test("round-trips a clean <br> source: srcToEditHtml-shaped DOM reads back identically", () => {
    // srcToEditHtml turns "- a<br>- b<br>- c" into text/br/text/br/text direct children.
    const cell = td((c) => {
      c.appendChild(document.createTextNode("- a"));
      c.appendChild(document.createElement("br"));
      c.appendChild(document.createTextNode("- b"));
      c.appendChild(document.createElement("br"));
      c.appendChild(document.createTextNode("- c"));
    });
    expect(cellSourceFromDom(cell)).toBe("- a<br>- b<br>- c");
  });

  test("inline elements (span/b) stay on their line — a break only comes from blocks/br/\\n", () => {
    const cell = td((c) => {
      const d1 = document.createElement("div");
      d1.appendChild(document.createTextNode("- "));
      const b = document.createElement("b"); b.textContent = "bold"; d1.appendChild(b);
      d1.appendChild(document.createTextNode(" x"));
      c.appendChild(d1);
      c.appendChild(div("- next"));
    });
    // The <b>'s textContent ("bold") stays on the line; only the two <div>s create the break.
    expect(cellSourceFromDom(cell)).toBe("- bold x<br>- next");
  });

  test("end-to-end via the widget: a cell edited as sibling <div>s commits + renders as a list", () => {
    const view = mount("| Task | Notes |\n| ---- | ----- |\n| Shop | x |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const cell = wrap.querySelectorAll<HTMLElement>("[data-cell]")[3]; // body row, col 1
    cell.dataset.editing = "1";
    // Simulate WebKit's contenteditable div-per-line structure after typing a bullet list.
    cell.replaceChildren(div("- milk"), div("- eggs"), div("- bread"));
    cell.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(cell.dataset.src).toBe("- milk<br>- eggs<br>- bread");
    expect(cell.querySelector("ul")).not.toBeNull();
    expect(cell.querySelectorAll("li").length).toBe(3);
    view.destroy();
  });
});

// ── #41: #tags in a table cell render as chips ────────────────────────────────
describe("#41 tags in table cells", () => {
  test("a #tag in a cell renders as a .cm-tag chip; false-positives stay literal", () => {
    const cell = renderCellDom("plan #work and #123 not, C# no");
    const tags = cell.querySelectorAll(".cm-tag");
    expect(tags.length).toBe(1); // only #work
    expect(tags[0].textContent).toBe("#work");
    // #123 (digit-led) and C# (mid-word) are NOT tags → still literal text.
    expect(cell.textContent).toContain("#123");
    expect(cell.textContent).toContain("C#");
  });
});

// ── #42: Enter = line break, except last row grows the table ───────────────────
describe("#42 Enter behavior by row", () => {
  const DOC = "| A | B |\n| - | - |\n| r1a | r1b |\n| r2a | r2b |";

  test("Enter in a NON-last row inserts an in-cell line break (like Shift+Enter), no row jump", () => {
    const view = mount(DOC);
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const linesBefore = view.state.doc.lines;
    const midCell = wrap.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!; // first body row
    midCell.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); // enter edit mode
    caretAtEnd(midCell);
    midCell.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    // A soft break was inserted inside the cell; the table did NOT gain a row.
    expect(midCell.querySelectorAll("br").length).toBeGreaterThanOrEqual(1);
    expect(groupTableBlocks(view.state.doc).blocks[0].cells.length).toBe(3); // header + 2 body rows, unchanged
    expect(view.state.doc.lines).toBe(linesBefore);
    view.destroy();
  });

  test("Enter in the LAST row grows the table by a row", () => {
    const view = mount(DOC);
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const lastCell = wrap.querySelector<HTMLElement>('[data-cell][data-r="2"][data-c="0"]')!; // last body row
    lastCell.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    caretAtEnd(lastCell);
    lastCell.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    // Enter on the last row appends a blank body row (header + 3 body rows now).
    expect(groupTableBlocks(view.state.doc).blocks[0].cells.length).toBe(4);
    view.destroy();
  });
});

// ── #43: right-click shows only the menu, never a word-select ──────────────────
describe("#43 right-click does not word-select", () => {
  // End the right-button gesture the way a real click does, so the widget's onEnd runs finalize
  // and removes the document-level selectstart guard (no cross-test leak on the shared document).
  const endGesture = (): void => document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  test("right mousedown on a cell is prevented (suppresses native word-select) and keeps a selection", () => {
    const view = mount("| A | B |\n| - | - |\n| hello world | y |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const cell = wrap.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!;
    cell.dataset.editing = "1";
    cell.textContent = "hello world";
    // An existing selection over the whole cell must survive a right-click on it.
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(cell);
    sel?.removeAllRanges();
    sel?.addRange(r);
    const before = window.getSelection()?.toString();
    const md = new MouseEvent("mousedown", { button: 2, bubbles: true, cancelable: true });
    cell.dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true); // native word-select suppressed
    endGesture();
    expect(window.getSelection()?.toString()).toBe(before); // existing selection preserved
    view.destroy();
  });

  test("right mousedown with NO selection is still prevented (no new word gets selected)", () => {
    const view = mount("| A | B |\n| - | - |\n| hello world | y |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const cell = wrap.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!;
    window.getSelection()?.removeAllRanges();
    const md = new MouseEvent("mousedown", { button: 2, bubbles: true, cancelable: true });
    cell.dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true);
    endGesture();
    view.destroy();
  });

  // WebKit-specific proof: Safari word-selects on right-click via the `selectstart` step, ignoring
  // the mousedown default. suppressRightClickWordSelect cancels that selectstart AND restores the
  // pre-press selection. happy-dom never word-selects on its own, so we DRIVE the WebKit shape:
  // dispatch the selectstart WebKit would fire, and simulate it having word-selected anyway.
  describe("suppressRightClickWordSelect (the WebKit mechanism)", () => {
    const cellWith = (text: string): HTMLElement => {
      const c = document.createElement("td");
      c.setAttribute("contenteditable", "true");
      c.textContent = text;
      document.body.appendChild(c);
      return c;
    };
    const selectAll = (cell: HTMLElement): void => {
      const s = window.getSelection()!;
      const r = document.createRange();
      r.selectNodeContents(cell);
      s.removeAllRanges();
      s.addRange(r);
    };

    test("cancels the selectstart WebKit fires during the right-button press", () => {
      const cell = cellWith("hello world");
      window.getSelection()?.removeAllRanges();
      const finalize = suppressRightClickWordSelect(cell);
      const ss = new Event("selectstart", { bubbles: true, cancelable: true });
      document.dispatchEvent(ss);
      expect(ss.defaultPrevented).toBe(true); // WebKit's word-select is cancelled before it starts
      finalize();
    });

    test("restores an EXISTING selection if WebKit word-selected anyway (belt-and-suspenders)", () => {
      const cell = cellWith("hello world");
      selectAll(cell); // the user's existing selection at press time
      const before = window.getSelection()?.toString();
      const finalize = suppressRightClickWordSelect(cell);
      // Simulate WebKit collapsing/replacing the selection with a single word.
      const s = window.getSelection()!;
      const wordRange = document.createRange();
      wordRange.setStart(cell.firstChild!, 0);
      wordRange.setEnd(cell.firstChild!, 5); // "hello"
      s.removeAllRanges();
      s.addRange(wordRange);
      finalize();
      expect(window.getSelection()?.toString()).toBe(before); // the whole-cell selection is back
    });

    test("a right-click with NO prior selection ends with no selection (new word-select undone)", () => {
      const cell = cellWith("hello world");
      window.getSelection()?.removeAllRanges();
      const finalize = suppressRightClickWordSelect(cell);
      // WebKit word-selected "world" despite no prior selection.
      const s = window.getSelection()!;
      const wordRange = document.createRange();
      wordRange.setStart(cell.firstChild!, 6);
      wordRange.setEnd(cell.firstChild!, 11);
      s.removeAllRanges();
      s.addRange(wordRange);
      finalize();
      expect(window.getSelection()?.toString()).toBe(""); // no lingering word-select
    });

    test("finalize removes the guard — a later selectstart is NOT cancelled", () => {
      const cell = cellWith("hello world");
      const finalize = suppressRightClickWordSelect(cell);
      finalize();
      const ss = new Event("selectstart", { bubbles: true, cancelable: true });
      document.dispatchEvent(ss);
      expect(ss.defaultPrevented).toBe(false); // normal selection works again once the press ends
    });
  });
});

// ── #30: a file dropped on a cell is intercepted + routed to that cell ─────────
describe("#30 file drop into a cell", () => {
  test("dragover over a cell is prevented so the browser allows a drop", () => {
    const view = mount("| A | B |\n| - | - |\n| x | y |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const cell = wrap.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!;
    // A drag/drop event is a DragEvent (extends MouseEvent); happy-dom's dispatchEvent rejects
    // bun's built-in Event, so build it from the (installed) MouseEvent class and attach a
    // dataTransfer stub the handler reads (types/items/files).
    const ev = new MouseEvent("dragover", { bubbles: true, cancelable: true });
    (ev as unknown as { dataTransfer: unknown }).dataTransfer = { types: ["Files"], items: [{}], files: [], dropEffect: "" };
    cell.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    view.destroy();
  });

  test("dropping a File on a cell resolves that cell and forwards it to the upload flow", () => {
    const view = mount("| A | B |\n| - | - |\n| x | y |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const cell = wrap.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!;
    let detail: { target: { r: number; c: number; from: number }; files: File[] } | null = null;
    const onDrop = (e: Event): void => { detail = (e as CustomEvent).detail; };
    window.addEventListener("bismuth-table-drop", onDrop);
    const file = new File(["binary"], "cat.png", { type: "image/png" });
    const ev = new MouseEvent("drop", { bubbles: true, cancelable: true });
    (ev as unknown as { dataTransfer: unknown }).dataTransfer = { types: ["Files"], items: [{}], files: [file], dropEffect: "" };
    cell.dispatchEvent(ev);
    window.removeEventListener("bismuth-table-drop", onDrop);
    expect(ev.defaultPrevented).toBe(true); // widget claimed the drop (CM's handler is bypassed)
    expect(detail).not.toBeNull();
    expect(detail!.files.length).toBe(1);
    expect(detail!.files[0].name).toBe("cat.png");
    expect(detail!.target.r).toBe(1); // the body row it was dropped on
    expect(detail!.target.c).toBe(0);
    view.destroy();
  });
});

// ── #31: Cmd+F highlights IN the table, never flips it to source ───────────────
describe("#31 find highlights inside the rendered table", () => {
  // A prose "foo", then a table with "foo" in two cells, then more prose.
  const DOC = ["intro foo here", "| A | B |", "| - | - |", "| foo | bar |", "| baz | foo |", "tail foo"].join("\n");

  function setQuery(view: EditorView, search: string, caseSensitive = false): void {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search, caseSensitive, literal: true })) });
  }

  test("matches inside cells get a <mark>, and the table stays a rendered widget (NOT source)", () => {
    const view = mount(DOC, [findExtension(), tableFindHighlight]);
    openSearchPanel(view);
    setQuery(view, "foo");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap");
    expect(wrap).not.toBeNull(); // the table is STILL a widget — never revealed as raw markdown source
    const marks = wrap!.querySelectorAll(`mark.${TABLE_FIND_MATCH_CLASS}`);
    expect(marks.length).toBe(2); // "foo" in two cells
    for (const m of marks) expect(m.textContent).toBe("foo");
    // The cell content is rendered text, not raw pipe source.
    expect(wrap!.textContent).not.toContain("| foo |");
    view.destroy();
  });

  test("the active match (find selection inside a cell) gets the active class", () => {
    const view = mount(DOC, [findExtension(), tableFindHighlight]);
    openSearchPanel(view);
    setQuery(view, "foo");
    // Move the selection onto the "foo" in the first body cell (line 4).
    const doc = view.state.doc;
    const line4 = doc.line(4).text; // "| foo | bar |"
    const at = doc.line(4).from + line4.indexOf("foo");
    view.dispatch({ selection: { anchor: at, head: at + 3 } });
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const active = wrap.querySelectorAll(`mark.${TABLE_FIND_ACTIVE_CLASS}`);
    expect(active.length).toBe(1);
    // It's the mark in the cell the selection is inside (row 1, col 0).
    const activeCell = active[0].closest("[data-cell]") as HTMLElement;
    expect(activeCell.dataset.r).toBe("1");
    expect(activeCell.dataset.c).toBe("0");
    view.destroy();
  });

  test("closing the find bar clears every in-table highlight", () => {
    const view = mount(DOC, [findExtension(), tableFindHighlight]);
    openSearchPanel(view);
    setQuery(view, "foo");
    let wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    expect(wrap.querySelectorAll(`mark.${TABLE_FIND_MATCH_CLASS}`).length).toBeGreaterThan(0);
    // Clear the query the way closing the bar effectively does (panel gone / empty query).
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "", literal: true })) });
    wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    expect(wrap.querySelectorAll(`mark.${TABLE_FIND_MATCH_CLASS}`).length).toBe(0);
    view.destroy();
  });
});

// ── #46: hasActiveCellEdit — the guard that defers disk reconciles while a cell is being
// edited. A focused cell's keystrokes live only in its contenteditable DOM until the blur
// commit; a reconcile that intersects the table rebuilds the widget (eq() compares
// serialized source) and would destroy them.
describe("#46 hasActiveCellEdit", () => {
  const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |";

  test("false with no focus, true while a cell is focused, false again after blur", () => {
    const view = mount(TABLE);
    expect(hasActiveCellEdit(view)).toBe(false);

    const cell = view.dom.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!;
    cell.focus();
    expect(document.activeElement).toBe(cell);
    expect(hasActiveCellEdit(view)).toBe(true);

    cell.blur();
    expect(hasActiveCellEdit(view)).toBe(false);
    view.destroy();
  });

  test("false when focus is inside the view but NOT a table cell", () => {
    const view = mount(TABLE);
    const stray = document.createElement("div");
    stray.setAttribute("contenteditable", "true");
    view.dom.appendChild(stray);
    stray.focus();
    expect(hasActiveCellEdit(view)).toBe(false);
    view.destroy();
  });

  test("false when a cell of a DIFFERENT view is focused", () => {
    const a = mount(TABLE);
    const b = mount(TABLE);
    const cellB = b.dom.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!;
    cellB.focus();
    expect(hasActiveCellEdit(b)).toBe(true);
    expect(hasActiveCellEdit(a)).toBe(false);
    a.destroy();
    b.destroy();
  });
});

// ── #46: a cell commit dispatches a MINIMAL patch, so undo's blast radius is the edited
// region — external edits reconciled into OTHER rows of the same table survive a cmd+z.
// (A whole-table replace's undo inverse restored the entire pre-commit table, silently
// wiping concurrent external rows.)
describe("#46 minimal-patch commit + undo", () => {
  test("undo of a cell commit keeps an external edit to another row", () => {
    const view = mount("| a | b |\n| --- | --- |\n| one | two |\n| three | four |", [history()]);
    // Edit cell (r1,c0) width-stably ("one" -> "uno") via the DOM + focusout commit.
    const cell = view.dom.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!;
    cell.dataset.editing = "1";
    cell.textContent = "uno";
    cell.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(view.state.doc.toString()).toContain("uno");

    // An external writer edits the OTHER body row; Editor.tsx reconciles it in
    // (history-invisible, exactly like the SSE path).
    const cur = view.state.doc.toString();
    view.dispatch(externalReconcileSpec(cur, cur.replace("four", "4-EXT")));
    expect(view.state.doc.toString()).toContain("4-EXT");

    // Undo reverts ONLY the cell commit; the external row edit survives.
    undo(view);
    const doc = view.state.doc.toString();
    expect(doc).toContain("one");
    expect(doc).not.toContain("uno");
    expect(doc).toContain("4-EXT");
    view.destroy();
  });
});
