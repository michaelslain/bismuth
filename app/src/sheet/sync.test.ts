import { test, expect } from "bun:test";
import { isExternalChange } from "./sync";

const path = "Notes/Budget.sheet";
const base = { path, isDirty: false, diskText: "B", lastWrittenText: "A" };

test("ignores changes that don't touch our file", () => {
  expect(isExternalChange({ ...base, changedPaths: ["other.md"] })).toBe(false);
});

test("ignores while the pane is dirty (never clobber in-progress edits)", () => {
  expect(isExternalChange({ ...base, changedPaths: [path], isDirty: true })).toBe(false);
});

test("ignores our own echo (disk equals what we last wrote)", () => {
  expect(isExternalChange({ ...base, changedPaths: [path], diskText: "A", lastWrittenText: "A" })).toBe(false);
});

test("reloads when an external write changed the file and we are clean", () => {
  expect(isExternalChange({ ...base, changedPaths: [path], diskText: "EXTERNAL", lastWrittenText: "A" })).toBe(true);
});

test("reloads when we have never written (lastWrittenText null) and disk changed", () => {
  expect(isExternalChange({ ...base, changedPaths: [path], lastWrittenText: null })).toBe(true);
});
