import { describe, expect, test } from "bun:test";
import {
  distinctStrings,
  propertyEditKind,
  multiselectAvailable,
  multiselectCommitValue,
  multiselectValues,
  selectOptionsWithCurrent,
} from "./propertyEdit";
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

  test("declared select/multiselect map onto their dedicated editor kinds (#101), carrying the declared options through", () => {
    expect(propertyEditKind("stage", "todo", noSchema, [], { kind: "select", options: ["todo", "doing"] })).toEqual({
      kind: "select",
      options: ["todo", "doing"],
    });
    expect(propertyEditKind("labels", ["a", "b"], noSchema, [], { kind: "multiselect", options: ["a", "b", "c"] })).toEqual({
      kind: "multiselect",
      options: ["a", "b", "c"],
    });
  });

  test("declared select/multiselect with no options carry an empty list through (not a crash)", () => {
    expect(propertyEditKind("stage", "todo", noSchema, [], { kind: "select" })).toEqual({ kind: "select", options: [] });
    expect(propertyEditKind("labels", [], noSchema, [], { kind: "multiselect" })).toEqual({ kind: "multiselect", options: [] });
  });

  test("declared list/link/formula have no dedicated editor yet — fall through to the heuristic", () => {
    expect(propertyEditKind("items", ["a"], noSchema, [], { kind: "list" })).toEqual({ kind: "tags" });
    expect(propertyEditKind("ref", "x", noSchema, [], { kind: "link" })).toEqual({ kind: "text" });
    expect(propertyEditKind("total", 5, noSchema, [], { kind: "formula", expr: "a+b" })).toEqual({ kind: "number" });
  });

  test("no declared type (undefined) is the exact untyped fallback path — untouched", () => {
    expect(propertyEditKind("flag", true, noSchema, [], undefined)).toEqual({ kind: "boolean" });
    expect(propertyEditKind("flag", true, noSchema, [])).toEqual({ kind: "boolean" });
  });
});

describe("propertyEditKind — description default (#103)", () => {
  const noSchema: Schema = {};

  test("an undeclared `description` property defaults to markdown (least-surprising migration default)", () => {
    expect(propertyEditKind("description", "some *text*", noSchema, [])).toEqual({ kind: "markdown" });
    expect(propertyEditKind("note.description", "some *text*", noSchema, [])).toEqual({ kind: "markdown" });
  });

  test("an explicit base-declared type on `description` still wins over the markdown default", () => {
    expect(propertyEditKind("description", "x", noSchema, [], { kind: "text" })).toEqual({ kind: "text" });
  });

  test("a vault-wide registry entry for `description` still wins over the markdown default", () => {
    const schema: Schema = { description: { type: "boolean" } };
    expect(propertyEditKind("description", true, schema, [])).toEqual({ kind: "boolean" });
  });
});

describe("multiselectValues (#101)", () => {
  test("an array of scalars stringifies each element", () => {
    expect(multiselectValues(["bug", "urgent"])).toEqual(["bug", "urgent"]);
  });
  test("null/undefined/empty-string is no selection", () => {
    expect(multiselectValues(null)).toEqual([]);
    expect(multiselectValues(undefined)).toEqual([]);
    expect(multiselectValues("")).toEqual([]);
  });
  test("a bare scalar (hand-edited single value, not a list) becomes a one-element array", () => {
    expect(multiselectValues("bug")).toEqual(["bug"]);
  });
});

describe("multiselectAvailable (#101)", () => {
  test("drops already-selected declared options", () => {
    expect(multiselectAvailable(["bug", "feature", "design"], ["bug"])).toEqual(["feature", "design"]);
  });
  test("a selected LEGACY value (outside options) doesn't remove anything from the add list", () => {
    expect(multiselectAvailable(["bug", "feature"], ["legacy-value"])).toEqual(["bug", "feature"]);
  });
  test("everything selected -> empty add list", () => {
    expect(multiselectAvailable(["bug", "feature"], ["bug", "feature"])).toEqual([]);
  });
});

describe("multiselectCommitValue (#101)", () => {
  test("a non-empty selection commits as the array itself", () => {
    expect(multiselectCommitValue(["bug", "urgent"])).toEqual(["bug", "urgent"]);
  });
  test("an emptied selection commits null (delete the key), not []", () => {
    expect(multiselectCommitValue([])).toBeNull();
  });
});

describe("selectOptionsWithCurrent (#101)", () => {
  test("current value already in options -> options unchanged", () => {
    expect(selectOptionsWithCurrent(["low", "medium", "high"], "medium")).toEqual(["low", "medium", "high"]);
  });
  test("current value outside options (legacy/hand-edited) is prepended so it stays selected", () => {
    expect(selectOptionsWithCurrent(["low", "medium", "high"], "critical")).toEqual(["critical", "low", "medium", "high"]);
  });
  test("no current value ('') leaves options untouched", () => {
    expect(selectOptionsWithCurrent(["low", "medium", "high"], "")).toEqual(["low", "medium", "high"]);
  });
});
