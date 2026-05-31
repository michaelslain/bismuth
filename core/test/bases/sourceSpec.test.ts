import { expect, test } from "bun:test";
import { normalizeSource } from "../../src/bases/sourceSpec";

test("string 'notes' → notes spec", () => {
  expect(normalizeSource("notes", {})).toEqual({ kind: "notes" });
});

test("string with inline where", () => {
  expect(normalizeSource('notes where folder == "Keep"', {})).toEqual({ kind: "notes", where: 'folder == "Keep"' });
});

test("string 'tasks' + top-level from/where", () => {
  expect(normalizeSource("tasks", { from: "[[Keep]]", where: "not done" })).toEqual({
    kind: "tasks",
    from: "[[Keep]]",
    where: "not done",
  });
});

test("inline where on the string beats top-level where", () => {
  expect(normalizeSource("tasks where done", { where: "not done" })).toEqual({ kind: "tasks", where: "done" });
});

test("object form passes through (and prunes undefined)", () => {
  expect(normalizeSource({ kind: "tasks", from: "[[Keep]]" }, {})).toEqual({ kind: "tasks", from: "[[Keep]]" });
});

test("base ref string with top-level ref", () => {
  expect(normalizeSource("base", { ref: "[[X]]" })).toEqual({ kind: "base", ref: "[[X]]" });
});

test("unknown / missing → undefined (caller defaults)", () => {
  expect(normalizeSource(undefined, {})).toBeUndefined();
  expect(normalizeSource(42, {})).toBeUndefined();
  expect(normalizeSource("bogus", {})).toBeUndefined();
  expect(normalizeSource({ kind: "bogus" }, {})).toBeUndefined();
});

// Regression: unquoted [[X]] in frontmatter parses as a nested array via YAML.
test("nested-array 'from' (unquoted [[X]]) is coerced to a wikilink string", () => {
  expect(normalizeSource("tasks", { from: [["Keep"]] })).toEqual({ kind: "tasks", from: "[[Keep]]" });
});
test("nested-array 'ref' (unquoted [[X]]) is coerced", () => {
  expect(normalizeSource("base", { ref: [["My Base"]] })).toEqual({ kind: "base", ref: "[[My Base]]" });
});
test("object-form with nested-array from is coerced", () => {
  expect(normalizeSource({ kind: "tasks", from: [["Keep"]] }, {})).toEqual({ kind: "tasks", from: "[[Keep]]" });
});
