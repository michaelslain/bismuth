// app/src/editor/frontmatterUtils.test.ts
import { test, expect } from "bun:test";
import { extractFrontmatterBoundary } from "./frontmatterUtils";

test("returns the YAML body range between the --- fences", () => {
  const doc = "---\ntitle: Hi\ntags: a, b\n---\n\nBody text";
  const r = extractFrontmatterBoundary(doc)!;
  // body starts right after "---\n" (offset 4) and ends right before the closing "\n---"
  expect(r).not.toBeNull();
  expect(doc.slice(r.from, r.to)).toBe("title: Hi\ntags: a, b");
  expect(r.text).toBe("title: Hi\ntags: a, b");
});

test("returns null when the doc has no frontmatter", () => {
  expect(extractFrontmatterBoundary("Just a body, no fences")).toBeNull();
});

test("returns null when the opening fence is not on line 1", () => {
  expect(extractFrontmatterBoundary("\n---\ntitle: Hi\n---\n")).toBeNull();
});

test("returns null when the frontmatter is never closed", () => {
  expect(extractFrontmatterBoundary("---\ntitle: Hi\nno closing fence")).toBeNull();
});

test("handles an empty frontmatter body (immediate close)", () => {
  const doc = "---\n---\nbody";
  const r = extractFrontmatterBoundary(doc)!;
  expect(r).not.toBeNull();
  expect(r.from).toBe(4);
  expect(r.to).toBe(4);
  expect(r.text).toBe("");
});

test("tolerates CRLF line endings", () => {
  const doc = "---\r\ntitle: Hi\r\n---\r\nbody";
  const r = extractFrontmatterBoundary(doc)!;
  expect(r.text).toBe("title: Hi");
});

test("single-line frontmatter body range (tags: a)", () => {
  const doc = "---\ntags: a\n---\nbody";
  const r = extractFrontmatterBoundary(doc)!;
  expect(r.from).toBe(4);
  expect(r.to).toBe(11);
  expect(r.text).toBe("tags: a");
});

test("body offset lands on line 2 (the line after the opening fence)", () => {
  const doc = "---\ntitle: Hi\n---\nbody";
  const r = extractFrontmatterBoundary(doc)!;
  // Everything from the start of line 1 up to r.from is exactly "---\n" (4 chars).
  expect(doc.slice(0, r.from)).toBe("---\n");
});
