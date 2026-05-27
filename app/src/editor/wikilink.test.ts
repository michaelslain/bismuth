// app/src/editor/wikilink.test.ts
import { test, expect } from "bun:test";
import { matchWikilinkPrefix, buildInsert } from "./wikilink";

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
