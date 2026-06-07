// core/test/schema/validate-document.test.ts
import { test, expect } from "bun:test";
import { validateDocument } from "../../src/schema/validate";
import type { Schema } from "../../src/schema/types";

const schema: Schema = {
  title: { type: "string" },
  rating: { type: "number", min: 0, max: 5 },
  status: { type: { kind: "enum", values: ["draft", "done"] } },
  api_key: { type: "string", required: true },
};

// A section with a closed shape plus an open-map section (arbitrary keys allowed).
const nestedSchema: Schema = {
  graph: { type: { kind: "object", fields: {
    spin: { type: "boolean" },
    nodeSize: { type: "number", min: 1, max: 10 },
  } } },
  folderIcons: { type: { kind: "object", fields: {} } },
};

test("a clean document yields no diagnostics", () => {
  const diags = validateDocument(
    { title: "Hi", rating: 4, status: "draft", api_key: "x" },
    schema,
    { mode: "frontmatter" },
  );
  expect(diags).toEqual([]);
});

test("non-object parsed input yields no diagnostics (tolerant)", () => {
  expect(validateDocument(null, schema, { mode: "frontmatter" })).toEqual([]);
  expect(validateDocument("oops", schema, { mode: "frontmatter" })).toEqual([]);
});

test("a known key with a wrong value reports a diagnostic carrying its path", () => {
  const diags = validateDocument({ rating: "four" }, schema, { mode: "frontmatter" });
  const r = diags.find((d) => d.path[0] === "rating")!;
  expect(r.severity).toBe("error");
  expect(r.message).toBe("expected a number");
  expect(r.path).toEqual(["rating"]);
});

test("a known number out of range reports a soft warning at document level", () => {
  const diags = validateDocument({ rating: 9 }, schema, { mode: "frontmatter" });
  const r = diags.find((d) => d.path[0] === "rating")!;
  expect(r.severity).toBe("warning");
  expect(r.message).toBe("expected a value <= 5");
});

test("frontmatter mode: an unknown key is INFO", () => {
  const diags = validateDocument({ nope: 1 }, schema, { mode: "frontmatter" });
  const d = diags.find((x) => x.path[0] === "nope")!;
  expect(d.severity).toBe("info");
  expect(d.message).toBe("unknown property: nope");
});

test("frontmatter mode: a missing required key is NOT flagged", () => {
  const diags = validateDocument({ title: "Hi" }, schema, { mode: "frontmatter" });
  expect(diags.some((d) => d.path[0] === "api_key")).toBe(false);
});

test("settings mode: an unknown key is a WARNING", () => {
  const diags = validateDocument({ nope: 1 }, schema, { mode: "settings" });
  const d = diags.find((x) => x.path[0] === "nope")!;
  expect(d.severity).toBe("warning");
  expect(d.message).toBe("unknown property: nope");
});

test("settings mode: a missing required key is an ERROR", () => {
  const diags = validateDocument({ title: "Hi" }, schema, { mode: "settings" });
  const d = diags.find((x) => x.path[0] === "api_key")!;
  expect(d.severity).toBe("error");
  expect(d.message).toBe("missing required property: api_key");
});

test("null value for a required key is still 'missing' in settings mode", () => {
  const diags = validateDocument({ api_key: null }, schema, { mode: "settings" });
  const d = diags.find((x) => x.path[0] === "api_key")!;
  expect(d.severity).toBe("error");
  expect(d.message).toBe("missing required property: api_key");
});

test("an unknown NESTED key inside a closed section is flagged with its full path", () => {
  // graph.viewMode is the real-world stale key (the 2D/3D toggle is localStorage-only).
  const diags = validateDocument({ graph: { spin: true, viewMode: "3d" } }, nestedSchema, { mode: "settings" });
  const d = diags.find((x) => x.path.join(".") === "graph.viewMode")!;
  expect(d).toBeDefined();
  expect(d.severity).toBe("warning");
  expect(d.message).toBe("unknown property: viewMode");
  // the valid sibling key is NOT flagged
  expect(diags.some((x) => x.path.join(".") === "graph.spin")).toBe(false);
});

test("multiple unknown nested keys are ALL reported (no early-return)", () => {
  const diags = validateDocument({ graph: { foo: 1, bar: 2 } }, nestedSchema, { mode: "settings" });
  const unknownPaths = diags.filter((d) => d.message.startsWith("unknown property")).map((d) => d.path.join("."));
  expect(unknownPaths).toContain("graph.foo");
  expect(unknownPaths).toContain("graph.bar");
});

test("open-map sections (empty fields) accept arbitrary keys without flagging", () => {
  const diags = validateDocument({ folderIcons: { "reading": "Book", "self/journal": "📓" } }, nestedSchema, { mode: "settings" });
  expect(diags).toEqual([]);
});

test("a nested value still gets type/range diagnostics alongside unknown-key checks", () => {
  const diags = validateDocument({ graph: { nodeSize: 99, bogus: true } }, nestedSchema, { mode: "settings" });
  expect(diags.some((d) => d.path.join(".") === "graph.nodeSize" && d.severity === "warning")).toBe(true);
  expect(diags.some((d) => d.path.join(".") === "graph.bogus" && d.message === "unknown property: bogus")).toBe(true);
});
