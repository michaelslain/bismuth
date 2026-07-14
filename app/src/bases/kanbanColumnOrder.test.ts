import { describe, expect, test } from "bun:test";
import { columnDropIndex, reorderColumnKeys } from "./kanbanColumnOrder";

const KEYS = ["todo", "doing", "done"];

describe("columnDropIndex", () => {
  test("drop on the LEFT half of a column → insert before it (among the others)", () => {
    // Dragging "done" over the left half of "todo" → index 0 of others [todo, doing].
    expect(columnDropIndex(KEYS, "done", "todo", false)).toBe(0);
  });

  test("drop on the RIGHT half of a column → insert after it (among the others)", () => {
    // Dragging "done" over the right half of "todo" → after todo → index 1 of [todo, doing].
    expect(columnDropIndex(KEYS, "done", "todo", true)).toBe(1);
  });

  test("drop on the right half of the LAST other column → trailing index", () => {
    // Dragging "todo" over the right half of "done" → past the end of others [doing, done].
    expect(columnDropIndex(KEYS, "todo", "done", true)).toBe(2);
  });

  test("drop on the left half of the LAST other column → just before it", () => {
    expect(columnDropIndex(KEYS, "todo", "done", false)).toBe(1);
  });

  test("hovering the dragged column itself → keep at its current (clamped) position", () => {
    // "doing" is at index 1 of KEYS; among others [todo, done] that clamps to 1 → no-op slot.
    expect(columnDropIndex(KEYS, "doing", "doing", false)).toBe(1);
    expect(columnDropIndex(KEYS, "doing", "doing", true)).toBe(1);
  });

  test("cursor off any column (over=null) → keep at its current clamped position", () => {
    expect(columnDropIndex(KEYS, "todo", null, false)).toBe(0);
    expect(columnDropIndex(KEYS, "done", null, true)).toBe(2);
  });

  test("clamps the no-op position into the others range for the last column", () => {
    // "done" is index 2 in KEYS; others [todo, doing] has length 2, so it clamps to 2 (the end).
    expect(columnDropIndex(KEYS, "done", "done", false)).toBe(2);
  });

  test("unknown hovered key → append to the end", () => {
    expect(columnDropIndex(KEYS, "todo", "ghost", false)).toBe(2);
  });

  test("empty-string column key is a valid target (the '(empty)' column)", () => {
    const keys = ["", "a", "b"];
    // Dragging "b" onto the right half of the "" column → after it → index 1 of others ["", "a"].
    expect(columnDropIndex(keys, "b", "", true)).toBe(1);
    // Left half → before it → index 0.
    expect(columnDropIndex(keys, "b", "", false)).toBe(0);
  });
});

describe("reorderColumnKeys", () => {
  test("moves a column to the front", () => {
    expect(reorderColumnKeys(KEYS, "done", "todo", false)).toEqual(["done", "todo", "doing"]);
  });

  test("moves a column to the end", () => {
    expect(reorderColumnKeys(KEYS, "todo", "done", true)).toEqual(["doing", "done", "todo"]);
  });

  test("moves a column into the middle (after the first)", () => {
    expect(reorderColumnKeys(KEYS, "done", "todo", true)).toEqual(["todo", "done", "doing"]);
  });

  test("preserves the other columns' relative order", () => {
    const keys = ["a", "b", "c", "d"];
    expect(reorderColumnKeys(keys, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
  });

  test("a no-op drop (hovering itself) leaves the order unchanged", () => {
    expect(reorderColumnKeys(KEYS, "doing", "doing", false)).toEqual(KEYS);
  });

  test("a no-op drop (over=null) leaves the order unchanged", () => {
    expect(reorderColumnKeys(KEYS, "doing", null, true)).toEqual(KEYS);
    expect(reorderColumnKeys(KEYS, "todo", null, false)).toEqual(KEYS);
    expect(reorderColumnKeys(KEYS, "done", null, true)).toEqual(KEYS);
  });

  test("dropping a column back onto its own right edge is a no-op", () => {
    // Dragging "todo" onto the right half of the column now at its right (its neighbour) — but
    // hovering itself is the true no-op; this checks re-inserting yields a valid permutation.
    const out = reorderColumnKeys(KEYS, "todo", "doing", false);
    expect(out).toEqual(["todo", "doing", "done"]);
    expect([...out].sort()).toEqual([...KEYS].sort());
  });

  test("output is always a permutation of the input keys", () => {
    for (const from of KEYS) {
      for (const over of [...KEYS, null]) {
        for (const after of [true, false]) {
          const out = reorderColumnKeys(KEYS, from, over, after);
          expect([...out].sort()).toEqual([...KEYS].sort());
        }
      }
    }
  });
});
