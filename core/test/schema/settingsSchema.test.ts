// core/test/schema/settingsSchema.test.ts
import { test, expect } from "bun:test";
import { SETTINGS_SCHEMA, DEFAULTS } from "../../src/schema/settingsSchema";
import { validateDocument } from "../../src/schema/validate";
import { KEYBINDING_CATALOG } from "../../src/keybindings";
import type { SchemaEntry, Schema } from "../../src/schema/types";

function objectFields(entry: SchemaEntry): Schema {
  if (typeof entry.type === "object" && entry.type.kind === "object") return entry.type.fields;
  throw new Error("expected an object section");
}

test("SETTINGS_SCHEMA nests the app sections, calendar, ui, server, folderIcons and properties", () => {
  expect(Object.keys(SETTINGS_SCHEMA).sort()).toEqual(
    ["appearance", "attachments", "calendar", "dailyNotes", "editor", "folderIcons", "graph", "keybindings", "properties", "server", "srs", "templates", "terminal", "toolbar", "ui", "vault"].sort(),
  );
});

test("folderIcons section is an empty object schema (the per-folder icon map placeholder)", () => {
  expect(SETTINGS_SCHEMA.folderIcons.type).toEqual({ kind: "object", fields: {} });
});

test("appearance has no flat per-color keys (themes are the single source of color)", () => {
  const appearance = objectFields(SETTINGS_SCHEMA.appearance);
  expect(appearance.background).toBeUndefined();
  expect(appearance.foreground).toBeUndefined();
  expect(appearance.neutral).toBeUndefined();
  expect(appearance.accent).toBeUndefined();
  expect(appearance.accentPalette).toBeUndefined();
});

test("appearance.theme is the Bismuth theme enum defaulting to oxide-duotone", () => {
  const appearance = objectFields(SETTINGS_SCHEMA.appearance);
  expect(appearance.theme.type).toEqual({
    kind: "enum",
    values: [
      "oxide-duotone", "gunmetal-teal", "rose-gold", "indigo-oxide", "forest-oxide", "full-sheen",
      "oxide-duotone-light", "gunmetal-teal-light", "rose-gold-light",
      "indigo-oxide-light", "forest-oxide-light", "full-sheen-light",
    ],
  });
  expect(appearance.theme.default).toBe("oxide-duotone");
  expect(appearance.theme.doc).toBeTruthy();
});

test("appearance.icon is the 14-mark enum defaulting to hopper-crystal", () => {
  const appearance = objectFields(SETTINGS_SCHEMA.appearance);
  expect(appearance.icon.type).toEqual({
    kind: "enum",
    values: ["hopper-crystal", "node-b", "square-funnel", "nested-diamonds", "pinwheel", "node-crystal", "lattice", "diamond-bloom", "node-diamond", "octagon-bloom", "spin-cross", "tri-bloom", "radial-graph", "node-rings"],
  });
  expect(appearance.icon.default).toBe("hopper-crystal");
  expect(appearance.icon.doc).toBeTruthy();
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

test("graph color settings are gone (derived from appearance) and viewMode enum is 2d|3d", () => {
  const graph = objectFields(SETTINGS_SCHEMA.graph);
  expect(graph.palette).toBeUndefined();
  expect(graph.edgeColor).toBeUndefined();
  expect(graph.backgroundColor).toBeUndefined();
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

test("keybindings section has one string key per catalog action, defaulting to its combo", () => {
  const kb = objectFields(SETTINGS_SCHEMA.keybindings);
  // Exactly the catalog ids, no more, no less.
  expect(Object.keys(kb).sort()).toEqual(KEYBINDING_CATALOG.map((k) => k.id).sort());
  for (const spec of KEYBINDING_CATALOG) {
    expect(kb[spec.id].type).toBe("keybind");
    expect(kb[spec.id].default).toBe(spec.default);
    expect(kb[spec.id].doc).toBeTruthy();
  }
  // Representative defaults equal the previously hardcoded combos.
  expect(kb["command-palette"].default).toBe("Mod+P");
  expect(kb["split-down"].default).toBe("Mod+Shift+D");
  expect(kb["terminal"].default).toBe("Mod+`, Mod+J");
});

test("keybindings is the LAST schema section (so it sits at the end of a fresh settings.yaml)", () => {
  const keys = Object.keys(SETTINGS_SCHEMA);
  expect(keys[keys.length - 1]).toBe("keybindings");
});

test("DEFAULTS.keybindings materializes every catalog combo", () => {
  const d = DEFAULTS as Record<string, Record<string, unknown>>;
  for (const spec of KEYBINDING_CATALOG) {
    expect(d.keybindings[spec.id]).toBe(spec.default);
  }
});

test("properties section is an empty object schema (the registry placeholder)", () => {
  expect(SETTINGS_SCHEMA.properties.type).toEqual({ kind: "object", fields: {} });
});

test("DEFAULTS is the plain nested object derived from the schema", () => {
  // Structural (robust to added settings): section set + representative leaves.
  expect(Object.keys(DEFAULTS).sort()).toEqual(
    ["appearance", "attachments", "calendar", "dailyNotes", "editor", "folderIcons", "graph", "keybindings", "properties", "server", "srs", "templates", "terminal", "toolbar", "ui", "vault"].sort(),
  );
  const d = DEFAULTS as Record<string, Record<string, unknown>>;
  expect(d.appearance.theme).toBe("oxide-duotone");
  expect(d.appearance.icon).toBe("hopper-crystal");
  expect(d.appearance.accent).toBeUndefined(); // flat color keys removed; theme owns color
  expect(d.graph.repulsion).toBe(-10);
  expect(d.graph.viewMode).toBe("3d");
  expect(d.editor.autoSaveDelay).toBe(800);
  expect(d.vault.backupOnSave).toBe(true);
  expect(d.calendar.defaultView).toBe("week");
  expect(d.server.fileWatchDebounceMs).toBe(250);
  expect(d.properties).toEqual({});
  expect(d.folderIcons).toEqual({});
});

test("DEFAULTS round-trips clean through validateDocument in settings mode", () => {
  const diags = validateDocument(DEFAULTS, SETTINGS_SCHEMA, { mode: "settings" });
  const blocking = diags.filter((d) => d.severity === "error");
  expect(blocking).toEqual([]);
});
