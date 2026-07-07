// app/src/editor/saveReconcile.test.ts
import { test, expect } from "bun:test";
import { threeWayMerge } from "./saveReconcile";

test("neither side changed: returns local as-is", () => {
  const base = "hello world";
  expect(threeWayMerge(base, base, base)).toEqual({ text: "hello world", conflict: false });
});

test("only local changed (normal single-writer save): local wins", () => {
  const base = "hello world";
  const local = "hello brave world";
  expect(threeWayMerge(base, local, base)).toEqual({ text: local, conflict: false });
});

// The live-evidence scenario: the buffer has no real local edits (e.g. the user is idle, or a
// content-neutral dispatch spuriously marked it dirty), and an external process edited the file.
// The external edit must survive the subsequent autosave instead of being clobbered.
test("only disk changed (idle buffer, pure external edit): disk wins, external edit preserved", () => {
  const base = "# Bismuth Changes\n\nfix the widget\n";
  const disk = "# Bismuth Changes\n\nfix the wodget\n"; // external one-word typo fix
  expect(threeWayMerge(base, base, disk)).toEqual({ text: disk, conflict: false });
});

test("both sides converged on the identical text: no conflict", () => {
  const base = "a";
  const same = "a b";
  expect(threeWayMerge(base, same, same)).toEqual({ text: same, conflict: false });
});

test("disjoint edits (local edits row A, external edits row C of a table) merge cleanly", () => {
  const base = "AAAA BBBB CCCC";
  const local = "XXXX BBBB CCCC"; // user rewrote the first word
  const disk = "AAAA BBBB YYYY"; // external process rewrote the last word
  const result = threeWayMerge(base, local, disk);
  expect(result).toEqual({ text: "XXXX BBBB YYYY", conflict: false });
});

test("disjoint edits, external edit textually precedes the local edit", () => {
  const base = "AAAA BBBB CCCC";
  const local = "AAAA BBBB XXXX"; // user rewrote the last word
  const disk = "YYYY BBBB CCCC"; // external process rewrote the first word
  const result = threeWayMerge(base, local, disk);
  expect(result).toEqual({ text: "YYYY BBBB XXXX", conflict: false });
});

// The reverse direction from the bug report: the user's own newest keystrokes must never be
// silently reverted to an older state just because disk also changed in the same spot.
test("overlapping edits to the same span: local keystrokes are preserved and conflict is flagged", () => {
  const base = "the widget is broken";
  const local = "the widget is fixed now"; // user's fresh edit to the same tail
  const disk = "the widget is FIXED"; // an external writer touched the exact same span
  const result = threeWayMerge(base, local, disk);
  expect(result.text).toBe(local); // never reverts the user's in-progress edit
  expect(result.conflict).toBe(true); // but the caller must be told, not stay silent
});

test("realistic GFM table: local edits one row, external process fixes a typo in another row", () => {
  const base = [
    "| Task | Status |",
    "| --- | --- |",
    "| Ship the widget | todo |",
    "| Fix the wdiget bug | todo |",
  ].join("\n");
  const local = base.replace("Ship the widget", "Ship the gadget"); // user edits row 1
  const disk = base.replace("wdiget", "widget"); // external CLI fixes the typo in row 2
  const result = threeWayMerge(base, local, disk);
  expect(result.conflict).toBe(false);
  expect(result.text).toContain("Ship the gadget"); // local edit preserved
  expect(result.text).toContain("Fix the widget bug"); // external typo fix preserved
});
