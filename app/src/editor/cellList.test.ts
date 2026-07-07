// app/src/editor/cellList.test.ts
import { test, expect } from "bun:test";
import { parseCellList, renderCellListHtml } from "./cellList";

// An identity item-renderer so tests assert the structure, not an inline-markdown engine.
const raw = (s: string): string => s;

test("parseCellList detects a <br>-separated unordered list (- and *)", () => {
  expect(parseCellList("- a<br>- b<br>- c")).toEqual({ ordered: false, items: ["a", "b", "c"] });
  expect(parseCellList("* one<br>* two")).toEqual({ ordered: false, items: ["one", "two"] });
});

test("parseCellList detects an ordered list (1. and 2))", () => {
  expect(parseCellList("1. a<br>2. b")).toEqual({ ordered: true, items: ["a", "b"] });
  expect(parseCellList("1) a<br>2) b<br>3) c")).toEqual({ ordered: true, items: ["a", "b", "c"] });
});

test("parseCellList accepts <br/> and <br /> and is case-insensitive", () => {
  expect(parseCellList("- a<br/>- b")).toEqual({ ordered: false, items: ["a", "b"] });
  expect(parseCellList("- a<BR />- b")).toEqual({ ordered: false, items: ["a", "b"] });
});

test("parseCellList returns null when not every segment is a marker (mixed / plain)", () => {
  expect(parseCellList("- a<br>plain")).toBeNull();
  expect(parseCellList("line1<br>line2")).toBeNull(); // plain two-line cell, no markers
  expect(parseCellList("- a<br>1. b")).toBeNull(); // mixed unordered + ordered
});

test("parseCellList needs a <br> and ≥2 items (a single line is never a list)", () => {
  expect(parseCellList("- just one")).toBeNull();
  expect(parseCellList("plain text")).toBeNull();
  expect(parseCellList("")).toBeNull();
});

test("parseCellList does not treat emphasis / negatives as bullets (marker needs a space)", () => {
  expect(parseCellList("*bold*<br>*more*")).toBeNull(); // `*x` has no space → emphasis, not a bullet
  expect(parseCellList("-5<br>-6")).toBeNull(); // negatives, not bullets
});

test("parseCellList ignores blank segments (trailing / doubled <br>)", () => {
  expect(parseCellList("- a<br>- b<br>")).toEqual({ ordered: false, items: ["a", "b"] });
  expect(parseCellList("- a<br><br>- b")).toEqual({ ordered: false, items: ["a", "b"] });
});

test("parseCellList allows an empty item (bare marker)", () => {
  expect(parseCellList("- a<br>-<br>- c")).toEqual({ ordered: false, items: ["a", "", "c"] });
});

test("parseCellList keeps inline markdown in item text (rendered later)", () => {
  expect(parseCellList("- **bold**<br>- [[Note]]")).toEqual({ ordered: false, items: ["**bold**", "[[Note]]"] });
});

test("renderCellListHtml wraps items in <ul>/<ol> with the cell-list class", () => {
  expect(renderCellListHtml("- a<br>- b", raw)).toBe('<ul class="bismuth-cell-list"><li>a</li><li>b</li></ul>');
  expect(renderCellListHtml("1. a<br>2. b", raw)).toBe('<ol class="bismuth-cell-list"><li>a</li><li>b</li></ol>');
});

test("renderCellListHtml returns null for a non-list cell (caller falls back)", () => {
  expect(renderCellListHtml("just text", raw)).toBeNull();
  expect(renderCellListHtml("a<br>b", raw)).toBeNull();
});

test("renderCellListHtml runs each item through the supplied inline renderer", () => {
  const upper = (s: string): string => s.toUpperCase();
  expect(renderCellListHtml("- a<br>- b", upper)).toBe('<ul class="bismuth-cell-list"><li>A</li><li>B</li></ul>');
});
