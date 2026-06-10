import { test, expect, describe } from "bun:test";
import { findMatches, buildMatcher, searchVault } from "../src/search";
import { makeVault } from "./helpers";

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

describe("searchVault", () => {
  test("ranks a filename match above a body-only match", async () => {
    const root = makeVault({
      "alpha.md": "# Alpha\nthis mentions search once",
      "search.md": "# Search\nunrelated text here",
    });
    const res = await searchVault(root, "search", { caseSensitive: false, wholeWord: false, regex: false });
    expect(res[0].path).toBe("search.md");
    expect(res.map((r) => r.path)).toContain("alpha.md");
  });

  test("returns per-file snippets with match counts", async () => {
    const root = makeVault({ "notes/x.md": "search here\nand search again\nno match" });
    const res = await searchVault(root, "search", { caseSensitive: false, wholeWord: false, regex: false });
    const x = res.find((r) => r.path === "notes/x.md")!;
    expect(x.matchCount).toBe(2);
    expect(x.snippets[0].line).toBe(1);
  });

  test("regex mode ranks by match count", async () => {
    const root = makeVault({
      "few.md": "a1 only",
      "many.md": "a1 b2 c3",
    });
    const res = await searchVault(root, "[a-z]\\d", { caseSensitive: false, wholeWord: false, regex: true });
    expect(res[0].path).toBe("many.md");
  });

  test("empty query returns nothing", async () => {
    const root = makeVault({ "a.md": "anything" });
    expect(await searchVault(root, "", { caseSensitive: false, wholeWord: false, regex: false })).toEqual([]);
  });
});
