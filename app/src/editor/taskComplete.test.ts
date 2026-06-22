// app/src/editor/taskComplete.test.ts
import { test, expect } from "bun:test";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { taskDescStart, classifyTaskContext, relativeDateOptions, matchTaskFields, taskSource } from "./taskComplete";

function complete(doc: string, pos: number, explicit = false) {
  const state = EditorState.create({ doc });
  return taskSource()(new CompletionContext(state, pos, explicit));
}

// ── taskDescStart ───────────────────────────────────────────────────────────
test("description starts past the checkbox", () => {
  expect(taskDescStart("- [ ] foo")).toBe(6);
});

test("indented task keeps indent in the offset", () => {
  expect(taskDescStart("  - [ ] x")).toBe(8);
});

test("`*` and `+` bullets and done boxes are tasks too", () => {
  expect(taskDescStart("* [x] y")).toBe(6);
  expect(taskDescStart("+ [/] z")).toBe(6);
});

test("non-task lines return null", () => {
  expect(taskDescStart("not a task")).toBeNull();
  expect(taskDescStart("# heading")).toBeNull();
});

// ── classifyTaskContext ─────────────────────────────────────────────────────
test("trailing word is a keyword", () => {
  expect(classifyTaskContext("- [ ] read due")).toEqual({ kind: "keyword", from: 11, query: "due" });
});

test("right after a date emoji → date context", () => {
  const before = "- [ ] task 📅 ";
  expect(classifyTaskContext(before)).toEqual({ kind: "date", from: before.length, query: "" });
});

test("partial date text after the emoji", () => {
  expect(classifyTaskContext("- [ ] task 📅 to")).toMatchObject({ kind: "date", query: "to" });
});

test("recurrence context keeps the multi-word rule query", () => {
  expect(classifyTaskContext("- [ ] task 🔁 every we")).toMatchObject({ kind: "recurrence", query: "every we" });
});

test("a trailing space (no word) → no context", () => {
  expect(classifyTaskContext("- [ ] ")).toBeNull();
});

// ── relativeDateOptions ─────────────────────────────────────────────────────
test("relative dates resolve to ISO against the given today", () => {
  const opts = relativeDateOptions("2026-06-07");
  expect(opts[0]).toEqual({ label: "today", date: "2026-06-07" });
  expect(opts.find((o) => o.label === "tomorrow")?.date).toBe("2026-06-08");
  expect(opts.find((o) => o.label === "in a week")?.date).toBe("2026-06-14");
});

// ── matchTaskFields ─────────────────────────────────────────────────────────
test("`due` matches the due-date field", () => {
  expect(matchTaskFields("due").map((f) => f.label)).toEqual(["📅  due date"]);
});

test("`high` matches both high and highest priority", () => {
  expect(matchTaskFields("high").map((f) => f.label)).toEqual(["🔺  highest priority", "⏫  high priority"]);
});

test("`pri` surfaces all five priorities", () => {
  expect(matchTaskFields("pri")).toHaveLength(5);
});

test("an unknown word matches nothing", () => {
  expect(matchTaskFields("xyzzy")).toHaveLength(0);
});

test("empty query returns the full field set", () => {
  expect(matchTaskFields("")).toHaveLength(12);
});

// ── taskSource (integration) ────────────────────────────────────────────────
test("source expands `due` into the due-date signifier", () => {
  const doc = "- [ ] read due";
  const res = complete(doc, doc.length);
  expect(res?.options.map((o) => o.label)).toEqual(["📅  due date"]);
});

test("source offers relative dates right after a 📅", () => {
  const doc = "- [ ] x 📅 ";
  const res = complete(doc, doc.length);
  expect(res?.options.map((o) => o.label)).toContain("tomorrow");
});

test("source is quiet for a single typed char (no noise)", () => {
  expect(complete("- [ ] r", 7)).toBeNull();
});

test("source is silent outside a task line", () => {
  expect(complete("plain paragraph due", 19)).toBeNull();
});

test("explicit invoke shows the full menu even with one char", () => {
  const res = complete("- [ ] d", 7, true);
  expect(res?.options.length).toBeGreaterThan(1);
});

test("Ctrl-Space on an EMPTY task line shows the full menu at the caret", () => {
  const doc = "- [ ] ";
  const res = complete(doc, doc.length, true); // explicit
  expect(res).not.toBeNull();
  expect(res?.options.length).toBeGreaterThan(1);
  expect(res?.from).toBe(doc.length); // inserts at caret, clobbers nothing
  // auto (non-explicit) stays silent on an empty task — no noise mid-typing
  expect(complete(doc, doc.length, false)).toBeNull();
});

test("Ctrl-Space after a typed word + space offers the menu at the caret", () => {
  const doc = "- [ ] buy milk ";
  const res = complete(doc, doc.length, true);
  expect(res?.options.length).toBeGreaterThan(1);
  expect(res?.from).toBe(doc.length); // after the space, doesn't replace "milk"
});

test("Ctrl-Space right after a non-signifier word inserts at the caret, not over the word", () => {
  const doc = "- [ ] read book";
  const res = complete(doc, doc.length, true); // "book" matches no signifier
  expect(res?.options.length).toBeGreaterThan(1);
  expect(res?.from).toBe(doc.length); // caret, so "book" is preserved
  // the inserted signifier gets a leading space so it doesn't fuse onto the word
  const due = res?.options.find((o) => o.label.includes("due"))!;
  expect(due).toBeTruthy();
});
