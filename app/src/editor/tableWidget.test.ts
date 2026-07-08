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
import { TableWidget, tableFindHighlight, tableSelectionGuard, hasActiveCellEdit, suppressRightClickWordSelect, tableCellDropTargetAtPoint, TABLE_FIND_MATCH_CLASS, TABLE_FIND_ACTIVE_CLASS } from "./tableWidget";
import { activeTableField } from "./tableState";
import { findExtension } from "./findPanel";
import { history, undo } from "@codemirror/commands";
import { externalReconcileSpec } from "./reconcileDispatch";
import { setGalleryOpen } from "../ui/gallery/galleryState";

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
