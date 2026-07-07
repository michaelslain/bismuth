// #46 regression coverage — "Changes sometimes don't save and the file autoreverts to a
// recent change but not the newest change."
//
// ROOT CAUSE (mechanism 1 of 2): the dispatches that pull DISK content into the buffer —
// the SSE reconcile of an external write and save()'s three-way-merge residue — entered
// CodeMirror's undo history like user edits. With an external writer active (a Claude
// session editing the same note), every reconcile became an undo step: cmd+z restored a
// pre-reload disk snapshot, the debounced autosave then PERSISTED that regression, and the
// file "autoreverted to a recent change but not the newest change". The fix routes every
// disk pull through externalReconcileSpec(), which marks the transaction
// `addToHistory: false` (history maps pending undo steps across it — the standard
// remote-changes contract) alongside the existing ExternalReload autosave-skip annotation.
//
// (Mechanism 2 — a focused table cell's un-committed DOM keystrokes being destroyed by a
// reconcile-triggered widget rebuild — is covered in tableWidget.test.ts via
// hasActiveCellEdit, and by the defer/blur-release wiring in Editor.tsx.)

import { GlobalWindow } from "happy-dom";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, redo, undo } from "@codemirror/commands";
import { ExternalReload, externalReconcileSpec } from "./reconcileDispatch";

// Install happy-dom globals only for this file (same pattern as undoRedoScroll.test.ts).
const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "Text",
  "DocumentFragment", "Event", "CustomEvent", "InputEvent", "KeyboardEvent", "MouseEvent",
  "DOMParser", "XMLSerializer", "getComputedStyle", "MutationObserver", "Range", "NodeFilter",
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

function mountView(doc: string, head = 0): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(head),
      extensions: [history()],
    }),
  });
}

/** Apply an external disk pull exactly the way Editor.tsx does. */
function reconcile(view: EditorView, next: string): void {
  view.dispatch(externalReconcileSpec(view.state.doc.toString(), next));
}

describe("#46 externalReconcileSpec", () => {
  test("carries the ExternalReload annotation (autosave-skip contract)", () => {
    const view = mountView("alpha");
    const tr = view.state.update(externalReconcileSpec("alpha", "alpha beta"));
    expect(tr.annotation(ExternalReload)).toBe(true);
    view.destroy();
  });

  test("undo reverts the user's edit but NOT external disk content", () => {
    const view = mountView("row one\nrow two\n", 0);
    // User types at the start (a real, history-visible edit).
    view.dispatch({
      changes: { from: 0, insert: "USER " },
      userEvent: "input.type",
    });
    // External writer appends a row; the reconcile pulls it in.
    reconcile(view, view.state.doc.toString() + "EXTERNAL row\n");
    expect(view.state.doc.toString()).toBe("USER row one\nrow two\nEXTERNAL row\n");

    undo(view);
    // The user edit is undone; the external row SURVIVES. (Pre-fix, undo restored the
    // pre-reload snapshot — wiping "EXTERNAL row" — and autosave persisted the loss.)
    expect(view.state.doc.toString()).toBe("row one\nrow two\nEXTERNAL row\n");

    redo(view);
    expect(view.state.doc.toString()).toBe("USER row one\nrow two\nEXTERNAL row\n");
    view.destroy();
  });

  test("undo is a no-op when the only changes were external reconciles", () => {
    const view = mountView("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    reconcile(view, "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n");
    reconcile(view, "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n");
    const after = view.state.doc.toString();
    undo(view); // nothing user-made to undo — must not "restore" an older disk state
    expect(view.state.doc.toString()).toBe(after);
    view.destroy();
  });

  test("interleaved user edits and reconciles: undo walks ONLY the user edits", () => {
    const view = mountView("base\n", 5);
    view.dispatch({ changes: { from: 5, insert: "first\n" }, userEvent: "input.type" });
    reconcile(view, view.state.doc.toString() + "ext-1\n");
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "second\n" },
      userEvent: "input.type",
    });
    reconcile(view, view.state.doc.toString() + "ext-2\n");
    expect(view.state.doc.toString()).toBe("base\nfirst\next-1\nsecond\next-2\n");

    undo(view); // drops "second"
    expect(view.state.doc.toString()).toBe("base\nfirst\next-1\next-2\n");
    undo(view); // drops "first"
    expect(view.state.doc.toString()).toBe("base\next-1\next-2\n");
    undo(view); // nothing user-made left — external content still intact
    expect(view.state.doc.toString()).toBe("base\next-1\next-2\n");
    view.destroy();
  });

  test("cursor position maps across an external patch instead of being clobbered", () => {
    const view = mountView("hello world", 5); // caret after "hello"
    reconcile(view, "PREFIX hello world");
    expect(view.state.doc.toString()).toBe("PREFIX hello world");
    expect(view.state.selection.main.head).toBe(12); // still after "hello"
    view.destroy();
  });
});
