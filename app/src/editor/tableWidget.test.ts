// Mounted-widget tests for the editable GFM table widget (editor/tableWidget.ts). These assert on
// the RENDERED WIDGET DOM — cell markdown in → the DOM the user actually sees out — for the bugs
// whose failure only shows up in the live widget, not in a pure model function:
//   #15  a list cell renders as a real <ul>/<ol> through the block DISPLAY face
//   #41  a #tag in a cell renders as the reader's chip
//   #43  right-click shows only the menu — it never word-selects
//   #30  a file dropped on a cell is intercepted + routed to that cell
//   #31  Cmd+F highlights matches IN the rendered table (never flips it to raw source)
//   #59  a cursor beside a table is remapped off it + the Delete-table menu item
//   #46  hasActiveCellEdit + the minimal-patch commit that keeps undo's blast radius small
//
// The widget mounts inside a REAL EditorView (so posAtDOM / commit / find all work) via a minimal
// table-only decoration extension — we can't import livePreview.ts here (it pulls in Solid .tsx that
// bun's test transform can't compile), but livePreview does nothing more than wrap this same
// TableWidget in a block-replace decoration, so this is a faithful mount.
//
// The in-cell EDIT face (#15 per-token live preview, #49 emoji autocomplete) is a nested real
// CodeMirror editor (cellEditor.ts) that CANNOT be exercised headlessly (no layout; livePreview's
// Solid .tsx won't compile here) — it is verified in-browser. Its pure round-trip (cellBlockRender.ts
// cellSourceToBlockMarkdown ⇄ cmDocToCellSource) is covered in cellBlockRender.test.ts.

