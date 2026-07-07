// app/src/editor/undoRedoScroll.test.ts
// Row #44 regression coverage — "cmd+z scrolls you to the bottom of the page. and
// cmd+shift+z does not work."
//
// Mounts a REAL (happy-dom-backed) CodeMirror EditorView so these tests exercise
// CodeMirror's actual undo/redo machinery (history(), historyKeymap, real KeyboardEvent
// dispatch) rather than a hand-rolled stand-in.
//
// ROOT CAUSE (44a — undo scrolls to the doc end): a table-cell edit (tableWidget.ts's
// `commit`/`insertEmbedsInTableCell`) and an embed drag-resize commit (embedBlock.ts's
// `commitEmbedSize`) both happen inside a contenteditable DOM island that CodeMirror's own
// `state.selection` never tracks (the widget root is atomic; only its nested cells/handles
// are contenteditable). The commit dispatched only `{changes: ...}` — no explicit
// `selection` — so CodeMirror mapped whatever UNRELATED position `state.selection` last
// held (e.g. wherever the user had been typing before clicking into the table) through the
// change. That stale position got recorded as the edit's history `startSelection`, so a
// LATER undo (which always restores `startSelection` — see @codemirror/commands'
// `HistoryState.pop`) jumped the viewport back to that stale spot — commonly the very end
// of the document — instead of back to the table/embed. The fix anchors the commit's
// selection at the edit site (matching the "Edit source" pathway, which already did this).
//
// ROOT CAUSE (44b — Mod-Shift-z does nothing): CodeMirror's own historyKeymap IS correctly
// wired in Editor.tsx and no editor-level keymap/extension shadows it (verified below). The
// one real conflict found lives OUTSIDE the editor: FileTree.tsx's window-level Cmd+Z
// "restore last deleted file" listener matched on `e.key.toLowerCase() === "z"` regardless
// of `e.shiftKey`, and doesn't `stopPropagation` — so whenever the note editor isn't focused
// (e.g. right after a table-cell edit commits and blurs without refocusing it) a redo
// keystroke got silently swallowed as a (usually no-op) file-restore instead. Fixed there
// with a one-line `!e.shiftKey` guard.

import { GlobalWindow } from "happy-dom";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { defaultKeymap, historyKeymap, history, redo, undo } from "@codemirror/commands";
import { insertEmbedsInTableCell } from "./tableWidget";
import { computeSizeEdit } from "./embedSpec";

// Same pattern as app/src/blocks/milkdownSerialize.test.ts: CodeMirror's EditorView touches
// `document` to build its DOM even when never attached to a page, so install happy-dom's
// globals ONLY for this file's tests (beforeAll) and remove exactly what we added (afterAll)
// so a leaked global DOM can't affect other (intentionally headless) test files loaded in the
// same `bun test app` process.
const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "Text",
  "DocumentFragment", "Event", "CustomEvent", "InputEvent", "KeyboardEvent", "MouseEvent",
  "DOMParser", "XMLSerializer", "getComputedStyle", "MutationObserver", "Range", "NodeFilter",
  "HTMLDivElement", "HTMLSpanElement", "DOMRect",
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
  if (!("window" in globalThis)) {
    (globalThis as Record<string, unknown>).window = win;
    installed.push("window");
  }
});

afterAll(() => {
  for (const key of installed) delete (globalThis as Record<string, unknown>)[key];
  installed.length = 0;
});

// A note-shaped doc: an intro line, a 2-col GFM table, then a long tail of filler
// paragraphs — long enough that "the doc end" is unambiguously far from the table.
function longDocWithTable(): string {
  const filler = Array.from(
    { length: 40 },
    (_, i) => `Filler paragraph ${i} to push the document well below the table.`,
  );
  return ["Intro paragraph.", "", "| Name | Age |", "| --- | --- |", "| Alice | 30 |", "", ...filler].join("\n");
}

/** Mount a bare EditorView with just history() + a keymap — enough to drive undo/redo
 *  without any of Editor.tsx's autosave/reconcile machinery muddying the assertions. */
function mountView(doc: string, selectionHead: number): EditorView {
  let view!: EditorView;
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(selectionHead),
      extensions: [history(), keymap.of([...defaultKeymap, ...historyKeymap])],
    }),
  });
  return view;
}

