// app/src/tabIds.test.ts
import { test, expect, describe } from "bun:test";
import { EXPORT_PREFIX, contentLabel, contentIcon, isSentinel } from "./tabIds";

describe("export tab id", () => {
  test("EXPORT_PREFIX is a sentinel", () => {
    expect(isSentinel(EXPORT_PREFIX + "a/b/note.md")).toBe(true);
  });
  test("label is 'Export: <name>'", () => {
    expect(contentLabel(EXPORT_PREFIX + "a/b/note.md")).toBe("Export: note");
    expect(contentLabel(EXPORT_PREFIX + "Reading.md")).toBe("Export: Reading");
  });
  test("icon is Download", () => {
    expect(contentIcon(EXPORT_PREFIX + "a/note.md")).toBe("Download");
  });
});
