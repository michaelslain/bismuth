// core/test/schema/coerce.test.ts
import { test, expect } from "bun:test";
import { parseList, normalizeTag } from "../../src/schema/coerce";

test("parseList splits a comma-separated string and trims each item", () => {
  expect(parseList("a, b, c")).toEqual(["a", "b", "c"]);
});

test('parseList splits "fiction, russian" into exactly two tags', () => {
  expect(parseList("fiction, russian")).toEqual(["fiction", "russian"]);
});

test("parseList does NOT split a multi-word value on spaces (comma-only)", () => {
  expect(parseList("science fiction")).toEqual(["science fiction"]);
  expect(parseList("science fiction, russian")).toEqual(["science fiction", "russian"]);
});

test("parseList passes an array through unchanged (as strings)", () => {
  expect(parseList(["a", "b"])).toEqual(["a", "b"]);
});

test("parseList wraps a non-string scalar into a single-element array", () => {
  expect(parseList(42)).toEqual(["42"]);
  expect(parseList(true)).toEqual(["true"]);
});

test("parseList maps null/undefined to an empty list", () => {
  expect(parseList(null)).toEqual([]);
  expect(parseList(undefined)).toEqual([]);
});

test("parseList drops empty fragments from trailing/double commas", () => {
  expect(parseList("a, , b,")).toEqual(["a", "b"]);
});

test("normalizeTag strips a single leading hash and trims", () => {
  expect(normalizeTag("#fiction")).toBe("fiction");
  expect(normalizeTag("  #russian  ")).toBe("russian");
  expect(normalizeTag("plain")).toBe("plain");
});