describe("#44a — table-cell edits anchor the selection at the table, not wherever it was", () => {
  test("insertEmbedsInTableCell moves the selection to the table instead of inheriting a stale position", () => {
    const doc = longDocWithTable();
    const tableFrom = doc.indexOf("| Name");
    // The cursor is at the very end of the document — the common real flow: the user was last
    // typing prose at the bottom, then clicked DIRECTLY into a table cell (a contenteditable
    // island CodeMirror's own selection never tracks) to fix it, so `state.selection` never
    // moved off the end.
    const view = mountView(doc, doc.length);
    expect(view.state.selection.main.head).toBe(doc.length);

    const ok = insertEmbedsInTableCell(view, tableFrom + 2, 1, 1, ["✓"]);
    expect(ok).toBe(true);

    const newTableFrom = view.state.doc.toString().indexOf("| Name");
    expect(view.state.selection.main.head).toBe(newTableFrom);
    expect(view.state.selection.main.head).toBeLessThan(view.state.doc.length - 200);
  });

  test("undo after the commit restores the selection AT the table (not the doc end) and requests scrollIntoView", () => {
    const doc = longDocWithTable();
    const tableFrom = doc.indexOf("| Name");

    // Build the view with a capturing `dispatch` from the start (rather than reassigning
    // `view.dispatch` after construction) so we record every transaction, including the setup
    // edit and the undo that follows it.
    const transactions: import("@codemirror/state").Transaction[] = [];
    let view!: EditorView;
    view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [history(), keymap.of([...defaultKeymap, ...historyKeymap])],
      }),
      dispatch: (tr) => {
        transactions.push(tr);
        view.update([tr]);
      },
    });

    insertEmbedsInTableCell(view, tableFrom + 2, 1, 1, ["✓"]);
    expect(view.state.doc.toString()).not.toBe(doc); // the edit landed

    const undone = undo(view);
    expect(undone).toBe(true);
    expect(view.state.doc.toString()).toBe(doc); // content fully reverted

    const lastTr = transactions[transactions.length - 1];
    expect(lastTr?.scrollIntoView).toBe(true); // CM's historyKeymap always requests this...
    // ...but WHERE it scrolls to is what actually matters: before the fix this was
    // `doc.length` (the stale pre-commit selection) — the very bottom of the document.
    expect(view.state.selection.main.head).toBe(tableFrom);
    expect(view.state.selection.main.head).not.toBe(doc.length);
  });
});

describe("#44a — the same fix for an embed drag-resize commit (embedBlock.ts's commitEmbedSize)", () => {
  test("anchoring the commit's selection at the edit (not the stale doc-end selection) makes undo land there", () => {
    const lines = [
      "Some intro text.",
      "",
      "![[photo.png|200]]",
      "",
      ...Array.from({ length: 40 }, (_, i) => `Filler line ${i}.`),
    ];
    const doc = lines.join("\n");
    const embedPos = doc.indexOf("![[photo.png");
    const view = mountView(doc, doc.length);

    const line = view.state.doc.lineAt(embedPos);
    const edit = computeSizeEdit(line.text, line.from, embedPos, "300");
    expect(edit).toBeTruthy();
    if (!edit) return;
    expect(view.state.sliceDoc(edit.from, edit.to)).not.toBe(edit.insert);

    // Mirrors embedBlock.ts's commitEmbedSize post-fix: move CM's OWN selection to the edit
    // FIRST (a separate dispatch — CM's history() keys an edit's undo-position off the
    // selection as it was BEFORE that edit's own transaction, so a same-transaction
    // `selection:` can't fix this retroactively), then apply the change.
    view.dispatch({ selection: { anchor: edit.from } });
    view.dispatch({ changes: edit });
    expect(view.state.doc.toString()).toContain("![[photo.png|300]]");

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.main.head).toBe(edit.from);
    expect(view.state.selection.main.head).not.toBe(doc.length);
  });
});

describe("#44b — Mod-Shift-z (redo) re-applies the undone change", () => {
  test("redo() re-applies a plain edit after undo", () => {
    const doc = "hello world";
    const view = mountView(doc, 0);
    view.dispatch({ changes: { from: 5, insert: "," } });
    expect(view.state.doc.toString()).toBe("hello, world");

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);

    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello, world");
  });

  test("a real Mod-Shift-z KeyboardEvent resolves to redo through Editor.tsx's EXACT combined keymap", () => {
    // Reproduces the precise array shape Editor.tsx's `base` extensions build (Ctrl-Space / Tab
    // (x2) / closeBracketsKeymap / markdownKeymap / defaultKeymap / historyKeymap, all in ONE
    // `keymap.of([...])` call) so a binding earlier in that SAME array can't silently shadow
    // Mod-Shift-z before historyKeymap's redo binding is reached.
    const doc = "hello world";
    let view!: EditorView;
    view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(0),
        extensions: [
          history(),
          closeBrackets(),
          keymap.of([
            { key: "Ctrl-Space", run: () => true },
            ...closeBracketsKeymap,
            ...markdownKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
        ],
      }),
    });

    view.dispatch({ changes: { from: 5, insert: "," } });
    expect(view.state.doc.toString()).toBe("hello, world");

    const undoEvent = new KeyboardEvent("keydown", {
      key: "z", code: "KeyZ", keyCode: 90, which: 90,
      metaKey: true, ctrlKey: false, shiftKey: false, bubbles: true, cancelable: true,
    });
    view.contentDOM.dispatchEvent(undoEvent);
    expect(view.state.doc.toString()).toBe(doc);
    expect(undoEvent.defaultPrevented).toBe(true);

    // Shift+Z produces the UPPERCASE character on a real keyboard (event.key === "Z"); this is
    // exactly the case CodeMirror's own keymap resolver has a fallback for (matching the
    // physical key's un-shifted base name + a separate shiftKey check) — confirm it still
    // resolves to redo in OUR combined keymap array, not a no-op.
    const redoEvent = new KeyboardEvent("keydown", {
      key: "Z", code: "KeyZ", keyCode: 90, which: 90,
      metaKey: true, ctrlKey: false, shiftKey: true, bubbles: true, cancelable: true,
    });
    view.contentDOM.dispatchEvent(redoEvent);
    expect(view.state.doc.toString()).toBe("hello, world");
    expect(redoEvent.defaultPrevented).toBe(true);
  });
});
