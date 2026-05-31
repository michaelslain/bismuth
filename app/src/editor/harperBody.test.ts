// app/src/editor/harperBody.test.ts
import { test, expect } from "bun:test";
import { harperBodyRange } from "./harperBody";

test("harperBodyRange: no frontmatter -> whole document is body", () => {
  const doc = "Just some prose with a typo.";
  expect(harperBodyRange(doc)).toEqual({ from: 0, to: doc.length });
});

test("harperBodyRange: closed frontmatter -> body starts after the second fence", () => {
  const doc = "---\ntitle: Hi\ntags: a, b\n---\nBody text here.";
  // The closing "---\n" ends at the index just before "Body text here."
  const bodyStart = doc.indexOf("Body text here.");
  expect(harperBodyRange(doc)).toEqual({ from: bodyStart, to: doc.length });
});

test("harperBodyRange: handles CRLF line endings", () => {
  const doc = "---\r\ntitle: Hi\r\n---\r\nBody.";
  const bodyStart = doc.indexOf("Body.");
  expect(harperBodyRange(doc)).toEqual({ from: bodyStart, to: doc.length });
});

test("harperBodyRange: unterminated frontmatter is treated as plain body", () => {
  // Opening "---" never closed -> not real frontmatter; lint the whole thing.
  const doc = "---\ntitle: Hi\nstill going";
  expect(harperBodyRange(doc)).toEqual({ from: 0, to: doc.length });
});

test("harperBodyRange: empty body after frontmatter -> from === to === length", () => {
  const doc = "---\ntitle: Hi\n---\n";
  expect(harperBodyRange(doc)).toEqual({ from: doc.length, to: doc.length });
});
