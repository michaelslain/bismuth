// app/src/editor/slashMenu.test.ts
import { test, expect } from "bun:test";
import { matchSlashPrefix, parseSnippet, inCodeFence, filterSlashItems, SLASH_ITEMS } from "./slashMenu";

// --- matchSlashPrefix: the trigger heuristic (the make-or-break of the feature) ---

test("matches a lone slash (empty query → whole menu)", () => {
  expect(matchSlashPrefix("/")).toEqual({ from: 0, query: "" });
});

test("matches a partial query after the slash", () => {
  expect(matchSlashPrefix("/head")).toEqual({ from: 0, query: "head" });
});

test("matches after a bullet marker", () => {
  expect(matchSlashPrefix("- /")).toEqual({ from: 2, query: "" });
  expect(matchSlashPrefix("* /x")).toEqual({ from: 2, query: "x" });
});

test("matches after a numbered marker", () => {
  expect(matchSlashPrefix("1. /ta")).toEqual({ from: 3, query: "ta" });
  expect(matchSlashPrefix("2) /")).toEqual({ from: 3, query: "" });
});

test("matches after leading indentation", () => {
  expect(matchSlashPrefix("  /q")).toEqual({ from: 2, query: "q" });
});

test("does NOT match a mid-line slash (the key false-positive guard)", () => {
  expect(matchSlashPrefix("hello /foo")).toBeNull();
  expect(matchSlashPrefix("and/or")).toBeNull();
  expect(matchSlashPrefix("  - text /foo")).toBeNull();
});

test("does NOT match a bare date like 6/9", () => {
  expect(matchSlashPrefix("6/9")).toBeNull();
});

test("a space (non-word char) after the query closes the menu", () => {
  expect(matchSlashPrefix("/ ")).toBeNull();
  expect(matchSlashPrefix("/foo bar")).toBeNull();
});

test("an absolute-path-like /usr still triggers but only filters (documented edge)", () => {
  // Acceptable: the menu just shows nothing matching "usr". A second `/` (`/usr/`) no longer matches.
  expect(matchSlashPrefix("/usr")).toEqual({ from: 0, query: "usr" });
  expect(matchSlashPrefix("/usr/")).toBeNull();
});

// --- parseSnippet: the `$0` caret marker ---

test("parseSnippet: splits text and caret on $0", () => {
  expect(parseSnippet("# $0")).toEqual({ text: "# ", caret: 2 });
  expect(parseSnippet("---\n$0")).toEqual({ text: "---\n", caret: 4 });
});

test("parseSnippet: $0 at the start", () => {
  expect(parseSnippet("$0abc")).toEqual({ text: "abc", caret: 0 });
});

test("parseSnippet: no marker → caret at end", () => {
  expect(parseSnippet("no marker")).toEqual({ text: "no marker", caret: 9 });
});

test("parseSnippet: table skeleton caret lands in the first header cell", () => {
  const { text, caret } = parseSnippet("| $0 |  |\n| --- | --- |\n|  |  |");
  expect(text.slice(0, caret)).toBe("| ");
  expect(text).not.toContain("$0");
});

// --- inCodeFence: suppress the menu inside ``` blocks ---

test("inCodeFence: true on a line inside an open fence", () => {
  expect(inCodeFence(["```", "code", "```", "after"], 1)).toBe(true);
});

test("inCodeFence: false after a closed fence", () => {
  expect(inCodeFence(["```", "code", "```", "after"], 3)).toBe(false);
});

test("inCodeFence: true inside a ```query fence too", () => {
  expect(inCodeFence(["```query", "/h", "```"], 1)).toBe(true);
});

test("inCodeFence: false on a plain body line", () => {
  expect(inCodeFence(["hello", "/h"], 1)).toBe(false);
});

test("inCodeFence: true inside a ~~~ tilde fence", () => {
  expect(inCodeFence(["~~~", "/h", "~~~"], 1)).toBe(true);
  expect(inCodeFence(["~~~", "code", "~~~", "after"], 3)).toBe(false);
});

test("inCodeFence: handles indented fences (the doc-comment's load-bearing claim)", () => {
  expect(inCodeFence(["  ```", "  code", "  ```", "after"], 1)).toBe(true);
  expect(inCodeFence(["  ```", "  code", "  ```", "after"], 3)).toBe(false);
});

// --- filterSlashItems: keyword-aware ranking ---

test("empty query returns every item in declared order", () => {
  const out = filterSlashItems(SLASH_ITEMS, "");
  expect(out.length).toBe(SLASH_ITEMS.length);
  expect(out[0].id).toBe("h1");
});

test("exact label match ranks first", () => {
  expect(filterSlashItems(SLASH_ITEMS, "table")[0].id).toBe("table");
});

test("subsequence match (tbl → Table, h1 → Heading 1)", () => {
  expect(filterSlashItems(SLASH_ITEMS, "tbl")[0].id).toBe("table");
  expect(filterSlashItems(SLASH_ITEMS, "h1")[0].id).toBe("h1");
});

test("keyword match (todo → To-do, frontmatter → Properties)", () => {
  expect(filterSlashItems(SLASH_ITEMS, "todo")[0].id).toBe("task");
  expect(filterSlashItems(SLASH_ITEMS, "frontmatter")[0].id).toBe("properties");
});

test("prefix tier keeps declared order on ties (head → h1, h2, h3)", () => {
  expect(filterSlashItems(SLASH_ITEMS, "head").map((i) => i.id).slice(0, 3)).toEqual(["h1", "h2", "h3"]);
});

test("a prefix match outranks a subsequence match", () => {
  // "li" is a prefix of "list"/"Link" keywords (tier 1) and also a subsequence of others
  // (tier 2); a tier-1 item must come first.
  const out = filterSlashItems(SLASH_ITEMS, "lin");
  expect(out[0].id).toBe("wikilink"); // "Link to note" / keyword "link" — prefix hit
});

test("no match returns an empty list", () => {
  expect(filterSlashItems(SLASH_ITEMS, "zzzz")).toEqual([]);
});

// --- catalog invariants ---

test("Properties is gated to the document start", () => {
  expect(SLASH_ITEMS.find((i) => i.id === "properties")?.when).toBe("docStart");
});

test("link/embed/query re-trigger autocomplete after insert", () => {
  for (const id of ["wikilink", "embed", "query"]) {
    expect(SLASH_ITEMS.find((i) => i.id === id)?.reTrigger).toBe(true);
  }
});

test("divider snippet is preceded by a blank line (avoids a setext-heading underline)", () => {
  expect(SLASH_ITEMS.find((i) => i.id === "divider")?.snippet.startsWith("\n")).toBe(true);
});
