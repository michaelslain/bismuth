// app/src/editor/frontmatterUtils.test.ts
import { test, expect } from "bun:test";
import { extractFrontmatterBoundary, frontmatterBodyRange } from "./frontmatterUtils";

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

// --- frontmatterBodyRange (Harper body-skip adapter) ---

test("frontmatterBodyRange: no frontmatter -> whole document is body", () => {
  const doc = "Just some prose with a typo.";
  expect(frontmatterBodyRange(doc)).toEqual({ from: 0, to: doc.length });
});

test("frontmatterBodyRange: closed frontmatter -> body starts after the closing fence", () => {
  const doc = "---\ntitle: Hi\ntags: a, b\n---\nBody text here.";
  const bodyStart = doc.indexOf("Body text here.");
  expect(frontmatterBodyRange(doc)).toEqual({ from: bodyStart, to: doc.length });
});

test("frontmatterBodyRange: handles CRLF line endings", () => {
  const doc = "---\r\ntitle: Hi\r\n---\r\nBody.";
  const bodyStart = doc.indexOf("Body.");
  expect(frontmatterBodyRange(doc)).toEqual({ from: bodyStart, to: doc.length });
});

test("frontmatterBodyRange: unterminated frontmatter is treated as plain body", () => {
  const doc = "---\ntitle: Hi\nstill going";
  expect(frontmatterBodyRange(doc)).toEqual({ from: 0, to: doc.length });
});

test("frontmatterBodyRange: empty body after frontmatter -> from === to === length", () => {
  const doc = "---\ntitle: Hi\n---\n";
  expect(frontmatterBodyRange(doc)).toEqual({ from: doc.length, to: doc.length });
});

test("frontmatterBodyRange: empty frontmatter (immediate close) skips both fences", () => {
  const doc = "---\n---\nbody";
  const bodyStart = doc.indexOf("body");
  expect(frontmatterBodyRange(doc)).toEqual({ from: bodyStart, to: doc.length });
});
