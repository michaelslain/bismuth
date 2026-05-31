// core/test/schema/types.test.ts
import { test, expect } from "bun:test";
import type {
  Severity,
  PropertyType,
  SchemaEntry,
  Schema,
  Diagnostic,
  ValidateContext,
  ValidateMode,
} from "../../src/schema/types";

test("types module exposes the contract symbols as usable values", () => {
  // Construct one value of each shape; this fails to compile/import if a type is missing.
  const sev: Severity = "warning";
  const enumType: PropertyType = { kind: "enum", values: ["a", "b"], caseInsensitive: true };
  const listType: PropertyType = { kind: "list", item: "string" };
  const objType: PropertyType = { kind: "object", fields: {} };
  const entry: SchemaEntry = { type: "number", required: true, default: 0, doc: "x", min: 1, max: 9 };
  const schema: Schema = { age: entry };
  const diag: Diagnostic = { path: ["age"], severity: sev, message: "bad", suggestions: ["1"] };
  const ctx: ValidateContext = { resolveLink: (t: string) => t.length > 0 };
  const mode: ValidateMode = "frontmatter";

  expect(enumType).toEqual({ kind: "enum", values: ["a", "b"], caseInsensitive: true });
  expect(listType).toEqual({ kind: "list", item: "string" });
  expect(objType.kind).toBe("object");
  expect(schema.age.type).toBe("number");
  expect(diag.path).toEqual(["age"]);
  expect(ctx.resolveLink!("note")).toBe(true);
  expect(mode).toBe("frontmatter");
});