import { GlobalWindow } from "happy-dom";
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { StateField, EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { setSearchQuery, SearchQuery } from "@codemirror/search";
import { groupTableBlocks } from "./tableModel";
import { TableWidget, tableFindHighlight, tableSelectionGuard, tableMergeUndo, reshapeVisual, hasActiveCellEdit, suppressRightClickWordSelect, tableCellDropTargetAtPoint, TABLE_FIND_MATCH_CLASS, TABLE_FIND_ACTIVE_CLASS } from "./tableWidget";
import { activeTableField } from "./tableState";
import { findExtension } from "./findPanel";
import { history, undo, redo } from "@codemirror/commands";
import { externalReconcileSpec } from "./reconcileDispatch";
import { setGalleryOpen } from "../ui/gallery/galleryState";

const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "Text",
  "DocumentFragment", "InputEvent", "KeyboardEvent", "MouseEvent",
  "DragEvent", "DataTransfer", "ClipboardEvent", "FocusEvent",
  "DOMParser", "XMLSerializer", "getComputedStyle", "MutationObserver", "Range", "NodeFilter",
  "HTMLDivElement", "HTMLSpanElement", "HTMLTableCellElement", "DOMRect", "ResizeObserver",
  "requestAnimationFrame", "cancelAnimationFrame", "getSelection", "Selection", "File", "Blob",
  "localStorage",
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

// ── #62: an empty DISPLAY-face cell keeps a full-height line box (report 1) ───────────────────
// A blank / freshly-added cell block-renders to no line box and collapses to a sliver unless a
// placeholder line is reserved. The widget marks such a cell with `cm-td-empty` (a class, robust
// where `:empty` is fragile) so CSS can reserve one line in the BLUR/display state — matching a
// filled row's height. A cell with content must NOT carry the class.
describe("#62 empty display cell reserves a line box", () => {
  test("an empty cell gets the cm-td-empty class in the display face", () => {
    expect(renderCellDom("").classList.contains("cm-td-empty")).toBe(true);
  });
  test("a whitespace-only cell still gets the class (robust vs :empty)", () => {
    expect(renderCellDom("   ").classList.contains("cm-td-empty")).toBe(true);
  });
  test("a cell with text does NOT get the class", () => {
    expect(renderCellDom("hello").classList.contains("cm-td-empty")).toBe(false);
  });
  // The reservation must hold in the BLURRED/rendered face (this is what renderCellDom produces),
  // not only while focused — an empty cell injects a REAL non-breaking-space placeholder so the row
  // keeps a full line box in every engine (WebKit ignores min-height + generated content on a td).
  test("an empty cell injects a real nbsp placeholder as DOM content (WebKit-safe, blurred state)", () => {
    const cell = renderCellDom("");
    const ph = cell.querySelector(".cm-td-ph");
    expect(ph).not.toBeNull();
    expect(ph!.textContent).toBe(" "); // a genuine non-breaking space, a real line box
  });
  test("a whitespace-only cell also injects the placeholder", () => {
    expect(renderCellDom("   ").querySelector(".cm-td-ph")).not.toBeNull();
  });
  test("a filled cell has NO placeholder (its own content reserves the line)", () => {
    expect(renderCellDom("hello").querySelector(".cm-td-ph")).toBeNull();
  });
});

// ── #70b: the ∞ toggle survives a header-changing reshape ──────────────────────────────────
// The table's out-of-source visual state (∞ / widths / merges) is keyed in localStorage by
// its HEADER row. Add/remove/move a column, or rename a header cell, mints a new key — so the widget
// would rebuild under a fresh (empty) key and the ∞ toggle would silently reset. `reshapeVisual` is
// the pure migration the commit runs to carry that state onto the new key. Compact is always-on.
describe("#70b reshapeVisual carries ∞ across a header change", () => {
  test("a column-count change keeps ∞ but resets per-column widths/merges", () => {
    const old = { cols: [100, 50], rows: [], infinity: true, merges: [{ r: 1, c: 0, rowSpan: 2, colSpan: 1 }] };
    const out = reshapeVisual(old, 2, 3, null)!;
    expect(out.infinity).toBe(true);
    expect(out.cols).toEqual([]); // per-column indexing invalid after a column add → reset
    expect(out.merges).toBeUndefined();
  });
  test("a same-column-count change (header rename) keeps widths + merges too", () => {
    const old = { cols: [100, 50], rows: [], infinity: true, merges: [{ r: 1, c: 0, rowSpan: 2, colSpan: 1 }] };
    const out = reshapeVisual(old, 2, 2, null)!;
    expect(out.cols).toEqual([100, 50]);
    expect(out.merges).toEqual([{ r: 1, c: 0, rowSpan: 2, colSpan: 1 }]);
    expect(out.infinity).toBe(true);
  });
  test("nothing persisted under the old key → nothing to migrate (null)", () => {
    expect(reshapeVisual(null, 2, 3, null)).toBeNull();
  });
  test("an existing new-key visual is preserved, with ∞ overlaid from the old", () => {
    const out = reshapeVisual({ cols: [], rows: [], infinity: true }, 2, 3, { cols: [10, 20, 30], rows: [] })!;
    expect(out.cols).toEqual([10, 20, 30]); // existing new-key widths kept
    expect(out.infinity).toBe(true); // ∞ carried over from the old key
  });
});

// ── #69: reorder grips use the standard grip icon + reveal only per hovered/selected column/row ─
describe("#69 reorder grip icons + per-column/row reveal", () => {
  const gripDom = (view: EditorView) => {
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    return {
      wrap,
      cols: Array.from(wrap.querySelectorAll<HTMLElement>(".cm-col-drag")),
      rows: Array.from(wrap.querySelectorAll<HTMLElement>(".cm-row-drag")),
      cell: (r: number, c: number) => wrap.querySelector<HTMLElement>(`[data-cell][data-r="${r}"][data-c="${c}"]`)!,
    };
  };

  test("each grip renders the 6-dot grip SVG (not an ad-hoc bare div)", () => {
    const view = mount("| A | B |\n| - | - |\n| x | y |\n| p | q |");
    const { cols, rows } = gripDom(view);
    expect(cols.length).toBe(2); // one per column
    expect(rows.length).toBe(2); // one per BODY row
    expect(cols[0].querySelector("svg")).not.toBeNull();
    expect(cols[0].querySelectorAll("circle").length).toBe(6); // the 2×3 grip dots
    expect(rows[0].querySelector("svg")).not.toBeNull();
    expect(rows[0].querySelectorAll("circle").length).toBe(6);
    view.destroy();
  });

  test("no grip is revealed by default (invisible until hover / selection)", () => {
    const view = mount("| A | B |\n| - | - |\n| x | y |\n| p | q |");
    const { cols, rows } = gripDom(view);
    expect(cols.some((g) => g.classList.contains("cm-col-drag--show"))).toBe(false);
    expect(rows.some((g) => g.classList.contains("cm-row-drag--show"))).toBe(false);
    view.destroy();
  });

  test("selecting cells reveals the grips for exactly the covered column(s) and row(s)", () => {
    const view = mount("| A | B |\n| - | - |\n| x | y |\n| p | q |");
    const { cols, rows, cell } = gripDom(view);
    // Shift-click to select column 0 across both body rows (rows 1..2).
    cell(1, 0).dispatchEvent(new MouseEvent("mousedown", { button: 0, shiftKey: true, bubbles: true, cancelable: true }));
    cell(2, 0).dispatchEvent(new MouseEvent("mousedown", { button: 0, shiftKey: true, bubbles: true, cancelable: true }));
    expect(cols[0].classList.contains("cm-col-drag--show")).toBe(true); // col 0 covered
    expect(cols[1].classList.contains("cm-col-drag--show")).toBe(false); // col 1 not
    expect(rows.every((g) => g.classList.contains("cm-row-drag--show"))).toBe(true); // both body rows covered
    view.destroy();
  });
});

// ── #15: the display face renders through the FULL BLOCK engine (the "block thing") ──────────
// A cell's stored source (`<br>`-joined single line) block-renders exactly like a note body in
// reading mode: the `<br>` markers become newlines and the reader engine (bases/markdown.ts,
// breaks:true) emits REAL <ul>/<ol>/<li>/<p> — no marker-span convention, no inline-only lexer.
describe("#15 lists in table cells (block-rendered display face)", () => {
  test("a <br>-separated bullet cell renders as a real <ul><li> exactly like a note body", () => {
    const cell = renderCellDom("- milk<br>- eggs<br>- bread");
    const ul = cell.querySelector("ul");
    expect(ul).not.toBeNull();
    const items = Array.from(cell.querySelectorAll("li"));
    expect(items.length).toBe(3);
    expect(items.map((li) => li.textContent?.trim())).toEqual(["milk", "eggs", "bread"]);
  });

  test("a 1.<br>2. cell renders as a real <ol> with li items (native numbering)", () => {
    const cell = renderCellDom("1. mix<br>2. bake");
    const ol = cell.querySelector("ol");
    expect(ol).not.toBeNull();
    const items = Array.from(cell.querySelectorAll("li"));
    expect(items.length).toBe(2);
    expect(items.map((li) => li.textContent?.trim())).toEqual(["mix", "bake"]);
  });

  test("a plain two-line cell keeps its line break (breaks:true), not merged prose", () => {
    const cell = renderCellDom("line one<br>line two");
    expect(cell.querySelector("ul")).toBeNull(); // not a list
    expect(cell.innerHTML).toContain("<br"); // the soft break survives the block render
    expect(cell.textContent).toContain("line one");
    expect(cell.textContent).toContain("line two");
  });

  test("bold containing inline math renders styled in the block face (#58 via the reader)", () => {
    const cell = renderCellDom("**Case 1: $hk \\in H$.**");
    expect(cell.querySelector("strong")).not.toBeNull();
    expect(cell.querySelector(".bismuth-math")).not.toBeNull(); // the reader's math span
    expect(cell.textContent).not.toContain("**"); // markers consumed
  });
});

// ── #41: #tags in a table cell render as chips ────────────────────────────────
describe("#41 tags in table cells", () => {
  test("a #tag in a cell renders as the reader's tag chip; false-positives stay literal", () => {
    // The block display face uses the reader engine, whose tag chip is span.bismuth-tag
    // (styled in Editor.css to match the editor's .cm-tag mark).
    const cell = renderCellDom("plan #work and #123 not, C# no");
    const tags = cell.querySelectorAll(".bismuth-tag");
    expect(tags.length).toBe(1); // only #work
    expect(tags[0].textContent).toBe("#work");
    // #123 (digit-led) and C# (mid-word) are NOT tags → still literal text.
    expect(cell.textContent).toContain("#123");
    expect(cell.textContent).toContain("C#");
  });

  test("a [[wikilink]] in a cell renders as the reader's anchor chip (clickable, #33)", () => {
    const cell = renderCellDom("see [[Some Note]] here");
    const link = cell.querySelector<HTMLElement>("a.bismuth-wikilink");
    expect(link).not.toBeNull();
    expect(link!.dataset.href).toBe("Some Note.md");
    expect(link!.textContent).toBe("Some Note");
  });

  test("an image embed in a cell upgrades to a real <img> with the asset URL (#30)", () => {
    const cell = renderCellDom("![[cat.png]]");
    const img = cell.querySelector<HTMLImageElement>("img.cm-cell-embed");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src") ?? "").toContain("cat.png");
    expect(cell.querySelector(".cm-cell-embed-slot")).toBeNull(); // slot consumed
  });
});

// #42 (Enter = in-cell line break except on the last row, where it grows the table) is now driven
// by the nested in-cell editor's keymap (cellEditor.ts) over enterKeymap; the pure decision is
// unit-tested as `enterAction` in tableModel.test.ts, and the live keystroke behavior is verified
// in-browser (it can't be exercised headlessly through a real nested CodeMirror editor).

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

// #50 (clicking / Tab-navigating to a cell must not scroll the viewport to it) is preserved by
// focusing the nested editor's contentDOM with `{ preventScroll: true }` (cellEditor.ts); verified
// in-browser, since it depends on the real editor mount (loaded dynamically, unavailable headlessly).

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

  // Packaged Tauri never fires a DOM drop — the OS drop arrives as `bismuth-native-drag` with
  // client-pixel COORDINATES, so Editor.tsx routes it via tableCellDropTargetAtPoint(view, x, y).
  // Resolution is GEOMETRIC (rect containment over the wrap + cell client rects — the same
  // coordinate handling as the chat pane's working pointInDropRect hit-test), NOT
  // elementFromPoint (which the resize-overlay strips intercept and whose answers WebKit has
  // diverged on under page zoom). happy-dom lays out nothing (all rects are 0×0), so we stub
  // per-element getBoundingClientRect with an explicit geometry to pin the coordinate → cell map.
  describe("native-drop coordinate → cell routing (#30, the packaged-app path)", () => {
    type R = { left: number; top: number; right: number; bottom: number };
    const stubRect = (el: Element, r: R): void => {
      (el as unknown as { getBoundingClientRect: () => R & { width: number; height: number } }).getBoundingClientRect =
        () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top });
    };
    /** Lay out a mounted 2-col table: wrap (0,0)-(220,70); header row y 0-30, body row y 30-60;
     *  col 0 x 0-100, col 1 x 100-200 (the wrap a bit wider/taller than the cells, like the real
     *  edge-button margins). */
    const layoutTable = (view: EditorView): void => {
      const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
      stubRect(wrap, { left: 0, top: 0, right: 220, bottom: 70 });
      for (const el of Array.from(wrap.querySelectorAll<HTMLElement>("[data-cell]"))) {
        const r = Number(el.getAttribute("data-r"));
        const c = Number(el.getAttribute("data-c"));
        stubRect(el, { left: c * 100, top: r * 30, right: c * 100 + 100, bottom: r * 30 + 30 });
      }
    };

    test("coordinates inside a cell resolve to that cell's (r, c) + block range", () => {
      const view = mount("| A | B |\n| - | - |\n| x | y |");
      layoutTable(view);
      const target = tableCellDropTargetAtPoint(view, 150, 45); // inside body row, col 1
      expect(target).not.toBeNull();
      expect(target!.r).toBe(1);
      expect(target!.c).toBe(1);
      expect(Number.isInteger(target!.from)).toBe(true); // block anchor for the async insert
      const header = tableCellDropTargetAtPoint(view, 50, 15); // header row, col 0
      expect(header!.r).toBe(0);
      expect(header!.c).toBe(0);
      view.destroy();
    });

    test("a point inside the wrap but between/past cells snaps to the NEAREST cell", () => {
      const view = mount("| A | B |\n| - | - |\n| x | y |");
      layoutTable(view);
      // (150, 65): below the body row (cells end at y=60) but still inside the wrap → r1c1.
      const below = tableCellDropTargetAtPoint(view, 150, 65);
      expect(below!.r).toBe(1);
      expect(below!.c).toBe(1);
      // (210, 45): right of col 1 (cells end at x=200) but inside the wrap → r1c1.
      const right = tableCellDropTargetAtPoint(view, 210, 45);
      expect(right!.r).toBe(1);
      expect(right!.c).toBe(1);
      view.destroy();
    });

    test("coordinates outside every table wrap resolve to null (note-body fallback)", () => {
      const view = mount("| A | B |\n| - | - |\n| x | y |");
      layoutTable(view);
      expect(tableCellDropTargetAtPoint(view, 500, 500)).toBeNull();
      view.destroy();
    });

    test("only THIS view's tables are consulted (split-pane scoping; hidden 0x0 wraps skipped)", () => {
      const a = mount("| A | B |\n| - | - |\n| x | y |");
      const b = mount("| A | B |\n| - | - |\n| x | y |");
      layoutTable(b); // B's table occupies (0,0)-(220,70); A's rects stay 0×0 (hidden/unlaid)
      expect(tableCellDropTargetAtPoint(a, 50, 45)).toBeNull(); // A ignores B's geometry
      expect(tableCellDropTargetAtPoint(b, 50, 45)).not.toBeNull(); // B resolves its own cell
      a.destroy();
      b.destroy();
    });
  });
});

