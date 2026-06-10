import { test, expect } from "bun:test";
import { looseEquals, type Link } from "../../src/bases/values";

function link(path: string, display?: string): Link {
  return display === undefined ? { __link: true, path } : { __link: true, path, display };
}

test("looseEquals: link without display is not equal to undefined (either arg order)", () => {
  const a = link("note.md");
  expect(looseEquals(a, undefined)).toBe(false);
  expect(looseEquals(undefined, a)).toBe(false);
});

test("looseEquals: link with display equals its display text (either arg order)", () => {
  const a = link("note.md", "My Note");
  expect(looseEquals(a, "My Note")).toBe(true);
  expect(looseEquals("My Note", a)).toBe(true);
});

test("looseEquals: link equals its path (either arg order)", () => {
  const a = link("note.md");
  expect(looseEquals(a, "note.md")).toBe(true);
  expect(looseEquals("note.md", a)).toBe(true);
});
