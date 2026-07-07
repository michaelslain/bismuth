import { test, expect, describe } from "bun:test";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { findMatches, buildMatcher, searchVault, rankCandidates, updateSearchIndex, invalidateSearchIndex } from "../src/search";
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

describe("rankCandidates (AI prompt-search stage 1)", () => {
  test("returns NL candidates that searchVault drops (the literal-snippet-filter bug)", async () => {
    const root = makeVault({
      "japan.md": "# Japan trip\nWe flew to Tokyo in spring and visited Kyoto's temples.",
      "groceries.md": "# Groceries\nmilk, eggs, bread",
    });
    const nl = "where did I write about the Japan trip";
    // searchVault drops every hit with no verbatim occurrence of the whole sentence → empty for NL.
    expect(await searchVault(root, nl, { caseSensitive: false, wholeWord: false, regex: false })).toEqual([]);
    // rankCandidates keeps the tokenized/fuzzy ranking → surfaces the topical note with its body.
    const cands = await rankCandidates(root, nl);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.map((c) => c.path)).toContain("japan.md");
    expect(cands.find((c) => c.path === "japan.md")!.body).toContain("Kyoto");
    invalidateSearchIndex(root);
  });

  test("respects the limit", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`n${i}.md`] = `note ${i} about project alpha and search topics`;
    const root = makeVault(files);
    const cands = await rankCandidates(root, "project alpha search", 3);
    expect(cands.length).toBeLessThanOrEqual(3);
    invalidateSearchIndex(root);
  });

  test("empty query returns nothing", async () => {
    const root = makeVault({ "a.md": "anything" });
    expect(await rankCandidates(root, "   ")).toEqual([]);
    invalidateSearchIndex(root);
  });
});

describe("updateSearchIndex (incremental)", () => {
  const simple = { caseSensitive: false, wholeWord: false, regex: false };

  test("reflects an edited note without dropping the whole index", async () => {
    const root = makeVault({ "a.md": "alpha content", "b.md": "beta content" });
    expect((await searchVault(root, "alpha", simple)).length).toBe(1); // builds + caches the index
    expect((await searchVault(root, "gamma", simple)).length).toBe(0);
    writeFileSync(join(root, "a.md"), "gamma content");
    await updateSearchIndex(root, ["a.md"]);
    expect((await searchVault(root, "gamma", simple)).length).toBe(1);
    expect((await searchVault(root, "alpha", simple)).length).toBe(0);
    invalidateSearchIndex(root);
  });

  test("adds a newly-created note", async () => {
    const root = makeVault({ "a.md": "alpha" });
    expect((await searchVault(root, "delta", simple)).length).toBe(0); // caches the index
    writeFileSync(join(root, "c.md"), "delta content");
    await updateSearchIndex(root, ["c.md"]);
    expect((await searchVault(root, "delta", simple)).map((r) => r.path)).toContain("c.md");
    invalidateSearchIndex(root);
  });

  test("drops a deleted note", async () => {
    const root = makeVault({ "a.md": "alpha", "b.md": "beta" });
    expect((await searchVault(root, "beta", simple)).length).toBe(1); // caches the index
    rmSync(join(root, "b.md"));
    await updateSearchIndex(root, ["b.md"]);
    expect((await searchVault(root, "beta", simple)).length).toBe(0);
    invalidateSearchIndex(root);
  });

  test("no cached index → next search still builds a correct one", async () => {
    const root = makeVault({ "a.md": "alpha" });
    await updateSearchIndex(root, ["a.md"]); // nothing cached yet: safe no-op (falls back to invalidate)
    expect((await searchVault(root, "alpha", simple)).length).toBe(1);
    invalidateSearchIndex(root);
  });

  test("ignores non-markdown paths", async () => {
    const root = makeVault({ "a.md": "alpha" });
    expect((await searchVault(root, "alpha", simple)).length).toBe(1); // caches the index
    await updateSearchIndex(root, ["settings.yaml", "somedir"]);
    expect((await searchVault(root, "alpha", simple)).length).toBe(1); // unaffected
    invalidateSearchIndex(root);
  });
});
