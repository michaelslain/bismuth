// app/src/editor/yamlSchema.test.ts
import { test, expect } from "bun:test";
import { diagnosticsForFrontmatter } from "./yamlSchema";
import type { Schema } from "../../../core/src/schema/types";

const schema: Schema = {
  rating: { type: "number" },
  status: { type: { kind: "enum", values: ["todo", "done"] } },
  tags: { type: { kind: "list", item: "string" } },
  source: { type: "file" },
};

const resolveLink = (target: string) => target === "Exists";

test("no diagnostics for a valid frontmatter block", () => {
  const doc = "---\nrating: 4\nstatus: done\ntags: a, b\n---\nbody";
  expect(diagnosticsForFrontmatter(doc, schema, resolveLink)).toEqual([]);
});

test("empty array when the doc has no frontmatter", () => {
  expect(diagnosticsForFrontmatter("just body", schema, resolveLink)).toEqual([]);
});

test("type error maps to the offending key's line range", () => {
  const doc = "---\nrating: four\n---\nbody";
  const diags = diagnosticsForFrontmatter(doc, schema, resolveLink);
  expect(diags.length).toBe(1);
  expect(diags[0].severity).toBe("error");
  expect(diags[0].message).toContain("number");
  // line is "rating: four": offsets cover that line's text in the document
  expect(doc.slice(diags[0].from, diags[0].to)).toBe("rating: four");
});

test("unresolved file link is a warning, not an error", () => {
  const doc = "---\nsource: \"[[Missing]]\"\n---\nbody";
  const diags = diagnosticsForFrontmatter(doc, schema, resolveLink);
  expect(diags.length).toBe(1);
  expect(diags[0].severity).toBe("warning");
});

test("resolved file link produces no diagnostic", () => {
  const doc = "---\nsource: \"[[Exists]]\"\n---\nbody";
  expect(diagnosticsForFrontmatter(doc, schema, resolveLink)).toEqual([]);
});

test("malformed YAML in the frontmatter does not throw (returns [])", () => {
  const doc = "---\nrating: : : oops\n---\nbody";
  expect(() => diagnosticsForFrontmatter(doc, schema, resolveLink)).not.toThrow();
});
