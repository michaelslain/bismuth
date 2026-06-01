import { test, expect, describe } from "bun:test";
import { findMatches, buildMatcher } from "../src/search";

describe("findMatches", () => {
  test("finds a literal match with line number and split context", () => {
    const body = "first line\nhello search world\nthird";
    const m = findMatches(body, "search", { caseSensitive: false, wholeWord: false, regex: false });
    expect(m).toEqual([{ line: 2, before: "hello ", match: "search", after: " world" }]);
  });

  test("is case-insensitive by default, case-sensitive when toggled", () => {
    const body = "Search and search";
    expect(findMatches(body, "search", { caseSensitive: false, wholeWord: false, regex: false }).length).toBe(2);
    expect(findMatches(body, "search", { caseSensitive: true, wholeWord: false, regex: false }).length).toBe(1);
  });

  test("whole-word does not match substrings", () => {
    const body = "searching for search";
    const m = findMatches(body, "search", { caseSensitive: false, wholeWord: true, regex: false });
    expect(m.length).toBe(1);
    expect(m[0].before).toBe("searching for ");
  });

  test("regex mode honors patterns", () => {
    const body = "a1 b2 c3";
    const m = findMatches(body, "[a-z]\\d", { caseSensitive: false, wholeWord: false, regex: true });
    expect(m.map((x) => x.match)).toEqual(["a1", "b2", "c3"]);
  });

  test("invalid regex throws via buildMatcher", () => {
    expect(() => buildMatcher("(", { caseSensitive: false, wholeWord: false, regex: true })).toThrow();
  });

  test("empty query yields no matches", () => {
    expect(findMatches("abc", "", { caseSensitive: false, wholeWord: false, regex: false })).toEqual([]);
  });
});
