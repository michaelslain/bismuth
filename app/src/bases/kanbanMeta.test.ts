import { describe, expect, test } from "bun:test";
import { descriptionField, metaColumns, metaSource, hasValue, metaVisible, writableKey } from "./kanbanMeta";
import type { Schema } from "../../../core/src/schema/types";

describe("descriptionField", () => {
  test("no order, no explicit field → null (description is NOT built-in)", () => {
    expect(descriptionField(undefined, undefined)).toBe(null);
  });

  test("order without a description id → null", () => {
    expect(descriptionField(["file.name", "file.tags", "priority"], undefined)).toBe(null);
  });

  test("empty order → null", () => {
    expect(descriptionField([], undefined)).toBe(null);
  });

  test("`description` listed in order opts in (bare spelling)", () => {
    expect(descriptionField(["file.name", "description"], undefined)).toBe("description");
  });

  test("`note.description` listed in order opts in, resolving to the bare key", () => {
    expect(descriptionField(["note.description"], undefined)).toBe("description");
  });

  test("an explicit descriptionField opts in even without an order", () => {
    expect(descriptionField(undefined, "notes")).toBe("notes");
  });

  test("an explicit descriptionField wins over a literal `description` in order", () => {
    expect(descriptionField(["description"], "notes")).toBe("notes");
  });

  test("a blank explicit descriptionField counts as unset", () => {
    expect(descriptionField(undefined, "")).toBe(null);
    expect(descriptionField(undefined, "  ")).toBe(null);
    expect(descriptionField(["description"], "")).toBe("description");
  });

  test("a property merely NAMED description on another namespace does not opt in", () => {
    expect(descriptionField(["formula.description", "file.description"], undefined)).toBe(null);
  });
});

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

  test("null descField → nothing description-shaped is skipped (only the title)", () => {
    expect(metaColumns(["file.name", "priority", "note.due"], "file.name", null))
      .toEqual(["priority", "note.due"]);
  });

  test("no order → no meta", () => {
    expect(metaColumns(undefined, "file.name", "description")).toEqual([]);
    expect(metaColumns(undefined, "file.name", null)).toEqual([]);
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

describe("metaSource", () => {
  const columns = ["file.name", "note.status", "note.effort"];

  test("explicit view order always wins", () => {
    expect(metaSource(["note.effort"], ["status", "effort"], columns, "status")).toEqual(["note.effort"]);
  });

  test("declared properties fall back to the engine-resolved columns", () => {
    expect(metaSource(undefined, ["status", "effort"], columns)).toEqual(columns);
    expect(metaSource([], ["status", "effort"], columns)).toEqual(columns);
  });

  test("declared fallback drops the groupBy property (the column already conveys it)", () => {
    expect(metaSource(undefined, ["status", "effort"], columns, "status")).toEqual(["file.name", "note.effort"]);
    // Any spelling combination of groupBy vs column id lines up.
    expect(metaSource(undefined, ["status", "effort"], columns, "note.status")).toEqual(["file.name", "note.effort"]);
  });

  test("no order + no declaration → no meta (row-frontmatter union must not leak onto cards)", () => {
    expect(metaSource(undefined, undefined, columns, "status")).toBeUndefined();
    expect(metaSource(undefined, [], columns, "status")).toBeUndefined();
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
