// app/src/editor/autocomplete.test.ts
import { test, expect } from "bun:test";
import { matchPropertyKeyPrefix, matchTagListItem, matchIconValue } from "./autocomplete";

// A property key is being typed at the very start of a frontmatter line (no value yet).
test("matchPropertyKeyPrefix: bare key prefix at line start", () => {
  expect(matchPropertyKeyPrefix("rat")).toEqual({ from: 0, query: "rat" });
});

test("matchPropertyKeyPrefix: empty line matches an empty key query", () => {
  expect(matchPropertyKeyPrefix("")).toEqual({ from: 0, query: "" });
});

test("matchPropertyKeyPrefix: null once a colon (value section) is present", () => {
  expect(matchPropertyKeyPrefix("rating: 4")).toBeNull();
});

test("matchPropertyKeyPrefix: null when indented (list item, not a top-level key)", () => {
  expect(matchPropertyKeyPrefix("  nested")).toBeNull();
});

// Comma-aware tag list: completes the segment after the last comma in a `tags:` value.
test("matchTagListItem: first tag right after the key", () => {
  expect(matchTagListItem("tags: fic")).toEqual({ from: 6, query: "fic" });
});

test("matchTagListItem: completes the segment after the last comma", () => {
  expect(matchTagListItem("tags: fiction, rus")).toEqual({ from: 15, query: "rus" });
});

test("matchTagListItem: trims leading whitespace of the segment", () => {
  // 'tags: a,  b' — cursor after 'b'; segment starts at the 'b' (offset 10), not the spaces.
  expect(matchTagListItem("tags: a,  b")).toEqual({ from: 10, query: "b" });
});

test("matchTagListItem: null for a non-tags key", () => {
  expect(matchTagListItem("status: do")).toBeNull();
});

// Icon value: completes the icon name after `icon:`.
test("matchIconValue: bare prefix right after the key", () => {
  expect(matchIconValue("icon: Hou")).toEqual({ from: 6, query: "Hou" });
});

test("matchIconValue: empty value matches an empty query (offer all)", () => {
  expect(matchIconValue("icon: ")).toEqual({ from: 6, query: "" });
});

test("matchIconValue: skips the whitespace after the colon (from points at the name)", () => {
  // "icon:   Car" — three spaces consumed by \s*, so `from` is the 'C' at index 8.
  expect(matchIconValue("icon:   Car")).toEqual({ from: 8, query: "Car" });
});

test("matchIconValue: null for a non-icon key", () => {
  expect(matchIconValue("status: do")).toBeNull();
});
