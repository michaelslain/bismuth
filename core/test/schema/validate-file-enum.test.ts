// core/test/schema/validate-file-enum.test.ts
import { test, expect } from "bun:test";
import { validateValue } from "../../src/schema/validate";
import type { ValidateContext } from "../../src/schema/types";

const resolveAll: ValidateContext = { resolveLink: () => true };
const resolveNone: ValidateContext = { resolveLink: () => false };

test("file resolves a [[wikilink]] target via ctx.resolveLink", () => {
  const ctx: ValidateContext = { resolveLink: (t) => t === "Existing Note" };
  expect(validateValue("file", "[[Existing Note]]", ctx)).toBeNull();
});

test("file resolves a [[target|display]] using the target part", () => {
  const ctx: ValidateContext = { resolveLink: (t) => t === "Real" };
  expect(validateValue("file", "[[Real|Shown]]", ctx)).toBeNull();
});

test("file accepts a bare path that resolves", () => {
  expect(validateValue("file", "folder/note", resolveAll)).toBeNull();
});

test("file UNRESOLVED is a warning, not an error", () => {
  const d = validateValue("file", "[[Missing]]", resolveNone);
  expect(d).not.toBeNull();
  expect(d!.severity).toBe("warning");
  expect(d!.message).toBe('"Missing" not found in vault');
});

test("file with no resolver provided is treated as valid (engine stays fs-free)", () => {
  expect(validateValue("file", "[[Whatever]]")).toBeNull();
});

test("enum accepts a configured value (case-sensitive by default)", () => {
  const t = { kind: "enum" as const, values: ["draft", "published"] };
  expect(validateValue(t, "draft")).toBeNull();
});

test("enum rejects an unknown value with an error and the value list", () => {
  const t = { kind: "enum" as const, values: ["a", "b", "c"] };
  const d = validateValue(t, "z");
  expect(d!.severity).toBe("error");
  expect(d!.message).toBe("expected one of: a, b, c");
});

test("enum offers the nearest configured value as a suggestion", () => {
  const t = { kind: "enum" as const, values: ["draft", "published", "archived"] };
  const d = validateValue(t, "publishd");
  expect(d!.suggestions).toContain("published");
});

test("enum is case-sensitive by default (Draft != draft)", () => {
  const t = { kind: "enum" as const, values: ["draft"] };
  expect(validateValue(t, "Draft")!.severity).toBe("error");
});

test("enum with caseInsensitive accepts a differently-cased value", () => {
  const t = { kind: "enum" as const, values: ["draft"], caseInsensitive: true };
  expect(validateValue(t, "DRAFT")).toBeNull();
});

test("enum with allowPrefixes accepts values carrying an allowed prefix", () => {
  const t = { kind: "enum" as const, values: ["new-note", "terminal"], allowPrefixes: ["daily-note:"] };
  expect(validateValue(t, "daily-note:journal")).toBeNull();
  expect(validateValue(t, "new-note")).toBeNull();
  expect(validateValue(t, "totally-unknown")).not.toBeNull();
});
