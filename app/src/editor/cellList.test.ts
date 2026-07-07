// app/src/editor/cellList.test.ts
import { test, expect } from "bun:test";
import { parseCellList, renderCellListHtml, splitCellItems } from "./cellList";

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

test("parseCellList needs ≥2 items (a single item is never a list)", () => {
  expect(parseCellList("- just one")).toBeNull();
  expect(parseCellList("plain text")).toBeNull();
  expect(parseCellList("")).toBeNull();
});

// #15 (THE root cause): the editor's editable-table widget stores a cell via
// `cellSourceFromDom`, which maps only DIRECT-child <br> nodes to `<br>` markers. Chromium
// wraps each contenteditable continuation line in a <div>, so the <br> is nested and its
// textContent is empty — the break is DROPPED and items concatenate with NO separator:
// typing "- a" ⏎ "b" ⏎ "c" stores "- a- b- c", not "- a<br>- b<br>- c". The old parser split
// only on <br>, saw one segment, and rendered the literal text. So detection must also
// re-break a run where a marker is glued straight onto the previous item's last non-space char.
test("parseCellList detects a COLLAPSED unordered list (dropped <br> — the real stored shape)", () => {
  expect(parseCellList("- a- b- c")).toEqual({ ordered: false, items: ["a", "b", "c"] });
  expect(parseCellList("- milk- eggs- bread")).toEqual({ ordered: false, items: ["milk", "eggs", "bread"] });
  expect(parseCellList("- cost-benefit- risk")).toEqual({ ordered: false, items: ["cost-benefit", "risk"] });
});

test("parseCellList does NOT false-split emphasis (`* ` collides with a bullet, so glued split is `-`-only)", () => {
  // "- **bold** x" is ONE item — the `** ` before the space must NOT be read as a `* ` bullet.
  expect(parseCellList("- **bold** here- next")).toEqual({ ordered: false, items: ["**bold** here", "next"] });
  expect(parseCellList("*italic* only")).toBeNull(); // a lone emphasis run is never a list
  // A `*`-bulleted list still works on the CLEAN <br> convention (only the collapsed `*` case is skipped).
  expect(parseCellList("* one<br>* two")).toEqual({ ordered: false, items: ["one", "two"] });
});

test("parseCellList detects a COLLAPSED ordered list (dropped <br>)", () => {
  expect(parseCellList("1. a2. b3. c")).toEqual({ ordered: true, items: ["a", "b", "c"] });
  expect(parseCellList("1) a2) b")).toEqual({ ordered: true, items: ["a", "b"] });
});

test("parseCellList detects a newline-separated list (the surface's alt convention)", () => {
  expect(parseCellList("- a\n- b\n- c")).toEqual({ ordered: false, items: ["a", "b", "c"] });
  expect(parseCellList("1. a\n2. b")).toEqual({ ordered: true, items: ["a", "b"] });
});

test("parseCellList does NOT split a prose ' - ' (spaces on both sides) into a list", () => {
  // A single bullet whose text has an em-dash-style " - " must stay one item (space before the
  // dash → not a glued marker), so a real sentence is never chopped into a bogus list.
  expect(parseCellList("- shopping - list")).toBeNull();
  expect(parseCellList("just some - text - here")).toBeNull(); // doesn't even start with a marker
  expect(parseCellList("- 3-5 items or so")).toBeNull(); // "-5"/"5 " have no glued marker
});

test("splitCellItems normalizes <br>/newline and re-breaks glued runs; leaves clean lists alone", () => {
  expect(splitCellItems("- a<br>- b")).toEqual(["- a", "- b"]); // clean <br>: untouched
  expect(splitCellItems("- a- b- c")).toEqual(["- a", "- b", "- c"]); // collapsed: re-broken
  expect(splitCellItems("1. a2. b")).toEqual(["1. a", "2. b"]); // collapsed ordered: re-broken
  expect(splitCellItems("- shopping - list")).toEqual(["- shopping - list"]); // prose dash: kept
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

// The EXACT HTML end-to-end, fed the COLLAPSED source a real cell actually stores (dropped
// <br>) — proves the whole chain (detect → real-text marker) emits a visible bulleted/numbered
// list, not literal text. `<li>` carries an inline `display:flex` + `list-style:none` and a
// `.bismuth-cell-mk` glyph, so no cascade/contenteditable rule can strip the marker.
const LI = (mk: string, it: string): string =>
  `<li class="bismuth-cell-li" style="display:flex;gap:0.4em;list-style:none;margin:0.05em 0">` +
  `<span class="bismuth-cell-mk" style="flex:0 0 auto;opacity:0.75">${mk}</span>` +
  `<span class="bismuth-cell-it">${it}</span></li>`;

test("renderCellListHtml: exact HTML for a BULLET cell (from collapsed '- a- b')", () => {
  expect(renderCellListHtml("- a- b", raw)).toBe(
    `<ul class="bismuth-cell-list" style="margin:0;padding-left:0.2em;list-style:none">` +
      LI("•", "a") + LI("•", "b") + `</ul>`,
  );
});

test("renderCellListHtml: exact HTML for a NUMBERED cell (from collapsed '1. a2. b')", () => {
  expect(renderCellListHtml("1. a2. b", raw)).toBe(
    `<ol class="bismuth-cell-list" style="margin:0;padding-left:0.2em;list-style:none">` +
      LI("1.", "a") + LI("2.", "b") + `</ol>`,
  );
});
