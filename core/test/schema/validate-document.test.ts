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
