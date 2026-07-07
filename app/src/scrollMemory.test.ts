// app/src/scrollMemory.test.ts
import { test, expect, beforeEach } from "bun:test";
import type { StateEffect } from "@codemirror/state";
import {
  saveScroll,
  loadScroll,
  clearScroll,
  renameScroll,
  saveScrollSnapshot,
  loadScrollSnapshot,
} from "./scrollMemory";

// A stand-in for a `view.scrollSnapshot()` effect — the store treats it opaquely, so a plain
// sentinel object is enough to assert save/load/clear/rename identity without a real CM view.
const fakeSnapshot = (tag: string): StateEffect<unknown> => ({ tag }) as unknown as StateEffect<unknown>;

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

// --- CodeMirror scroll snapshots (the source-editor restore path) -------------

test("snapshot save then load round-trips the same effect", () => {
  const snap = fakeSnapshot("a");
  saveScrollSnapshot("a.md", snap);
  expect(loadScrollSnapshot("a.md")).toBe(snap);
});

test("an unknown path loads no snapshot", () => {
  expect(loadScrollSnapshot("b.md")).toBeUndefined();
});

test("clearScroll forgets the snapshot as well as the pixel offset", () => {
  saveScroll("a.md", 42);
  saveScrollSnapshot("a.md", fakeSnapshot("a"));
  clearScroll("a.md");
  expect(loadScroll("a.md")).toBeUndefined();
  expect(loadScrollSnapshot("a.md")).toBeUndefined();
});

test("renameScroll moves the snapshot to the new path and clears the old", () => {
  const snap = fakeSnapshot("old");
  saveScrollSnapshot("old.md", snap);
  renameScroll("old.md", "new.md");
  expect(loadScrollSnapshot("old.md")).toBeUndefined();
  expect(loadScrollSnapshot("new.md")).toBe(snap);
});

test("renameScroll moves a snapshot even when no pixel offset was stored (independent maps)", () => {
  const snap = fakeSnapshot("only-snap");
  saveScrollSnapshot("old.md", snap); // no saveScroll for old.md
  renameScroll("old.md", "new.md");
  expect(loadScrollSnapshot("new.md")).toBe(snap);
  expect(loadScroll("new.md")).toBeUndefined();
});
