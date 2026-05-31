// core/test/schema/validate-scalars.test.ts
import { test, expect } from "bun:test";
import { validateValue } from "../../src/schema/validate";

test("null is valid for every scalar type (Obsidian behavior)", () => {
  expect(validateValue("string", null)).toBeNull();
  expect(validateValue("number", null)).toBeNull();
  expect(validateValue("boolean", null)).toBeNull();
  expect(validateValue("date", null)).toBeNull();
  expect(validateValue("datetime", null)).toBeNull();
});

test("undefined is treated like null and is valid", () => {
  expect(validateValue("number", undefined)).toBeNull();
});

test("string accepts any non-null scalar", () => {
  expect(validateValue("string", "hello")).toBeNull();
  expect(validateValue("string", 42)).toBeNull();
});

test("number accepts numeric values", () => {
  expect(validateValue("number", 42)).toBeNull();
  expect(validateValue("number", 3.14)).toBeNull();
});

test('number REJECTS a quoted "42" string with an error', () => {
  const d = validateValue("number", "42");
  expect(d).not.toBeNull();
  expect(d!.severity).toBe("error");
  expect(d!.message).toBe("expected a number");
  expect(d!.path).toEqual([]);
});

test("number rejects NaN-producing values", () => {
  expect(validateValue("number", "abc")!.message).toBe("expected a number");
});

test("boolean accepts only true/false", () => {
  expect(validateValue("boolean", true)).toBeNull();
  expect(validateValue("boolean", false)).toBeNull();
  const d = validateValue("boolean", "true");
  expect(d!.severity).toBe("error");
  expect(d!.message).toBe("expected true or false");
});

test("date accepts a real calendar date in YYYY-MM-DD", () => {
  expect(validateValue("date", "2026-06-01")).toBeNull();
});

test("date accepts a JS Date object", () => {
  expect(validateValue("date", new Date("2026-06-01"))).toBeNull();
});

test("date rejects a malformed shape", () => {
  const d = validateValue("date", "2026/06/01");
  expect(d!.severity).toBe("error");
  expect(d!.message).toBe("expected a date (YYYY-MM-DD)");
});

test("date rejects an out-of-range calendar day (2026-02-30)", () => {
  const d = validateValue("date", "2026-02-30");
  expect(d!.message).toBe("expected a date (YYYY-MM-DD)");
});

test("date rejects month 13", () => {
  expect(validateValue("date", "2026-13-01")!.message).toBe("expected a date (YYYY-MM-DD)");
});

test("icon accepts any string (a Lucide icon name) with no diagnostic", () => {
  expect(validateValue("icon", "House")).toBeNull();
});

test("icon accepts an emoji value with no diagnostic", () => {
  expect(validateValue("icon", "🪶")).toBeNull();
});

test("icon treats null/undefined as valid (like every other type)", () => {
  expect(validateValue("icon", null)).toBeNull();
  expect(validateValue("icon", undefined)).toBeNull();
});

test("datetime accepts valid ISO-8601", () => {
  expect(validateValue("datetime", "2026-06-01T12:30:00Z")).toBeNull();
});

test("datetime rejects an unparseable string", () => {
  const d = validateValue("datetime", "not-a-time");
  expect(d!.severity).toBe("error");
  expect(d!.message).toBe("expected a date-time (ISO-8601)");
});
