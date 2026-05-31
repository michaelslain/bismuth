// core/test/schema/validate-list-object.test.ts
import { test, expect } from "bun:test";
import { validateValue } from "../../src/schema/validate";
import type { PropertyType } from "../../src/schema/types";

test("list with no item type accepts any sequence", () => {
  expect(validateValue({ kind: "list" }, ["a", "b"])).toBeNull();
});

test("list normalizes a comma string via parseList before validating items", () => {
  // "fiction, russian" -> two string items, both valid strings
  const t: PropertyType = { kind: "list", item: "string" };
  expect(validateValue(t, "fiction, russian")).toBeNull();
});

test("list validates each item against the item type and reports the first failure", () => {
  const t: PropertyType = { kind: "list", item: "number" };
  const d = validateValue(t, [1, "two", 3]);
  expect(d).not.toBeNull();
  expect(d!.severity).toBe("error");
  expect(d!.message).toBe("expected a number");
  // path index of the offending item (1) is recorded
  expect(d!.path).toEqual(["1"]);
});

test("list of numbers given a valid array passes", () => {
  const t: PropertyType = { kind: "list", item: "number" };
  expect(validateValue(t, [1, 2, 3])).toBeNull();
});

test("object validates nested fields and prefixes the field name onto the path", () => {
  const t: PropertyType = {
    kind: "object",
    fields: { count: { type: "number" } },
  };
  const d = validateValue(t, { count: "nope" });
  expect(d!.message).toBe("expected a number");
  expect(d!.path).toEqual(["count"]);
});

test("object passes when all nested fields are valid", () => {
  const t: PropertyType = {
    kind: "object",
    fields: { count: { type: "number" }, label: { type: "string" } },
  };
  expect(validateValue(t, { count: 5, label: "ok" })).toBeNull();
});
