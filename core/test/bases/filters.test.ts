import { test, expect } from "bun:test";
import { passesFilter, combineFilters } from "../../src/bases/filters";
import type { EvalContext, FilterNode } from "../../src/bases/types";

const ctx: EvalContext = {
  file: { name: "a", basename: "a", path: "a.md", folder: "", ext: "md", size: 1, ctime: 0, mtime: 0, tags: ["book"], links: ["Textbook"] },
  note: { status: "open", price: 10 },
  formula: { ppu: 6 },
};

test("string leaf filter", () => {
  expect(passesFilter('status != "done"', ctx)).toBe(true);
  expect(passesFilter('status == "done"', ctx)).toBe(false);
});

test("and / or / not trees", () => {
  const f: FilterNode = { and: ['file.hasTag("book")', { or: ["price > 5", "price < 0"] }] };
  expect(passesFilter(f, ctx)).toBe(true);
  expect(passesFilter({ not: ['file.hasTag("book")'] }, ctx)).toBe(false);
  expect(passesFilter({ not: ['file.hasTag("movie")'] }, ctx)).toBe(true);
});

test("undefined filter passes everything", () => {
  expect(passesFilter(undefined, ctx)).toBe(true);
});

test("formula references work in filters", () => {
  expect(passesFilter("formula.ppu > 5", ctx)).toBe(true);
});

test("malformed expression fails closed (does not throw)", () => {
  expect(passesFilter("this is not valid )(", ctx)).toBe(false);
});

test("combineFilters ANDs two nodes", () => {
  expect(combineFilters('file.hasTag("book")', "price > 5")).toEqual({ and: ['file.hasTag("book")', "price > 5"] });
  expect(combineFilters(undefined, "price > 5")).toBe("price > 5");
  expect(combineFilters("price > 5", undefined)).toBe("price > 5");
  expect(combineFilters(undefined, undefined)).toBeUndefined();
});
