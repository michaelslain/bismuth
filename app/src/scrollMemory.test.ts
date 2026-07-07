// app/src/scrollMemory.test.ts
import { test, expect, beforeEach } from "bun:test";
import { saveScroll, loadScroll, clearScroll, renameScroll } from "./scrollMemory";

// The store is a module-level singleton; clear the paths this suite touches before each
// test so ordering can't leak state between cases.
const PATHS = ["a.md", "b.md", "old.md", "new.md"];
beforeEach(() => PATHS.forEach(clearScroll));

test("save then load round-trips a positive offset", () => {
  saveScroll("a.md", 1234);
  expect(loadScroll("a.md")).toBe(1234);
});

test("an unknown path loads as undefined", () => {
  expect(loadScroll("b.md")).toBeUndefined();
});

test("0 is a meaningful offset (scrolled to top) and is stored", () => {
  saveScroll("a.md", 0);
  expect(loadScroll("a.md")).toBe(0);
});

test("negative and NaN offsets are ignored (detached scroller can report them)", () => {
  saveScroll("a.md", 500);
  saveScroll("a.md", -1);
  expect(loadScroll("a.md")).toBe(500); // unchanged
  saveScroll("a.md", NaN);
  expect(loadScroll("a.md")).toBe(500); // unchanged
  saveScroll("a.md", Infinity);
  expect(loadScroll("a.md")).toBe(500); // unchanged (not finite)
});

test("a later save overwrites the earlier offset for the same path", () => {
  saveScroll("a.md", 100);
  saveScroll("a.md", 900);
  expect(loadScroll("a.md")).toBe(900);
});

test("saves are keyed per path — one buffer never clobbers another", () => {
  saveScroll("a.md", 10);
  saveScroll("b.md", 20);
  expect(loadScroll("a.md")).toBe(10);
  expect(loadScroll("b.md")).toBe(20);
});

test("clearScroll forgets a single buffer's offset", () => {
  saveScroll("a.md", 42);
  clearScroll("a.md");
  expect(loadScroll("a.md")).toBeUndefined();
});

test("renameScroll moves an offset to the new path and clears the old", () => {
  saveScroll("old.md", 777);
  renameScroll("old.md", "new.md");
  expect(loadScroll("old.md")).toBeUndefined();
  expect(loadScroll("new.md")).toBe(777);
});

test("renameScroll is a no-op when nothing was stored for the source", () => {
  renameScroll("old.md", "new.md");
  expect(loadScroll("new.md")).toBeUndefined();
});
