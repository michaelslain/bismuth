// app/src/editor/wrapCellSelection.test.ts
// Row #45 regression coverage — "Highlighting text and then typing backtick does not
// surround the word in backtick" — for the table-cell path specifically.
//
// ROOT CAUSE: a rendered table's cells are plain `contenteditable` DOM elements (see
// tableWidget.ts's header comment: "The widget root is contenteditable=false so CodeMirror
// treats it as atomic... while ignoreEvent() keeps CM from acting on clicks/keys inside it").
// The main editor's backtick/asterisk/etc. "wrap the selection instead of replacing it"
// behavior is a CodeMirror `EditorView.inputHandler` (editor/wrapSelection.ts) — which never
// runs for a cell, since cells sit entirely outside CodeMirror's own input pipeline. Typing a
// wrap character over a selected word inside a cell fell through to the browser's native
// contenteditable behavior, which just REPLACES the selection with the typed character (as
// verified live: selecting "Alice" and typing backtick left the cell containing only "`").
//
// FIX: `wrapCellSelectionOnType` (tableWidget.ts) reimplements the same behavior directly over
// the DOM Selection/Range for a cell's keydown handler, gated by the same
// `settings.editor.wrapSelectionChars` the main editor's wrapSelection extension reads.

import { GlobalWindow } from "happy-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { wrapCellSelectionOnType } from "./tableWidget";
import { resetSettings, settings } from "../settings";

// Same pattern as app/src/blocks/milkdownSerialize.test.ts: install happy-dom's globals only
// for this file's tests, and remove exactly what we added afterward, so a leaked global DOM
// can't affect other (intentionally headless) test files loaded in the same `bun test app`
// process.
const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "Text",
  "DocumentFragment", "Range", "Selection", "getComputedStyle", "MutationObserver", "NodeFilter",
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
  resetSettings(); // undo the "wrapSelection: off" test's mutation of the shared settings store
});

beforeEach(() => {
  resetSettings(); // guarantee the default wrapSelection/wrapSelectionChars regardless of test order
});

/** Build a `<td>` holding `text`, select `[from, to)` of it (byte offsets into the plain text
 *  node), and return the cell. Mirrors what a real double-click/drag word-selection leaves
 *  behind: a non-collapsed Selection whose range sits inside the cell. */
function cellWithSelection(text: string, from: number, to: number): HTMLElement {
  const cell = document.createElement("td");
  const node = document.createTextNode(text);
  cell.appendChild(node);
  document.body.appendChild(cell);
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return cell;
}

describe("wrapCellSelectionOnType", () => {
  test("wraps a selected word in backticks instead of replacing it", () => {
    const cell = cellWithSelection("Alice", 0, 5);
    const handled = wrapCellSelectionOnType(cell, "`");
    expect(handled).toBe(true);
    expect(cell.textContent).toBe("`Alice`");
  });

  test("keeps the selection on the inner text so a second press nests it", () => {
    const cell = cellWithSelection("Alice", 0, 5);
    wrapCellSelectionOnType(cell, "`");
    const sel = window.getSelection();
    expect(sel?.toString()).toBe("Alice");
    // A second press should nest: ``Alice``.
    const again = wrapCellSelectionOnType(cell, "`");
    expect(again).toBe(true);
    expect(cell.textContent).toBe("``Alice``");
  });

  test("wraps a mid-word selection without touching the rest of the cell", () => {
    const cell = cellWithSelection("the cat sat", 4, 7); // "cat"
    const handled = wrapCellSelectionOnType(cell, "*");
    expect(handled).toBe(true);
    expect(cell.textContent).toBe("the *cat* sat");
  });

  test("asymmetric pairs use the matching closer", () => {
    const cell = cellWithSelection("note", 0, 4);
    wrapCellSelectionOnType(cell, "<"); // not in the default set, but exercises closerFor
    // "<" isn't a default wrapSelectionChars entry, so this should NOT have handled it.
    expect(cell.textContent).toBe("note");
  });

  test("a collapsed (empty) selection does not wrap — falls through to native typing", () => {
    const cell = cellWithSelection("Alice", 2, 2);
    const handled = wrapCellSelectionOnType(cell, "`");
    expect(handled).toBe(false);
    expect(cell.textContent).toBe("Alice"); // untouched — caller lets the browser type normally
  });

  test("a key outside settings.editor.wrapSelectionChars falls through", () => {
    const cell = cellWithSelection("Alice", 0, 5);
    const handled = wrapCellSelectionOnType(cell, "a");
    expect(handled).toBe(false);
    expect(cell.textContent).toBe("Alice");
  });

  test("multi-character input (paste/IME) is ignored", () => {
    const cell = cellWithSelection("Alice", 0, 5);
    const handled = wrapCellSelectionOnType(cell, "``");
    expect(handled).toBe(false);
    expect(cell.textContent).toBe("Alice");
  });

  test("respects settings.editor.wrapSelection: off", () => {
    settings.editor.wrapSelection = false;
    const cell = cellWithSelection("Alice", 0, 5);
    const handled = wrapCellSelectionOnType(cell, "`");
    expect(handled).toBe(false);
    expect(cell.textContent).toBe("Alice");
  });

  test("a selection outside the cell is ignored", () => {
    const cell = document.createElement("td");
    cell.textContent = "Alice";
    document.body.appendChild(cell);
    const other = document.createElement("div");
    const node = document.createTextNode("hello");
    other.appendChild(node);
    document.body.appendChild(other);
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 5);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const handled = wrapCellSelectionOnType(cell, "`");
    expect(handled).toBe(false);
    expect(cell.textContent).toBe("Alice");
  });
});
