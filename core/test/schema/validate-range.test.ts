// core/test/schema/validate-range.test.ts
import { test, expect } from "bun:test";
import { validateEntry } from "../../src/schema/validate";
import type { SchemaEntry } from "../../src/schema/types";

test("number within [min,max] produces no diagnostic", () => {
  const entry: SchemaEntry = { type: "number", min: 0, max: 10 };
  expect(validateEntry(entry, 5)).toBeNull();
});

test("number below min is a soft WARNING (value still applies)", () => {
  const entry: SchemaEntry = { type: "number", min: 0, max: 10 };
  const d = validateEntry(entry, -3);
  expect(d!.severity).toBe("warning");
  expect(d!.message).toBe("expected a value >= 0");
});

test("number above max is a soft warning", () => {
  const entry: SchemaEntry = { type: "number", min: 0, max: 10 };
  const d = validateEntry(entry, 42);
  expect(d!.severity).toBe("warning");
  expect(d!.message).toBe("expected a value <= 10");
});

test("a type error takes precedence over a range check", () => {
  const entry: SchemaEntry = { type: "number", min: 0, max: 10 };
  const d = validateEntry(entry, "42");
  expect(d!.severity).toBe("error");
  expect(d!.message).toBe("expected a number");
});

test("range is only applied to numeric values", () => {
  const entry: SchemaEntry = { type: "string", min: 0, max: 10 };
  expect(validateEntry(entry, "anything")).toBeNull();
});
