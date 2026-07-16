// app/src/editor/memoryRefSource.test.ts
//
// Pins the `??slug` MEMORY REFERENCE contract — the 3rd-brain twin of the `[[wikilink]]` picker:
//   • typing `??` opens a memory autocomplete (the way `[[` opens the note picker)
//   • picking one inserts `??slug`, which PERSISTS in the saved markdown
//   • daemon disabled → no memory notes → no picker (and no crash)
//   • a bare `??` LINE is still the SRS multi-reversed flashcard separator: Enter there inserts a
//     NEWLINE, it does not accept a completion
//
// These run the REAL CompletionSource against a real EditorState + CompletionContext (not a
// re-implementation), so a regression in matchMemoryRefPrefix, the option assembly, or the apply
// handler fails here. The note editor and the chat composer both consume this exact source through
// `vaultCompletion()` → `markdownEditingExtensions`, so one test covers BOTH surfaces.
//
// The SRS Enter guard is proved on a MOUNTED EditorView (happy-dom), because the whole point of it
// is keymap PRECEDENCE against CodeMirror's own Enter→acceptCompletion binding — something only a
// real dispatched keydown can demonstrate.
import { GlobalWindow } from "happy-dom";
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { EditorState } from "@codemirror/state";
import { CompletionContext, type CompletionResult, startCompletion, completionStatus } from "@codemirror/autocomplete";
import { memoryRefSource, vaultCompletion } from "./autocomplete";
import type { MemoryCandidate } from "../../../core/src/memoryRef";

const MEMORIES: MemoryCandidate[] = [
  { label: "cron-run-preference", slug: "cron-run-preference" },
  { label: "push-after-commit", slug: "push-after-commit" },
  { label: "note", slug: "sub/dir/note" },
];

/** Run the memory source with the caret at the end of `doc`. The source is synchronous. */
function run(doc: string, memories: MemoryCandidate[] = MEMORIES): CompletionResult | null {
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, false);
  return memoryRefSource(() => memories)(ctx) as CompletionResult | null;
}

const labels = (r: CompletionResult | null): string[] => (r ? r.options.map((o) => String(o.label)) : []);

describe("memoryRefSource — `??` opens the memory picker", () => {
  test("a bare `??` opens the picker listing every memory note", () => {
    expect(labels(run("??"))).toEqual(["cron-run-preference", "push-after-commit", "note"]);
  });

  test("the popup is anchored just past the `??`, so the `??` itself survives the pick", () => {
    // doc "see ??" → `??` at 4..6, so the replaced range starts at 6. This is what makes the
    // saved text `??slug` rather than `slug`.
    expect(run("see ??")?.from).toBe(6);
  });

  test("fires mid-prose after whitespace", () => {
    expect(labels(run("as noted in ??cron"))).toContain("cron-run-preference");
  });

  test("does NOT fire when `??` is glued to a word — `really??` stays prose", () => {
    expect(run("really??")).toBeNull();
  });

  test("does not fire inside a code span (a `??` in code is literal)", () => {
    expect(run("`a ?? b")).toBeNull();
  });

  test("a subfoldered memory note shows its rel path as detail; a flat one shows none", () => {
    const opts = run("??")!.options;
    expect(opts.find((o) => o.label === "note")?.detail).toBe("sub/dir/note");
    expect(opts.find((o) => o.label === "cron-run-preference")?.detail).toBeUndefined();
  });
});

