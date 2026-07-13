import { test, expect } from "bun:test";
import {
  declaredDefaults,
  declaredPropertyKeys,
  propertyType,
  parseBasePropertyType,
  toSchemaType,
  validatePropertyValue,
  coercePropertyValue,
} from "../../src/bases/properties";
import type { BaseConfig } from "../../src/bases/types";

const declared: BaseConfig = {
  properties: {
    status: { default: "Todo" },
    priority: { type: { kind: "number" }, default: 1 },
    done: { type: { kind: "boolean" }, default: false },
    description: {},                       // declared, no default
    "note.effort": { default: "low" },     // namespaced spelling
    "formula.ppu": { default: 9 },         // non-writable namespace
  },
  declaredProperties: ["status", "priority", "done", "description", "note.effort", "formula.ppu"],
  views: [{ type: "kanban", name: "B" }],
};

test("declaredDefaults seeds every writable declared default under its bare key", () => {
  expect(declaredDefaults(declared)).toEqual({
    status: "Todo",
    priority: 1,
    done: false,          // falsey defaults are real defaults
    effort: "low",        // note. prefix stripped
    // description: no default → absent; formula.ppu: not writable → absent
  });
});

test("declaredDefaults respects the exclude set (matched on bare names)", () => {
  const out = declaredDefaults(declared, new Set(["status", "effort"]));
  expect(out).toEqual({ priority: 1, done: false });
});

test("declaredDefaults is empty for a map-form or property-less base", () => {
  expect(declaredDefaults({ properties: { a: { default: 1 } }, views: [] })).toEqual({});
  expect(declaredDefaults({ views: [] })).toEqual({});
});

test("declaredPropertyKeys returns bare names in declaration order, empty when undeclared", () => {
  expect(declaredPropertyKeys(declared)).toEqual(["status", "priority", "done", "description", "effort", "formula.ppu"]);
  expect(declaredPropertyKeys({ properties: { a: {} }, views: [] })).toEqual([]);
});

// ── Canonical functional property type (#99) ──────────────────────────────────────────

const typed: BaseConfig = {
  properties: {
    priority: { type: { kind: "number", number: "currency", unit: "USD" } },
    stage: { type: { kind: "select", options: ["todo", "doing", "done"] } },
    "note.effort": { type: { kind: "number" } },
    notes: {}, // declared, untyped
  },
  declaredProperties: ["priority", "stage", "note.effort", "notes"],
  views: [{ type: "table", name: "V" }],
};

test("parseBasePropertyType: undefined when no type; malformed present-type → text", () => {
  expect(parseBasePropertyType({})).toBeUndefined();
  expect(parseBasePropertyType({ type: null })).toBeUndefined();
  expect(parseBasePropertyType({ type: "banana" })).toEqual({ kind: "text" });
  expect(parseBasePropertyType({ type: "CHECKBOX" })).toEqual({ kind: "boolean" }); // case-insensitive alias
});

test("propertyType looks up by exact, bare, and note.-prefixed name", () => {
  expect(propertyType(typed, "priority")).toEqual({ kind: "number", number: "currency", unit: "USD" });
  expect(propertyType(typed, "note.priority")).toEqual({ kind: "number", number: "currency", unit: "USD" });
  // stored as "note.effort"; a bare lookup resolves it
  expect(propertyType(typed, "effort")).toEqual({ kind: "number" });
  expect(propertyType(typed, "note.effort")).toEqual({ kind: "number" });
});

test("propertyType is undefined for an untyped or undeclared property, and for a property-less base", () => {
  expect(propertyType(typed, "notes")).toBeUndefined();
  expect(propertyType(typed, "nonexistent")).toBeUndefined();
  expect(propertyType({ views: [] }, "anything")).toBeUndefined();
});

test("toSchemaType projects each kind onto a schema PropertyType", () => {
  expect(toSchemaType({ kind: "number" })).toBe("number");
  expect(toSchemaType({ kind: "boolean" })).toBe("boolean");
  expect(toSchemaType({ kind: "date" })).toBe("date");
  expect(toSchemaType({ kind: "datetime" })).toBe("datetime");
  expect(toSchemaType({ kind: "link" })).toBe("file");
  expect(toSchemaType({ kind: "text" })).toBe("string");
  expect(toSchemaType({ kind: "markdown" })).toBe("string");
  expect(toSchemaType({ kind: "formula" })).toBe("string");
  expect(toSchemaType({ kind: "select", options: ["a", "b"] })).toEqual({ kind: "enum", values: ["a", "b"] });
  expect(toSchemaType({ kind: "select" })).toBe("string"); // no options → free string
  expect(toSchemaType({ kind: "multiselect", options: ["a", "b"] })).toEqual({ kind: "list", item: { kind: "enum", values: ["a", "b"] } });
  expect(toSchemaType({ kind: "list" })).toEqual({ kind: "list", item: "string" });
});

test("validatePropertyValue: null when valid, a diagnostic when not", () => {
  expect(validatePropertyValue({ kind: "number" }, 3)).toBeNull();
  expect(validatePropertyValue({ kind: "number" }, "nope")?.severity).toBe("error");
  expect(validatePropertyValue({ kind: "boolean" }, true)).toBeNull();
  expect(validatePropertyValue({ kind: "date" }, "2026-07-13")).toBeNull();
  expect(validatePropertyValue({ kind: "date" }, "2026-02-30")?.severity).toBe("error");
  expect(validatePropertyValue({ kind: "select", options: ["a", "b"] }, "a")).toBeNull();
  expect(validatePropertyValue({ kind: "select", options: ["a", "b"] }, "z")?.severity).toBe("error");
  expect(validatePropertyValue({ kind: "text" }, "anything")).toBeNull();
  expect(validatePropertyValue({ kind: "number" }, null)).toBeNull(); // null is always valid
});

test("coercePropertyValue coerces to the kind's runtime shape, tolerant of junk", () => {
  expect(coercePropertyValue({ kind: "number" }, "42")).toBe(42);
  expect(coercePropertyValue({ kind: "number" }, "nope")).toBe("nope"); // unparseable passes through
  expect(coercePropertyValue({ kind: "boolean" }, "true")).toBe(true);
  expect(coercePropertyValue({ kind: "boolean" }, "false")).toBe(false);
  expect(coercePropertyValue({ kind: "multiselect" }, "a, b, c")).toEqual(["a", "b", "c"]);
  expect(coercePropertyValue({ kind: "list" }, ["x", 1])).toEqual(["x", "1"]);
  expect(coercePropertyValue({ kind: "text" }, "  ")).toBeNull(); // empty string clears
  expect(coercePropertyValue({ kind: "number" }, null)).toBeNull();
});
