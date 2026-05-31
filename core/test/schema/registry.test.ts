// core/test/schema/registry.test.ts
import { test, expect } from "bun:test";
import { loadRegistry } from "../../src/schema/registry";

test("a bare type string maps to a scalar SchemaEntry", () => {
  const schema = loadRegistry({ due: "date", title: "string" });
  expect(schema.due.type).toBe("date");
  expect(schema.title.type).toBe("string");
});

test("an unknown type string falls back to string", () => {
  const schema = loadRegistry({ weird: "frobnicate" });
  expect(schema.weird.type).toBe("string");
});

test("an enum object becomes an enum PropertyType", () => {
  const schema = loadRegistry({ status: { enum: ["draft", "done"] } });
  expect(schema.status.type).toEqual({ kind: "enum", values: ["draft", "done"] });
});

test("a list object with an item type becomes a list PropertyType", () => {
  const schema = loadRegistry({ tags: { list: "string" } });
  expect(schema.tags.type).toEqual({ kind: "list", item: "string" });
});

test("a list object with no item type yields an untyped list", () => {
  const schema = loadRegistry({ things: { list: true } });
  expect(schema.things.type).toEqual({ kind: "list" });
});

test("entry-level metadata (required/doc/min/max/default) is preserved", () => {
  const schema = loadRegistry({
    rating: { type: "number", required: true, min: 0, max: 5, doc: "1-5", default: 3 },
  });
  expect(schema.rating).toEqual({
    type: "number",
    required: true,
    min: 0,
    max: 5,
    doc: "1-5",
    default: 3,
  });
});

test("non-object / empty input yields an empty schema (tolerant)", () => {
  expect(loadRegistry(null)).toEqual({});
  expect(loadRegistry("oops")).toEqual({});
  expect(loadRegistry(undefined)).toEqual({});
});
