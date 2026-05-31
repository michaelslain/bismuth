// core/test/schema/settingsSchema.test.ts
import { test, expect } from "bun:test";
import { SETTINGS_SCHEMA, DEFAULTS } from "../../src/schema/settingsSchema";
import { validateDocument } from "../../src/schema/validate";
import type { SchemaEntry, Schema } from "../../src/schema/types";

function objectFields(entry: SchemaEntry): Schema {
  if (typeof entry.type === "object" && entry.type.kind === "object") return entry.type.fields;
  throw new Error("expected an object section");
}

test("SETTINGS_SCHEMA nests the app sections, calendar, ui, server and properties", () => {
  expect(Object.keys(SETTINGS_SCHEMA).sort()).toEqual(
    ["appearance", "calendar", "editor", "graph", "properties", "server", "srs", "terminal", "ui", "vault"].sort(),
  );
});

test("appearance.accent is a string default #6496ff", () => {
  const appearance = objectFields(SETTINGS_SCHEMA.appearance);
  expect(appearance.accent.type).toBe("string");
  expect(appearance.accent.default).toBe("#6496ff");
  expect(appearance.accent.doc).toBeTruthy();
});

test("appearance.theme is an enum of dark|light defaulting to dark", () => {
  const appearance = objectFields(SETTINGS_SCHEMA.appearance);
  expect(appearance.theme.type).toEqual({ kind: "enum", values: ["dark", "light"] });
  expect(appearance.theme.default).toBe("dark");
});

test("editorFont enum carries the EDITOR_FONTS list", () => {
  const appearance = objectFields(SETTINGS_SCHEMA.appearance);
  expect(appearance.editorFont.type).toEqual({
    kind: "enum",
    values: ["Lora", "Monaspace Xenon", "Georgia", "system-ui"],
  });
  expect(appearance.editorFont.default).toBe("Lora");
});

test("graph.repulsion is a number with the old slider bounds and default", () => {
  const graph = objectFields(SETTINGS_SCHEMA.graph);
  expect(graph.repulsion.type).toBe("number");
  expect(graph.repulsion.default).toBe(-10);
  expect(graph.repulsion.min).toBe(-40);
  expect(graph.repulsion.max).toBe(-1);
});

test("graph.palette enum carries PALETTE_KEYS and viewMode enum is 2d|3d", () => {
  const graph = objectFields(SETTINGS_SCHEMA.graph);
  expect(graph.palette.type).toEqual({
    kind: "enum",
    values: ["aurora", "ember", "forest", "mono"],
  });
  expect(graph.viewMode.type).toEqual({ kind: "enum", values: ["2d", "3d"] });
  expect(graph.viewMode.default).toBe("3d");
});

test("calendar section mirrors the calendar defaults", () => {
  const cal = objectFields(SETTINGS_SCHEMA.calendar);
  expect(cal.defaultView.type).toEqual({
    kind: "enum",
    values: ["month", "week", "3day", "day"],
  });
  expect(cal.defaultView.default).toBe("week");
  expect(cal.weekStartsOnMonday.default).toBe(true);
  expect(cal.militaryTime.default).toBe(false);
});

test("properties section is an empty object schema (the registry placeholder)", () => {
  expect(SETTINGS_SCHEMA.properties.type).toEqual({ kind: "object", fields: {} });
});

test("DEFAULTS is the plain nested object derived from the schema", () => {
  // Structural (robust to added settings): section set + representative leaves.
  expect(Object.keys(DEFAULTS).sort()).toEqual(
    ["appearance", "calendar", "editor", "graph", "properties", "server", "srs", "terminal", "ui", "vault"].sort(),
  );
  const d = DEFAULTS as Record<string, Record<string, unknown>>;
  expect(d.appearance.accent).toBe("#6496ff");
  expect(d.appearance.theme).toBe("dark");
  expect(d.graph.repulsion).toBe(-10);
  expect(d.graph.viewMode).toBe("3d");
  expect(d.editor.autoSaveDelay).toBe(800);
  expect(d.vault.backupOnSave).toBe(true);
  expect(d.calendar.defaultView).toBe("week");
  expect(d.server.fileWatchDebounceMs).toBe(250);
  expect(d.properties).toEqual({});
});

test("DEFAULTS round-trips clean through validateDocument in settings mode", () => {
  const diags = validateDocument(DEFAULTS, SETTINGS_SCHEMA, { mode: "settings" });
  const blocking = diags.filter((d) => d.severity === "error");
  expect(blocking).toEqual([]);
});
