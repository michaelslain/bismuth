import { describe, expect, test } from "bun:test";
import { distinctStrings, propertyEditKind } from "./propertyEdit";
import type { Schema } from "../../../core/src/schema/types";
import type { BasePropertyType } from "../../../core/src/bases/types";

describe("distinctStrings", () => {
  test("dedupes, drops empties/objects, sorts", () => {
    expect(distinctStrings(["b", "a", "b", "", null, undefined, { x: 1 }, ["y"]])).toEqual(["a", "b"]);
  });
  test("empty input yields empty list", () => {
    expect(distinctStrings([])).toEqual([]);
  });
});

describe("propertyEditKind", () => {
  const noSchema: Schema = {};

  test("registry boolean/number/date/datetime win over the value", () => {
    const schema: Schema = {
      done: { type: "boolean" },
      price: { type: "number" },
      due: { type: "date" },
      start: { type: "datetime" },
    };
    expect(propertyEditKind("done", "not actually a bool", schema, [])).toEqual({ kind: "boolean" });
    expect(propertyEditKind("price", "9", schema, [])).toEqual({ kind: "number" });
    expect(propertyEditKind("due", "whatever", schema, [])).toEqual({ kind: "date" });
    expect(propertyEditKind("start", "whatever", schema, [])).toEqual({ kind: "date", time: true });
  });

  test("registry enum -> select with its declared values", () => {
    const schema: Schema = { status: { type: { kind: "enum", values: ["todo", "doing", "done"] } } };
    expect(propertyEditKind("status", "todo", schema, [])).toEqual({ kind: "select", options: ["todo", "doing", "done"] });
  });

  test("registry list -> tags", () => {
    const schema: Schema = { labels: { type: { kind: "list", item: "string" } } };
    expect(propertyEditKind("labels", ["a"], schema, [])).toEqual({ kind: "tags" });
  });

  test("note.-namespaced id resolves the bare registry key", () => {
    const schema: Schema = { rating: { type: "number" } };
    expect(propertyEditKind("note.rating", 4, schema, [])).toEqual({ kind: "number" });
  });

  test("falls back to the value's own runtime type when undeclared", () => {
    expect(propertyEditKind("flag", true, noSchema, [])).toEqual({ kind: "boolean" });
    expect(propertyEditKind("count", 3, noSchema, [])).toEqual({ kind: "number" });
    expect(propertyEditKind("tags", ["a", "b"], noSchema, [])).toEqual({ kind: "tags" });
  });

  test("ISO date-like / datetime-like strings are detected by shape", () => {
    expect(propertyEditKind("due", "2024-01-01", noSchema, [])).toEqual({ kind: "date" });
    expect(propertyEditKind("start", "2024-01-01T09:30", noSchema, [])).toEqual({ kind: "date", time: true });
    expect(propertyEditKind("start", "2024-01-01 09:30", noSchema, [])).toEqual({ kind: "date", time: true });
  });

  test("select-from-known-values fallback: 2-8 distinct sibling values -> select", () => {
    const siblings = ["backlog", "in progress", "done", "backlog", "done"];
    expect(propertyEditKind("priority", "backlog", noSchema, siblings)).toEqual({
      kind: "select",
      options: ["backlog", "done", "in progress"],
    });
  });

  test("too few (all-unique) or too many distinct sibling values -> plain text", () => {
    expect(propertyEditKind("note.summary", "hello", noSchema, ["hello"])).toEqual({ kind: "text" });
    const many = Array.from({ length: 9 }, (_, i) => `v${i}`);
    expect(propertyEditKind("summary", "v0", noSchema, many)).toEqual({ kind: "text" });
  });

  test("null/undefined value with no siblings -> plain text", () => {
    expect(propertyEditKind("summary", null, noSchema, [])).toEqual({ kind: "text" });
  });
});

describe("propertyEditKind — declared type (#100)", () => {
  const noSchema: Schema = {};

  test("declared text/boolean/date/datetime map straight onto their editor kinds", () => {
    expect(propertyEditKind("title", "x", noSchema, [], { kind: "text" })).toEqual({ kind: "text" });
    expect(propertyEditKind("done", "x", noSchema, [], { kind: "boolean" })).toEqual({ kind: "boolean" });
    expect(propertyEditKind("due", "x", noSchema, [], { kind: "date" })).toEqual({ kind: "date" });
    expect(propertyEditKind("start", "x", noSchema, [], { kind: "datetime" })).toEqual({ kind: "date", time: true });
  });

  test("declared markdown -> markdown editor kind", () => {
    expect(propertyEditKind("notes", "x", noSchema, [], { kind: "markdown" })).toEqual({ kind: "markdown" });
  });

  test("declared number carries its format + unit through to the editor kind", () => {
    const t: BasePropertyType = { kind: "number", number: "currency", unit: "USD" };
    expect(propertyEditKind("price", 5, noSchema, [], t)).toEqual({ kind: "number", format: "currency", unit: "USD" });
    expect(propertyEditKind("weight", 5, noSchema, [], { kind: "number", number: "unit", unit: "kg" })).toEqual({
      kind: "number",
      format: "unit",
      unit: "kg",
    });
    expect(propertyEditKind("done", 5, noSchema, [], { kind: "number" })).toEqual({ kind: "number", format: undefined, unit: undefined });
  });

  test("declared type wins over a conflicting vault-registry entry or runtime value", () => {
    const schema: Schema = { title: { type: "boolean" } }; // registry disagrees with the base's own declaration
    expect(propertyEditKind("title", true, schema, [], { kind: "text" })).toEqual({ kind: "text" });
  });

  test("declared select/multiselect/list/link/formula have no dedicated editor yet — fall through to the heuristic", () => {
    expect(propertyEditKind("stage", "todo", noSchema, [], { kind: "select", options: ["todo", "doing"] })).toEqual({ kind: "text" });
    expect(propertyEditKind("labels", ["a", "b"], noSchema, [], { kind: "multiselect", options: ["a", "b"] })).toEqual({ kind: "tags" });
    expect(propertyEditKind("items", ["a"], noSchema, [], { kind: "list" })).toEqual({ kind: "tags" });
    expect(propertyEditKind("ref", "x", noSchema, [], { kind: "link" })).toEqual({ kind: "text" });
    expect(propertyEditKind("total", 5, noSchema, [], { kind: "formula", expr: "a+b" })).toEqual({ kind: "number" });
  });

  test("no declared type (undefined) is the exact untyped fallback path — untouched", () => {
    expect(propertyEditKind("flag", true, noSchema, [], undefined)).toEqual({ kind: "boolean" });
    expect(propertyEditKind("flag", true, noSchema, [])).toEqual({ kind: "boolean" });
  });
});
