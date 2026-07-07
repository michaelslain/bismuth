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

test("renderCellListHtml wraps items in a <ul>/<ol> with the cell-list class", () => {
  const ul = renderCellListHtml("- a<br>- b", raw)!;
  expect(ul.startsWith('<ul class="bismuth-cell-list"')).toBe(true);
  expect(ul.endsWith("</ul>")).toBe(true);
  expect((ul.match(/<li /g) ?? []).length).toBe(2);
  const ol = renderCellListHtml("1. a<br>2. b", raw)!;
  expect(ol.startsWith('<ol class="bismuth-cell-list"')).toBe(true);
  expect(ol.endsWith("</ol>")).toBe(true);
});

// #15: the marker is emitted as REAL TEXT CONTENT (a `.bismuth-cell-mk` span) and the native
// list marker is suppressed with an INLINE `list-style:none`, so a cascade / contenteditable
// quirk can't strip the bullet the way it did the class-based `list-style-type` rule.
test("renderCellListHtml renders the bullet/number marker as content, native marker suppressed", () => {
  const ul = renderCellListHtml("- a<br>- b", raw)!;
  expect(ul).toContain('<span class="bismuth-cell-mk"'); // marker element present
  expect((ul.match(/•<\/span>/g) ?? []).length).toBe(2); // two "•" glyphs, one per item
  expect(ul).toContain("list-style:none"); // native marker suppressed (no doubling)
  expect(ul).toContain('<span class="bismuth-cell-it">a</span>'); // item content wrapped

  const ol = renderCellListHtml("1. x<br>2. y", raw)!;
  expect(ol).toContain(">1.</span>"); // 1-based renumbered markers as content
  expect(ol).toContain(">2.</span>");
  expect(ol).toContain("list-style:none");
});

test("renderCellListHtml returns null for a non-list cell (caller falls back)", () => {
  expect(renderCellListHtml("just text", raw)).toBeNull();
  expect(renderCellListHtml("a<br>b", raw)).toBeNull();
});

test("renderCellListHtml runs each item through the supplied inline renderer", () => {
  const upper = (s: string): string => s.toUpperCase();
  const ul = renderCellListHtml("- a<br>- b", upper)!;
  expect(ul).toContain('<span class="bismuth-cell-it">A</span>');
  expect(ul).toContain('<span class="bismuth-cell-it">B</span>');
});