// ── #52: only column WIDTH is resizable — never row HEIGHT ─────────────────────
describe("#52 row height is not resizable", () => {
  test("the widget offers column-resize handles but NO row-resize handles", () => {
    const view = mount("| A | B | C |\n| - | - | - |\n| x | y | z |\n| p | q | r |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    expect(wrap.querySelectorAll(".cm-col-resize").length).toBe(3); // one per column
    expect(wrap.querySelectorAll(".cm-row-resize").length).toBe(0); // row height is auto (#52)
    view.destroy();
  });

  test("no row-resize handle even with many rows; column handles scale with columns", () => {
    const view = mount("| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n| 7 | 8 |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    expect(wrap.querySelectorAll(".cm-row-resize").length).toBe(0);
    expect(wrap.querySelectorAll(".cm-col-resize").length).toBe(2);
    view.destroy();
  });
});

// ── #62: drag-to-resize a column updates its width and persists it ─────────────
describe("#62 column resize drag updates width + persists", () => {
  const storeKey = "bismuth:table-size:note.md";
  const headerKey = JSON.stringify(["A", "B", "C"]);

  test("dragging a column resize handle writes a new width to localStorage", () => {
    const view = mount("| A | B | C |\n| - | - | - |\n| x | y | z |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const handles = Array.from(wrap.querySelectorAll<HTMLElement>(".cm-col-resize"));
    expect(handles.length).toBe(3);
    const handle = handles[1]!;

    // Start the drag on the middle-column handle. In this headless environment offsetWidth is 0,
    // so the frozen start width is the 40px minimum; dragging 60px right should yield 100px.
    handle.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true, clientX: 100 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 160 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 160 }));

    // Read through the SAME binding the widget writes (the bare `localStorage` global, see
    // saveVisual) — under full-suite cross-file DOM pollution `window.localStorage` can be a
    // DIFFERENT store than the ambient global (a leftover `window` from an earlier test file),
    // which made this exact assertion flaky in `bun test app` while passing standalone.
    const raw = localStorage.getItem(storeKey);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!);
    expect(stored[headerKey]).toBeDefined();
    expect(stored[headerKey].cols[1]).toBe(100);

    localStorage.removeItem(storeKey);
    view.destroy();
  });

  test("each resize handle contains a visible grip affordance", () => {
    const view = mount("| A | B |\n| - | - |\n| x | y |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const handles = Array.from(wrap.querySelectorAll<HTMLElement>(".cm-col-resize"));
    expect(handles.length).toBe(2);
    for (const h of handles) {
      expect(h.querySelector(".cm-col-resize-grip")).not.toBeNull();
    }
    view.destroy();
  });

  // The "resize gets stuck" fix: if the button is released where the window never sees a `mouseup`
  // (released outside the window / alt-tab / OS focus-steal — WebKit), a window `blur` must still
  // END the drag: reset the cursor, drop the drag class, and stop tracking. Without the fix the
  // cursor stayed `col-resize` forever.
  test("a window blur mid-drag releases the drag (cursor + class reset, tracking stops)", () => {
    const view = mount("| A | B | C |\n| - | - | - |\n| x | y | z |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const handle = Array.from(wrap.querySelectorAll<HTMLElement>(".cm-col-resize"))[1]!;

    handle.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true, clientX: 100 }));
    expect(handle.classList.contains("cm-col-resize--dragging")).toBe(true);
    expect(document.body.style.cursor).toBe("col-resize");
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 160 })); // width now ~100
    const midWidth = wrap.querySelector<HTMLElement>("col:nth-child(2)")?.style.width;

    // No mouseup ever arrives — only the window blur. It must run the same cleanup.
    window.dispatchEvent(new Event("blur"));
    expect(document.body.style.cursor).toBe(""); // cursor un-stuck
    expect(handle.classList.contains("cm-col-resize--dragging")).toBe(false); // drag class dropped

    // A stray move after release is ignored — the drag really ended (listeners gone).
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }));
    expect(wrap.querySelector<HTMLElement>("col:nth-child(2)")?.style.width).toBe(midWidth);

    localStorage.removeItem("bismuth:table-size:note.md");
    view.destroy();
  });
});

