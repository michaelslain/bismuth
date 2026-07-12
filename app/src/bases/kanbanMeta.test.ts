import { describe, expect, test } from "bun:test";
import { metaColumns, hasValue } from "./kanbanMeta";

describe("metaColumns", () => {
  test("drops the title column and the description field", () => {
    expect(metaColumns(["file.name", "file.tags", "description", "worktree"], "file.name", "description"))
      .toEqual(["file.tags", "worktree"]);
  });

  test("drops the description in its note.-namespaced spelling too", () => {
    expect(metaColumns(["file.name", "note.description", "note.priority"], "file.name", "description"))
      .toEqual(["note.priority"]);
  });

  test("respects a custom descriptionField", () => {
    expect(metaColumns(["notes", "note.notes", "description"], "file.name", "notes"))
      .toEqual(["description"]);
  });

  test("no order → no meta", () => {
    expect(metaColumns(undefined, "file.name", "description")).toEqual([]);
  });
});

describe("hasValue", () => {
  test("null/undefined/empty/whitespace strings are empty", () => {
    for (const v of [null, undefined, "", "   "]) expect(hasValue(v)).toBe(false);
  });

  test("false is empty (renderValue draws it as nothing), true is a value", () => {
    expect(hasValue(false)).toBe(false);
    expect(hasValue(true)).toBe(true);
  });

  test("arrays are empty unless some element has a value", () => {
    expect(hasValue([])).toBe(false);
    expect(hasValue(["", null])).toBe(false);
    expect(hasValue(["", "x"])).toBe(true);
  });

  test("0 and dates count as values", () => {
    expect(hasValue(0)).toBe(true);
    expect(hasValue(new Date(0))).toBe(true);
  });
});
