import { describe, expect, test } from "bun:test";
import { metaColumns, hasValue, metaVisible, writableKey } from "./kanbanMeta";
import type { Schema } from "../../../core/src/schema/types";

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

describe("metaVisible", () => {
  const boolSchema: Schema = { done: { type: "boolean" } };

  test("a declared boolean property is visible even when false — the chip is its only toggle", () => {
    expect(metaVisible("done", false, boolSchema)).toBe(true);
    expect(metaVisible("note.done", false, boolSchema)).toBe(true);
  });

  test("a declared boolean stays visible when true too (toggling false→true→false never hides the row)", () => {
    expect(metaVisible("done", true, boolSchema)).toBe(true);
  });

  test("an undeclared property whose runtime value is boolean is still visible when false", () => {
    expect(metaVisible("archived", false, {})).toBe(true);
  });

  test("a genuinely empty non-boolean property stays hidden (no regression from the boolean carve-out)", () => {
    expect(metaVisible("priority", null, {})).toBe(false);
    expect(metaVisible("priority", "", {})).toBe(false);
    expect(metaVisible("tags", [], {})).toBe(false);
  });

  test("a non-empty non-boolean property is visible, same as hasValue", () => {
    expect(metaVisible("priority", "high", {})).toBe(true);
    expect(metaVisible("count", 0, {})).toBe(true);
  });
});

describe("writableKey", () => {
  test("strips the note. namespace", () => {
    expect(writableKey("note.status")).toBe("status");
  });
  test("bare property names pass through unchanged", () => {
    expect(writableKey("priority")).toBe("priority");
  });
  test("file./formula./this. are not writable", () => {
    expect(writableKey("file.name")).toBeNull();
    expect(writableKey("formula.total")).toBeNull();
    expect(writableKey("this.foo")).toBeNull();
  });
});