// ── #92: ∞-mode resize — definite table width + reorder-drag always releases ───
// The ∞ stylesheet gives the table `width: max-content`; once a resize freezes the layout to
// `table-layout: fixed`, that intrinsic keyword leaves the fixed algorithm without a definite
// width and engines fall back to content-driven column sizing — the <col> style changes but the
// RENDERED column floors at its nowrap content width, so the drag visibly sticks. The widget must
// give a frozen ∞ table a definite inline width (Σ frozen col widths), track it on every move,
// and drop it in normal mode where the squash-to-page-width stylesheet layout is correct.
describe("#92 infinity-mode resize keeps a definite table width", () => {
  const storeKey = "bismuth:table-size:note.md";
  // Bare `localStorage` — the binding the widget itself uses (see the #62 read note above).
  afterEach(() => localStorage.removeItem(storeKey));

  const toggleInfinity = (wrap: HTMLElement): void => {
    wrap
      .querySelector<HTMLElement>(".cm-table-tool-infinity")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  };
  const dragCol1 = (wrap: HTMLElement, fromX: number, toX: number): void => {
    const handle = Array.from(wrap.querySelectorAll<HTMLElement>(".cm-col-resize"))[1]!;
    handle.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true, clientX: fromX }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: toX }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: toX }));
  };

  test("∞ + drag → inline table width = Σ frozen col widths, tracking every move", () => {
    const view = mount("| A | B | C |\n| - | - | - |\n| x | y | z |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const table = wrap.querySelector<HTMLElement>("table")!;
    toggleInfinity(wrap);
    expect(wrap.classList.contains("cm-table-infinity")).toBe(true);

    const handle = Array.from(wrap.querySelectorAll<HTMLElement>(".cm-col-resize"))[1]!;
    // Freeze: headless offsetWidth is 0 → every col frozen at 0px; the dragged col starts at MIN 40.
    handle.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true, clientX: 100 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 160 })); // col1 → 100px
    expect(table.style.width).toBe("100px"); // 0 + 100 + 0
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 180 })); // col1 → 120px
    expect(table.style.width).toBe("120px"); // tracks the move
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 180 }));
    expect(table.style.width).toBe("120px"); // survives the release
    view.destroy();
  });

  test("toggling ∞ off clears the inline width (normal mode squashes); back on restores it", () => {
    const view = mount("| A | B | C |\n| - | - | - |\n| x | y | z |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const table = wrap.querySelector<HTMLElement>("table")!;
    toggleInfinity(wrap);
    dragCol1(wrap, 100, 180); // freeze + col1 = 120px
    expect(table.style.width).toBe("120px");
    toggleInfinity(wrap); // ∞ OFF → the stylesheet's page-width squash must win again
    expect(table.style.width).toBe("");
    toggleInfinity(wrap); // ∞ back ON → re-derived from the (still frozen) col widths
    expect(table.style.width).toBe("120px");
    view.destroy();
  });

  test("a rebuilt widget with persisted ∞ + widths re-establishes the definite width", () => {
    const view = mount("| A | B | C |\n| - | - | - |\n| x | y | z |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    toggleInfinity(wrap);
    dragCol1(wrap, 100, 180); // persists cols [0, 120, 0] + infinity: true
    view.destroy();
    // A fresh mount (same note path + header key) restores ∞ AND the definite width.
    const view2 = mount("| A | B | C |\n| - | - | - |\n| x | y | z |");
    const wrap2 = view2.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const table2 = wrap2.querySelector<HTMLElement>("table")!;
    expect(wrap2.classList.contains("cm-table-infinity")).toBe(true);
    expect(table2.style.width).toBe("120px");
    view2.destroy();
  });

  test("normal (non-∞) resize never touches the table's own width", () => {
    const view = mount("| A | B | C |\n| - | - | - |\n| x | y | z |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const table = wrap.querySelector<HTMLElement>("table")!;
    dragCol1(wrap, 100, 180);
    expect(table.style.tableLayout).toBe("fixed"); // frozen…
    expect(table.style.width).toBe(""); // …but the squash-to-page width is untouched
    view.destroy();
  });
});

// The reorder-grip drag (drag a column/row into a new slot) had the ORIGINAL stuck-drag bug the
// column resize was already cured of: it ended ONLY on a window `mouseup`, which WebKit never
// delivers for a button released outside the window (or an alt-tab / cancelled pointer) — leaving
// the grabbing cursor, the reordering tint, and a leaked move listener forever. Every plausible
// end event must run the one idempotent cleanup.
describe("#92 reorder drag always releases", () => {
  const grabGrip = (wrap: HTMLElement): HTMLElement => {
    const grip = Array.from(wrap.querySelectorAll<HTMLElement>(".cm-col-drag"))[0]!;
    grip.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    return grip;
  };

  test("a window blur mid-drag releases (cursor + tint reset), and idempotently", () => {
    const view = mount("| A | B | C |\n| - | - | - |\n| x | y | z |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    grabGrip(wrap);
    expect(document.body.style.cursor).toBe("grabbing");
    expect(wrap.classList.contains("cm-table-reordering")).toBe(true);
    // No mouseup ever arrives — only the window blur. It must run the same cleanup.
    window.dispatchEvent(new Event("blur"));
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(wrap.classList.contains("cm-table-reordering")).toBe(false);
    // Late end events (the trailing mouseup / a pointercancel) must no-op, not double-clean.
    window.dispatchEvent(new MouseEvent("mouseup"));
    window.dispatchEvent(new Event("pointercancel"));
    expect(document.body.style.cursor).toBe("");
    view.destroy();
  });

  test("pointercancel releases too, and a NEW drag can start after (no leaked guard)", () => {
    const view = mount("| A | B | C |\n| - | - | - |\n| x | y | z |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    grabGrip(wrap);
    window.dispatchEvent(new Event("pointercancel"));
    expect(document.body.style.cursor).toBe("");
    expect(wrap.classList.contains("cm-table-reordering")).toBe(false);
    // The guard reset — a second grab starts a fresh drag.
    grabGrip(wrap);
    expect(document.body.style.cursor).toBe("grabbing");
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(document.body.style.cursor).toBe("");
    view.destroy();
  });

  test("one physical grab firing pointerdown + compat mousedown starts ONE drag that still releases", () => {
    const view = mount("| A | B | C |\n| - | - | - |\n| x | y | z |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const grip = Array.from(wrap.querySelectorAll<HTMLElement>(".cm-col-drag"))[0]!;
    // happy-dom has no PointerEvent; the widget's pointerdown listener only reads MouseEvent fields.
    grip.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    grip.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect(document.body.style.cursor).toBe("grabbing");
    window.dispatchEvent(new Event("blur"));
    expect(document.body.style.cursor).toBe("");
    expect(wrap.classList.contains("cm-table-reordering")).toBe(false);
    view.destroy();
  });
});

// ── #53: centering is not possible — a center column renders LEFT ──────────────
describe("#53 center alignment renders as left", () => {
  test("a :-: (center) column renders left; left/right still apply", () => {
    // Columns: left (:--), center (:-:), right (--:).
    const view = mount("| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |");
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const cellAt = (r: number, c: number): HTMLElement =>
      wrap.querySelector<HTMLElement>(`[data-cell][data-r="${r}"][data-c="${c}"]`)!;
    // Header + body rows: the center column is NEVER centered (renders left = no textAlign set).
    for (const r of [0, 1]) {
      expect(cellAt(r, 0).style.textAlign).toBe("left"); // left column keeps left
      expect(cellAt(r, 1).style.textAlign).not.toBe("center"); // center column is NOT centered (#53)
      expect(cellAt(r, 1).style.textAlign).toBe(""); // …it renders as default (left)
      expect(cellAt(r, 2).style.textAlign).toBe("right"); // right column keeps right
    }
    view.destroy();
  });

  test("the center source stays parseable and round-trips (only the RENDER changes)", () => {
    // Source with a center column parses fine and re-serializes with :-: intact — we do not
    // rewrite the user's file; we only refuse to render it centered.
    const doc = "| C |\n| :-: |\n| x |";
    const { blocks } = groupTableBlocks(EditorState.create({ doc }).doc);
    expect(blocks[0].aligns).toEqual(["center"]); // still parses as center (source parseable)
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

// #49 (in-cell `:emoji:` autocomplete) is now the EXACT SAME `vaultCompletion` popup the note editor
// uses, mounted by the nested in-cell editor (cellEditor.ts) — same source, same `completionTheme`,
// full emoji library, by construction. The bespoke `CellEmojiMenu` reimplementation was deleted. The
// live popup depends on a real CodeMirror mount + layout (unavailable headlessly), so it is verified
// in-browser; its shared completion styling is already covered by the note-editor completion tests.

// ── #59: no widget-height "big cursor" beside a table + Delete table menu item ─
describe("#59 cursor guard + delete table", () => {
  const DOC = "before\n\n| a | b |\n| - | - |\n| x | y |\n\nafter";
  const blockRange = (view: EditorView): { from: number; to: number } => {
    const b = groupTableBlocks(view.state.doc).blocks[0];
    return { from: view.state.doc.line(b.startLine).from, to: view.state.doc.line(b.endLine).to };
  };

  test("a USER selection landing on the table block is remapped outside it (both directions)", () => {
    const view = mount(DOC, [activeTableField, tableSelectionGuard]);
    const { from, to } = blockRange(view);
    // Click / forward motion onto the block → lands just below it.
    view.dispatch({ selection: { anchor: from }, userEvent: "select" });
    expect(view.state.selection.main.head).toBe(to + 1);
    // Backward motion (previous head below) → lands just above it.
    view.dispatch({ selection: { anchor: to }, userEvent: "select" });
    expect(view.state.selection.main.head).toBe(from - 1);
    view.destroy();
  });

  test("a PROGRAMMATIC selection (no userEvent) is never remapped — commit()/#44 anchoring intact", () => {
    const view = mount(DOC, [activeTableField, tableSelectionGuard]);
    const { from } = blockRange(view);
    view.dispatch({ selection: { anchor: from } }); // e.g. the widget's own undo-anchor dispatch
    expect(view.state.selection.main.head).toBe(from);
    view.destroy();
  });

  test("a RANGE selection spanning the table is never altered", () => {
    const view = mount(DOC, [activeTableField, tableSelectionGuard]);
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length }, userEvent: "select" });
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(view.state.doc.length);
    view.destroy();
  });

  test("the context menu offers Delete table; selecting it removes the block in ONE undo step", () => {
    const view = mount(DOC, [history()]);
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const cell = wrap.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!;
    // Capture the menu items the widget dispatches on right-click.
    let items: { label: string; onSelect: () => void }[] = [];
    const onMenu = (e: Event): void => { items = (e as CustomEvent).detail.items; };
    window.addEventListener("bismuth-context-menu", onMenu);
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    window.removeEventListener("bismuth-context-menu", onMenu);
    const del = items.find((i) => i.label === "Delete table");
    expect(del).toBeDefined();
    del!.onSelect();
    const after = view.state.doc.toString();
    expect(after).not.toContain("| a | b |"); // whole block gone
    expect(after).not.toContain("| x | y |");
    expect(after).toContain("before");
    expect(after).toContain("after");
    // ONE undo restores the entire table.
    undo(view);
    expect(view.state.doc.toString()).toBe(DOC);
    view.destroy();
  });
});

// ── #46: hasActiveCellEdit — the guard that defers disk reconciles while a cell is being
// edited. A focused cell's keystrokes live only in its contenteditable DOM until the blur
// commit; a reconcile that intersects the table rebuilds the widget (eq() compares
// serialized source) and would destroy them.
describe("#46 hasActiveCellEdit", () => {
  const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |";

  // The real edit face is a nested editor whose contentDOM lives INSIDE the cell; hasActiveCellEdit
  // keys off `document.activeElement.closest("[data-cell]")`, so we simulate that focused child.
  const focusableChild = (cell: HTMLElement): HTMLElement => {
    const inner = document.createElement("div");
    inner.setAttribute("contenteditable", "true");
    cell.appendChild(inner);
    return inner;
  };

  test("false with no focus, true while a cell's editor is focused, false again after blur", () => {
    const view = mount(TABLE);
    expect(hasActiveCellEdit(view)).toBe(false);

    const cell = view.dom.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!;
    const inner = focusableChild(cell);
    inner.focus();
    expect(hasActiveCellEdit(view)).toBe(true); // focus is inside a [data-cell]

    inner.blur();
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
    focusableChild(cellB).focus();
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
    // Edit cell (r1,c0) width-stably ("one" -> "uno"): its source cache is what the display face
    // committed, and focus leaving the table (root focusout) commits the grid to the doc.
    const cell = view.dom.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!;
    cell.dataset.src = "uno";
    cell.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); // bubbles to root → commit
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

// ── #49: opening the `:` emoji GALLERY from inside a cell must not tear the cell editor down ──
// The gallery modal's search box grabs focus, blurring the cell's nested CodeMirror. That blur's
// `focusout` (cell-level → leaveEdit; root-level → commit) would destroy the very EditorView the
// gallery's deferred `applyInsert` targets, so the picked emoji silently no-ops (the reported bug —
// only cells break; a note body's main editor survives its own blur). The widget DEFERS both
// teardowns while `isGalleryOpen()` holds, then resumes normal teardown once the gallery settles.
describe("#49 gallery-open defers the cell blur teardown", () => {
  // Module-level flag — always reset so a failed assertion can't leak "open" into later tests.
  afterEach(() => setGalleryOpen(false));

  type CellWithCM = HTMLElement & {
    _cellCM?: { state: { doc: { toString(): string } }; contentDOM: HTMLElement; destroy(): void };
  };

  test("root commit is deferred while a gallery is open, then commits on the next real blur", () => {
    const view = mount("| a | b |\n| --- | --- |\n| one | two |", [history()]);
    const cell = view.dom.querySelector<HTMLElement>('[data-cell][data-r="1"][data-c="0"]')!;
    // The cell's in-progress source (what a blur would commit). Not editing, so the cell focusout's
    // leaveEdit early-returns — this isolates the ROOT commit path.
    cell.dataset.src = "uno";

    setGalleryOpen(true); // the emoji gallery modal grabbed focus, blurring the cell
    cell.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); // bubbles to root → commit
    expect(view.state.doc.toString()).not.toContain("uno"); // commit DEFERRED (editor kept alive)

    setGalleryOpen(false); // gallery settled (picked/dismissed) + refocused the cell
    cell.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(view.state.doc.toString()).toContain("uno"); // now it commits normally
    view.destroy();
  });

  test("the nested cell editor is NOT destroyed on the blur caused by opening a gallery", () => {
    const view = mount("| a | b |\n| --- | --- |\n| one | two |");
    const cell = view.dom.querySelector<CellWithCM>('[data-cell][data-r="1"][data-c="0"]')!;
    // Simulate an active in-cell edit whose nested CodeMirror holds the picked glyph.
    let destroyed = false;
    cell.dataset.editing = "1";
    cell._cellCM = {
      state: { doc: { toString: () => "😄" } },
      contentDOM: document.createElement("div"),
      destroy: () => { destroyed = true; },
    };

    setGalleryOpen(true);
    cell.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(cell.dataset.editing).toBe("1"); // still in edit mode — leaveEdit deferred
    expect(destroyed).toBe(false); // the EditorView the gallery insert targets is kept alive

    setGalleryOpen(false);
    cell.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(cell.dataset.editing).toBe(""); // committed + torn down once the gallery is gone
    expect(destroyed).toBe(true);
    expect(view.state.doc.toString()).toContain("😄"); // the glyph was read back + committed
    view.destroy();
  });
});

// ── #71: shift-click cell merge / unmerge is undoable via Cmd+Z (redo via Cmd+Shift+Z) ─────────
// A merge lives only in the table's out-of-source visual state (GFM has no colspan), so it was
// invisible to CodeMirror's history. `tableMergeUndo` makes each merge dispatch a no-doc-change
// effect that history records (via invertedEffects); undo/redo re-apply the opposite region set to
// the live table DOM (no widget rebuild). Driven here through the real shift-select + context-menu
// path, asserting on the rendered colspan/rowspan the user sees.
describe("#71 merge/unmerge participates in undo history", () => {
  const shiftClick = (cell: HTMLElement): void =>
    cell.dispatchEvent(new MouseEvent("mousedown", { button: 0, shiftKey: true, bubbles: true, cancelable: true }));

  test("merge a 2×2 block, Cmd+Z unmerges to the exact prior state, Cmd+Shift+Z re-merges", () => {
    const view = mount("| MH1 | MH2 |\n| --- | --- |\n| a | b |\n| c | d |", [history(), tableMergeUndo]);
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const cell = (r: number, c: number): HTMLTableCellElement =>
      wrap.querySelector<HTMLTableCellElement>(`[data-cell][data-r="${r}"][data-c="${c}"]`)!;

    // Shift-select the 2×2 body block (1,0)…(2,1) — two shift-clicks set the anchor + focus without
    // entering a cell's edit mode.
    shiftClick(cell(1, 0));
    shiftClick(cell(2, 1));

    // Right-click the anchor → grab the "Merge cells" menu item the widget offers for the selection.
    let items: { label: string; onSelect: () => void }[] = [];
    const onMenu = (e: Event): void => { items = (e as CustomEvent).detail.items; };
    window.addEventListener("bismuth-context-menu", onMenu);
    cell(1, 0).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    window.removeEventListener("bismuth-context-menu", onMenu);
    const merge = items.find((i) => i.label === "Merge cells");
    expect(merge).toBeDefined();

    merge!.onSelect();
    // The anchor now spans the block; the other three cells are hidden.
    expect(cell(1, 0).colSpan).toBe(2);
    expect(cell(1, 0).rowSpan).toBe(2);
    expect(cell(1, 0).classList.contains("cm-td-merged")).toBe(true);
    expect(cell(1, 1).style.display).toBe("none");
    expect(cell(2, 0).style.display).toBe("none");
    expect(cell(2, 1).style.display).toBe("none");

    // Cmd+Z reverts the merge exactly — every cell back to a plain 1×1, all visible.
    undo(view);
    expect(cell(1, 0).colSpan).toBe(1);
    expect(cell(1, 0).rowSpan).toBe(1);
    expect(cell(1, 0).classList.contains("cm-td-merged")).toBe(false);
    expect(cell(1, 1).style.display).toBe("");
    expect(cell(2, 1).style.display).toBe("");

    // Cmd+Shift+Z re-applies the merge.
    redo(view);
    expect(cell(1, 0).colSpan).toBe(2);
    expect(cell(1, 0).rowSpan).toBe(2);
    expect(cell(2, 1).style.display).toBe("none");
    view.destroy();
  });

  test("an unmerge is itself undoable (Cmd+Z restores the merged span)", () => {
    const view = mount("| UH1 | UH2 |\n| --- | --- |\n| a | b |\n| c | d |", [history(), tableMergeUndo]);
    const wrap = view.dom.querySelector<HTMLElement>(".cm-table-wrap")!;
    const cell = (r: number, c: number): HTMLTableCellElement =>
      wrap.querySelector<HTMLTableCellElement>(`[data-cell][data-r="${r}"][data-c="${c}"]`)!;
    const menuItem = (r: number, c: number, label: string): (() => void) | undefined => {
      let items: { label: string; onSelect: () => void }[] = [];
      const onMenu = (e: Event): void => { items = (e as CustomEvent).detail.items; };
      window.addEventListener("bismuth-context-menu", onMenu);
      cell(r, c).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      window.removeEventListener("bismuth-context-menu", onMenu);
      return items.find((i) => i.label === label)?.onSelect;
    };

    // Merge (1,0)…(1,1), then unmerge it.
    shiftClick(cell(1, 0));
    shiftClick(cell(1, 1));
    menuItem(1, 0, "Merge cells")!();
    expect(cell(1, 0).colSpan).toBe(2);
    menuItem(1, 0, "Unmerge cells")!();
    expect(cell(1, 0).colSpan).toBe(1);
    expect(cell(1, 1).style.display).toBe("");

    // Cmd+Z undoes the UNMERGE → the merged span comes back.
    undo(view);
    expect(cell(1, 0).colSpan).toBe(2);
    expect(cell(1, 1).style.display).toBe("none");
    view.destroy();
  });
});
