// app/src/editor/slashComplete.test.ts
// Integration tests: drive the real slash CompletionSource against a constructed
// EditorState (no browser), mirroring queryComplete.test.ts / taskComplete.test.ts.
import { test, expect } from "bun:test";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { slashSource } from "./slashComplete";

const NOT_FM = () => false; // inFrontmatter predicate: body, not frontmatter

function run(doc: string, pos: number, inFrontmatter = NOT_FM, explicit = false) {
  const state = EditorState.create({ doc });
  return slashSource(inFrontmatter)(new CompletionContext(state, pos, explicit));
}

test("offers insertions on a lone `/` at line start", () => {
  const res = run("/", 1);
  expect(res).not.toBeNull();
  expect(res!.from).toBe(0);
  expect(res!.filter).toBe(false);
  const labels = res!.options.map((o) => o.label);
  expect(labels).toContain("Heading 1");
  expect(labels).toContain("Table");
  expect(labels).toContain("Query block");
});

test("narrows to the typed query", () => {
  expect(run("/tab", 4)!.options[0].label).toBe("Table");
});

test("does not fire mid-line", () => {
  expect(run("hello /x", 8)).toBeNull();
});

test("does not fire inside frontmatter", () => {
  expect(run("/", 1, () => true)).toBeNull();
});

test("does not fire inside a code fence", () => {
  // doc "```\n/h\n```" — caret at end of the `/h` body line.
  expect(run("```\n/h\n```", 6)).toBeNull();
});

test("Properties is offered on line 1 but not on a later line", () => {
  expect(run("/prop", 5)!.options.map((o) => o.label)).toContain("Properties");
  const doc = "x\ny\n/prop";
  expect(run(doc, doc.length)!.options.map((o) => o.label)).not.toContain("Properties");
});

test("Properties is NOT offered when frontmatter already exists below (no double block)", () => {
  // The corruption repro: blank line 1 above existing frontmatter, user types `/` (empty
  // query so the rest of the menu is visible and we can see Properties is the only omission).
  const labels = run("/\n---\ntags: a\n---\n", 1)!.options.map((o) => o.label);
  expect(labels).not.toContain("Properties");
  expect(labels).toContain("Heading 1"); // menu still works, just without Properties
});

test("Properties is NOT offered when the slash is after a list marker on line 1", () => {
  // `- /` on line 1 — frontmatter must be at column 0, so Properties must not appear.
  const labels = run("- /", 3)!.options.map((o) => o.label);
  expect(labels).not.toContain("Properties");
  expect(labels).toContain("Bullet list");
});

test("today's date is offered as a dynamic item", () => {
  expect(run("/date", 5)!.options.map((o) => o.label)).toContain("Today's date");
});

test("apply inserts the snippet text and places the caret at $0", () => {
  const h1 = run("/", 1)!.options.find((o) => o.label === "Heading 1")!;
  let tr: { changes?: unknown; selection?: unknown } | null = null;
  const fakeView = { dispatch: (t: unknown) => { tr = t as typeof tr; } };
  (h1.apply as (v: unknown, c: unknown, f: number, t: number) => void)(fakeView, h1, 0, 1);
  expect(tr!.changes).toEqual({ from: 0, to: 1, insert: "# " });
  expect(tr!.selection).toEqual({ anchor: 2 });
});

test("apply for a re-trigger item inserts the [[]] skeleton with caret inside", () => {
  const link = run("/", 1)!.options.find((o) => o.label === "Link to note")!;
  const calls: Array<{ changes?: unknown; selection?: unknown }> = [];
  // startCompletion (fired because reTrigger) may need a real view; the insert dispatch
  // happens first, so capture it before any throw.
  const fakeView = { dispatch: (t: unknown) => { calls.push(t as { changes?: unknown }); } };
  try {
    (link.apply as (v: unknown, c: unknown, f: number, t: number) => void)(fakeView, link, 0, 1);
  } catch { /* startCompletion on a fake view — irrelevant to the insert assertion */ }
  expect(calls[0].changes).toEqual({ from: 0, to: 1, insert: "[[]]" });
  expect(calls[0].selection).toEqual({ anchor: 2 });
});
