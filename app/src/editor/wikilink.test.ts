// app/src/editor/wikilink.test.ts
import { test, expect } from "bun:test";
import { matchWikilinkPrefix, buildInsert, parseWikilink, resolveNotePath, wikilinkVisibleRange } from "./wikilink";

// `start` is the document offset of the opening "[[". With start=0, "[[" occupies 0-1,
// the inner text starts at offset 2, and "]]" follows the inner.
test("wikilinkVisibleRange: bare name reveals the whole name", () => {
  expect(wikilinkVisibleRange("My Note", 0)).toEqual({ from: 2, to: 9 });
});

test("wikilinkVisibleRange: a path reveals only the basename", () => {
  // "[[reading/quotes/My Note]]" — basename "My Note" begins after the last "/"
  expect(wikilinkVisibleRange("reading/quotes/My Note", 0)).toEqual({ from: 17, to: 24 });
});

test("wikilinkVisibleRange: an alias reveals the alias text", () => {
  // "[[My Note|Alias]]" — "Alias" sits between the "|" and the closing "]]"
  expect(wikilinkVisibleRange("My Note|Alias", 0)).toEqual({ from: 10, to: 15 });
});

test("wikilinkVisibleRange: a heading is excluded from the revealed name", () => {
  expect(wikilinkVisibleRange("My Note#Section", 0)).toEqual({ from: 2, to: 9 });
});

test("wikilinkVisibleRange: honors a non-zero start offset", () => {
  expect(wikilinkVisibleRange("My Note", 100)).toEqual({ from: 102, to: 109 });
});

test("parseWikilink: bare name is its own target and display", () => {
  expect(parseWikilink("My Note")).toEqual({ target: "My Note", display: "My Note" });
});

test("parseWikilink: a path target displays only the basename", () => {
  expect(parseWikilink("reading/quotes/My Note")).toEqual({
    target: "reading/quotes/My Note",
    display: "My Note",
  });
});

test("parseWikilink: an alias becomes the display text", () => {
  expect(parseWikilink("My Note|Alias")).toEqual({
    target: "My Note",
    alias: "Alias",
    display: "Alias",
  });
});

test("parseWikilink: a heading is stripped from the target", () => {
  expect(parseWikilink("My Note#Section")).toEqual({
    target: "My Note",
    heading: "Section",
    display: "My Note",
  });
});

test("parseWikilink: combined path + heading + alias", () => {
  expect(parseWikilink("reading/My Note#Section|Alias")).toEqual({
    target: "reading/My Note",
    heading: "Section",
    alias: "Alias",
    display: "Alias",
  });
});

test("parseWikilink: trims surrounding whitespace from the target", () => {
  expect(parseWikilink("  My Note  ")).toEqual({ target: "My Note", display: "My Note" });
});

const NOTES = [
  { label: "My Note", path: "reading/quotes/My Note" },
  { label: "Index", path: "Index" },
];

test("resolveNotePath: a basename resolves to its subfolder path", () => {
  expect(resolveNotePath("My Note", NOTES)).toBe("reading/quotes/My Note");
});

test("resolveNotePath: a root note resolves to itself", () => {
  expect(resolveNotePath("Index", NOTES)).toBe("Index");
});

test("resolveNotePath: a full path target resolves to itself", () => {
  expect(resolveNotePath("reading/quotes/My Note", NOTES)).toBe("reading/quotes/My Note");
});

test("resolveNotePath: an unknown target returns null (new note)", () => {
  expect(resolveNotePath("Nonexistent", NOTES)).toBeNull();
});

test("matches an empty open wikilink", () => {
  expect(matchWikilinkPrefix("[[")).toEqual({ from: 2, query: "" });
});

test("matches a partial query mid-line", () => {
  expect(matchWikilinkPrefix("see [[par")).toEqual({ from: 6, query: "par" });
});

test("matches a query containing spaces", () => {
  expect(matchWikilinkPrefix("[[My Note")).toEqual({ from: 2, query: "My Note" });
});

test("matches the rightmost open wikilink when an earlier one is closed", () => {
  expect(matchWikilinkPrefix("[[a]] [[b")).toEqual({ from: 8, query: "b" });
});

test("returns null for a closed wikilink", () => {
  expect(matchWikilinkPrefix("[[Done]]")).toBeNull();
});

test("returns null when no wikilink is open", () => {
  expect(matchWikilinkPrefix("just text")).toBeNull();
});

test("buildInsert appends closing brackets when none ahead", () => {
  expect(buildInsert("Foo", false)).toEqual({ insert: "Foo]]", cursorOffset: 5 });
});

test("buildInsert skips closing brackets when already ahead", () => {
  expect(buildInsert("Foo", true)).toEqual({ insert: "Foo", cursorOffset: 5 });
});
