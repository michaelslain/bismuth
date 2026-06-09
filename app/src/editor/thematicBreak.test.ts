// app/src/editor/thematicBreak.test.ts
import { test, expect } from "bun:test";
import { isThematicBreak } from "./thematicBreak";

// --- isThematicBreak: markdown horizontal-rule detection -----------------------------

test("matches three dashes", () => {
  expect(isThematicBreak("---")).toBe(true);
});

test("matches three asterisks and three underscores", () => {
  expect(isThematicBreak("***")).toBe(true);
  expect(isThematicBreak("___")).toBe(true);
});

test("matches more than three markers", () => {
  expect(isThematicBreak("-----")).toBe(true);
  expect(isThematicBreak("**********")).toBe(true);
});

test("matches markers separated by spaces", () => {
  expect(isThematicBreak("- - -")).toBe(true);
  expect(isThematicBreak("* * * *")).toBe(true);
  expect(isThematicBreak("_ _ _")).toBe(true);
});

test("tolerates leading and trailing whitespace", () => {
  expect(isThematicBreak("  ---")).toBe(true);
  expect(isThematicBreak("---   ")).toBe(true);
  expect(isThematicBreak("\t- - -\t")).toBe(true);
});

test("rejects fewer than three markers", () => {
  expect(isThematicBreak("--")).toBe(false);
  expect(isThematicBreak("**")).toBe(false);
  expect(isThematicBreak("-")).toBe(false);
});

test("rejects mixed marker characters", () => {
  expect(isThematicBreak("-*-")).toBe(false);
  expect(isThematicBreak("--_")).toBe(false);
});

test("rejects markers with other content on the line", () => {
  expect(isThematicBreak("--- text")).toBe(false);
  expect(isThematicBreak("text ---")).toBe(false);
  expect(isThematicBreak("- bullet")).toBe(false);
  expect(isThematicBreak("- [ ] task")).toBe(false);
});

test("rejects an empty or blank line", () => {
  expect(isThematicBreak("")).toBe(false);
  expect(isThematicBreak("   ")).toBe(false);
});

// Frontmatter fences share the `---` shape — isThematicBreak treats them the same; the
// caller (livePreview) excludes frontmatter delimiter lines by POSITION before testing.
test("matches a bare `---` even though frontmatter uses the same token", () => {
  expect(isThematicBreak("---")).toBe(true);
});
