// core/test/schema/validate-list-object.test.ts
import { test, expect, describe, it } from "bun:test";
import { SETTINGS_SCHEMA } from "../../src/schema/settingsSchema";
import { validateValue, validateDocument } from "../../src/schema/validate";
import type { PropertyType } from "../../src/schema/types";

test("list with no item type accepts any sequence", () => {
  expect(validateValue({ kind: "list" }, ["a", "b"])).toBeNull();
});

test("list normalizes a comma string via parseList before validating items", () => {
  // "fiction, russian" -> two string items, both valid strings
  const t: PropertyType = { kind: "list", item: "string" };
  expect(validateValue(t, "fiction, russian")).toBeNull();
});

test("list validates each item against the item type and reports the first failure", () => {
  const t: PropertyType = { kind: "list", item: "number" };
  const d = validateValue(t, [1, "two", 3]);
  expect(d).not.toBeNull();
  expect(d!.severity).toBe("error");
  expect(d!.message).toBe("expected a number");
  // path index of the offending item (1) is recorded
  expect(d!.path).toEqual(["1"]);
});

test("list of numbers given a valid array passes", () => {
  const t: PropertyType = { kind: "list", item: "number" };
  expect(validateValue(t, [1, 2, 3])).toBeNull();
});

test("object validates nested fields and prefixes the field name onto the path", () => {
  const t: PropertyType = {
    kind: "object",
    fields: { count: { type: "number" } },
  };
  const d = validateValue(t, { count: "nope" });
  expect(d!.message).toBe("expected a number");
  expect(d!.path).toEqual(["count"]);
});

test("object passes when all nested fields are valid", () => {
  const t: PropertyType = {
    kind: "object",
    fields: { count: { type: "number" }, label: { type: "string" } },
  };
  expect(validateValue(t, { count: 5, label: "ok" })).toBeNull();
});

describe("toolbar setting", () => {
  const toolbar = () => SETTINGS_SCHEMA.toolbar;

  it("is a list of objects with command/commands/icon/tooltip fields", () => {
    const t = toolbar().type as any;
    expect(t.kind).toBe("list");
    expect(t.item.kind).toBe("object");
    expect(Object.keys(t.item.fields).sort()).toEqual(["command", "commands", "icon", "tooltip"]);
  });

  it("seeds the default buttons", () => {
    expect(toolbar().default).toEqual([
      { command: "create-menu", icon: "Plus" },
      { command: "search", icon: "Search" },
      { command: "open-inbox", icon: "Inbox" },
    ]);
  });

  it("accepts a valid toolbar item and rejects an unknown command id", () => {
    const t = toolbar().type;
    expect(validateValue(t, [{ command: "terminal", icon: "SquareTerminal" }])).toBeNull();
    const bad = validateValue(t, [{ command: "no-such-command", icon: "X" }]);
    expect(bad).not.toBeNull();
    expect(bad!.severity).toBe("error");
  });

  it("accepts a multi-command button and rejects an unknown id inside `commands`", () => {
    const t = toolbar().type;
    expect(validateValue(t, [{ commands: ["new-note", "terminal"], icon: "Rocket" }])).toBeNull();
    const bad = validateValue(t, [{ commands: ["new-note", "no-such-command"], icon: "X" }]);
    expect(bad).not.toBeNull();
    expect(bad!.severity).toBe("error");
  });

  it("warns (does not error) when a toolbar item sets both `command` and `commands`", () => {
    const diags = validateDocument(
      { toolbar: [{ command: "new-note", commands: ["terminal"], icon: "X" }] },
      SETTINGS_SCHEMA,
      { mode: "settings" },
    );
    const conflict = diags.find((d) => d.severity === "warning" && /command/.test(d.message) && /commands/.test(d.message));
    expect(conflict, "expected a both-present warning").toBeDefined();
    expect(diags.some((d) => d.severity === "error")).toBe(false);
  });
});