describe("memoryRefSource — daemon disabled", () => {
  test("no memory notes → NO picker at all (no crash, no empty popup)", () => {
    // Daemon off → the server builds no `.daemon/memory` graph nodes → App passes zero candidates.
    // `prefixSource` returns a result with an empty option list, which CM renders as no popup.
    expect(labels(run("??", []))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Mounted-view proof of the SRS flashcard guard.
// ---------------------------------------------------------------------------------------------

const win = new GlobalWindow();
const DOM_KEYS = ["document", "window", "navigator", "Node", "Element", "HTMLElement", "Text", "Range", "Event", "KeyboardEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "DOMRect"] as const;
const saved: Record<string, unknown> = {};

beforeAll(() => {
  for (const k of DOM_KEYS) {
    saved[k] = (globalThis as Record<string, unknown>)[k];
    (globalThis as Record<string, unknown>)[k] = (win as unknown as Record<string, unknown>)[k];
  }
});
afterAll(() => {
  for (const k of DOM_KEYS) (globalThis as Record<string, unknown>)[k] = saved[k];
});

describe("SRS flashcard separator survives the `??` picker", () => {
  // Lazily imported AFTER the DOM globals are installed — EditorView touches `document` at import.
  async function mount(doc: string) {
    const { EditorView } = await import("@codemirror/view");
    const { keymap } = await import("@codemirror/view");
    const { insertNewlineAndIndent } = await import("@codemirror/commands");
    const parent = win.document.createElement("div");
    win.document.body.appendChild(parent);
    const view = new EditorView({
      parent: parent as unknown as HTMLElement,
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          vaultCompletion({
            getNotes: () => [],
            getMemories: () => MEMORIES,
            getTags: () => [],
            getSchema: () => ({}),
            getIconNames: () => [],
            inFrontmatter: () => false,
            readNote: async () => "",
          }),
          // Stands in for the note editor's `enterKeymap` (the normal-precedence Enter handler the
          // guard must fall through TO).
          keymap.of([{ key: "Enter", run: insertNewlineAndIndent }]),
        ],
      }),
    });
    return view;
  }

  /** Dispatch a real Enter keydown at the contentDOM, the way CodeMirror's keymap receives it. */
  const pressEnter = (view: { contentDOM: HTMLElement }) =>
    view.contentDOM.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }) as unknown as KeyboardEvent,
    );

  /** Open the picker and BLOCK until it is really `active` AND accepting input. Two real CodeMirror
   *  timings make a naive test lie:
   *    1. the completion pass is debounced (~50ms) — press Enter while it's still `pending` and the
   *       newline falls through, so an SRS assertion would pass for the WRONG reason (the guard
   *       never even ran). Asserting `active` makes that failure mode impossible.
   *    2. `acceptCompletion` IGNORES Enter within `interactionDelay` (75ms) of the popup opening —
   *       an anti-misfire guard. Settle past it so "Enter accepts" is testable at all.
   *  Both are harness concerns only; a human is never this fast. */
  async function openPickerAndWait(view: Parameters<typeof startCompletion>[0]) {
    startCompletion(view);
    for (let i = 0; i < 100 && completionStatus(view.state) !== "active"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(completionStatus(view.state)).toBe("active");
    await new Promise((r) => setTimeout(r, 90)); // clear CM's 75ms interactionDelay
  }

  test("Enter on a bare `??` line inserts a NEWLINE — it never accepts a memory completion", async () => {
    // This is how you author an SRS multi-reversed card (core/src/srs/parser.ts matches a line whose
    // trim is exactly "??"). CM binds Enter→acceptCompletion at Prec.highest, so without the guard
    // the open picker would swallow Enter and paste a slug in place of the separator.
    const view = await mount("front\n??");
    // The picker IS open and active on the bare `??` (that's the `[[`-like behavior we want) — the
    // guard is what keeps Enter meaning "newline" anyway.
    await openPickerAndWait(view);
    pressEnter(view);
    const doc = view.state.doc.toString();
    expect(doc).toBe("front\n??\n");
    expect(doc).not.toContain("cron-run-preference");
    view.destroy();
  });

  test("Enter on a real `??query` line DOES accept the completion, inserting `??slug`", async () => {
    const view = await mount("front\n??cron");
    await openPickerAndWait(view);
    pressEnter(view);
    // The `??` is preserved (the popup replaces only the slug), so the persisted text is `??slug`.
    expect(view.state.doc.toString()).toBe("front\n??cron-run-preference");
    view.destroy();
  });
});
