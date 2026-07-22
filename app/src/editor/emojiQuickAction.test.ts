// app/src/editor/emojiQuickAction.test.ts
//
// Pins the #67 PLACEMENT contract, which bounced three times on discoverability:
//   1. "not seeing any option for emoji picker"
//   2. "not even visible"
//   3. "now the emoji library is hidden under all those options. maybe we should make the emoji
//       library icon next to the context menu, to the left. so that it is always accessible"
//
// So the guard is not "the picker works" — it's WHERE the entry point lives:
//   • it rides `quickActions` (the rail drawn BESIDE the menu), never `items` (the option list);
//   • it is unconditional — no `toolbar:`/settings entry to opt in to, since the user has a
//     custom `.settings` and anything seeded into the DEFAULT one is invisible to them;
//   • a TABLE CELL carries its own `insert`, because CM's outer selection never tracks a cell
//     edit — without it the glyph lands at a stale position elsewhere in the note.
//
// The editor case runs the REAL `editorContextMenu()` extension against a real EditorView and a
// real right-click, so a regression that moves the emoji back into the list fails here.
import { GlobalWindow } from "happy-dom";
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { emojiQuickAction } from "./emojiQuickAction";
import { editorContextMenu, type EditorMenuEvent } from "./contextMenu";

const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "Text",
  "DocumentFragment", "InputEvent", "KeyboardEvent", "MouseEvent", "FocusEvent",
  "DOMParser", "XMLSerializer", "getComputedStyle", "MutationObserver", "Range", "NodeFilter",
  "HTMLDivElement", "HTMLSpanElement", "DOMRect", "ResizeObserver",
  "requestAnimationFrame", "cancelAnimationFrame", "getSelection", "Selection",
  // `Window` itself: CodeMirror's coordinate `measure()` (reached via posAtCoords, which the
  // context-menu handler calls) instanceof-checks against it. Missing → ReferenceError, not a
  // null return, so the handler dies before dispatching and the menu never opens.
  "Window",
];
// happy-dom instanceof-checks dispatched events against ITS OWN Event classes, so the whole family
// must come from happy-dom here — saved + restored so this file doesn't pollute the others.
const EVENT_CLASSES = ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "InputEvent"];
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
  for (const k of EVENT_CLASSES) (globalThis as Record<string, unknown>)[k] = savedEventClasses[k];
});

/** Capture the single `bismuth-open-emoji-library` event `run` fires. */
function captureEmojiOpen(run: () => void): { insert?: (char: string) => boolean } | undefined {
  let detail: { insert?: (char: string) => boolean } | undefined;
  const onOpen = (e: Event) => { detail = (e as CustomEvent).detail; };
  window.addEventListener("bismuth-open-emoji-library", onOpen);
  try { run(); } finally { window.removeEventListener("bismuth-open-emoji-library", onOpen); }
  return detail;
}

describe("emojiQuickAction", () => {
  test("is a Smile-icon rail action that refocuses its surface and opens the library", () => {
    let focused = 0;
    const action = emojiQuickAction({ focus: () => focused++ });

    expect(action.icon).toBe("Smile");
    expect(action.label).toBe("Emoji library");

    const detail = captureEmojiOpen(() => action.onSelect());
    // Refocus matters: the menu is a separate DOM overlay, so the click leaves focus off the editor.
    expect(focused).toBe(1);
    expect(detail).toBeDefined();
  });

  test("passes no insert for the note editor — App's default (focused editor caret) is correct there", () => {
    const detail = captureEmojiOpen(() => emojiQuickAction({ focus: () => {} }).onSelect());
    expect(detail?.insert).toBeUndefined();
  });

  test("forwards a table cell's own insert, so the glyph lands in the CELL not the note body", () => {
    const placed: string[] = [];
    const action = emojiQuickAction({ focus: () => {}, insert: (c) => { placed.push(c); return true; } });

    const detail = captureEmojiOpen(() => action.onSelect());
    expect(detail?.insert).toBeInstanceOf(Function);
    // App calls this with the picked glyph instead of insertIntoFocusedEditor.
    expect(detail?.insert?.("🚀")).toBe(true);
    expect(placed).toEqual(["🚀"]);
  });
});

describe("editorContextMenu — emoji placement (#67)", () => {
  /** Right-click the editor and return the menu event it dispatched. */
  function rightClick(doc = "hello world"): EditorMenuEvent {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [editorContextMenu()] }) });
    // `posAtCoords` maps a viewport point to a doc offset via real layout geometry, which happy-dom
    // has no concept of (CM's measure() dies on it). Stub JUST that browser call — pretend the click
    // landed on the first character; every line of the extension under test still runs for real.
    view.posAtCoords = () => 0;

    let detail: EditorMenuEvent | undefined;
    const onMenu = (e: Event) => { detail = (e as CustomEvent<EditorMenuEvent>).detail; };
    window.addEventListener("bismuth-context-menu", onMenu);
    try {
      view.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    } finally {
      window.removeEventListener("bismuth-context-menu", onMenu);
      view.destroy();
      parent.remove();
    }
    if (!detail) throw new Error("right-click dispatched no bismuth-context-menu event");
    return detail;
  }

  test("puts the emoji library on the RAIL, always — one click, no setting to opt in to", () => {
    const menu = rightClick();
    // Unconditional: a plain right-click on plain text, no diagnostics, no toolbar config.
    expect(menu.quickActions?.map((a) => a.icon)).toEqual(["Smile"]);
  });

  test("does NOT bury the emoji as a row in the option list", () => {
    const menu = rightClick();
    // The exact bounce: "hidden under all those options". Nothing emoji-ish may appear as a row.
    const labels = menu.items.map((i) => i.label);
    expect(labels.some((l) => /emoji/i.test(l))).toBe(false);
    // The clipboard rows still exist — replacing the native menu must not lose anything.
    expect(labels).toEqual(["Copy", "Cut", "Paste"]);
  });

  test("the first list row carries no leading separator once the emoji row is gone", () => {
    // `separatorBefore` was hardcoded true on Copy while the emoji row sat above it; left as-is it
    // would draw a stray rule at the very top of a diagnostic-free menu.
    expect(rightClick().items[0]?.separatorBefore).toBeFalsy();
  });
});
