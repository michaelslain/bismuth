// core/test/settings.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { readSettings, getVaultSchema } from "../src/settings";
import { keySuggestions } from "../src/schema/suggest";
import { validateDocument } from "../src/schema/validate";

async function emptyVault(): Promise<string> {
  return mkdtempSync(join(tmpdir(), "oa-settings-"));
}

test("readSettings returns null when settings.yaml is absent", async () => {
  const vault = await emptyVault();
  expect(await readSettings(vault)).toBeNull();
});

test("readSettings returns raw text + parsed data", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", "appearance:\n  theme: light\n");
  const res = await readSettings(vault);
  expect(res).not.toBeNull();
  expect(res!.raw).toContain("theme: light");
  expect(res!.data).toEqual({ appearance: { theme: "light" } });
});

test("readSettings tolerates malformed YAML by returning empty data", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", "appearance:\n  theme: : : broken\n");
  const res = await readSettings(vault);
  expect(res).not.toBeNull();
  expect(res!.data).toEqual({});
});

test("getVaultSchema parses the properties section into a registry", async () => {
  const vault = await emptyVault();
  await writeNote(
    vault,
    "settings.yaml",
    "properties:\n  due: date\n  status:\n    enum: [todo, doing, done]\n",
  );
  const schema = await getVaultSchema(vault);
  expect(schema.due.type).toBe("date");
  expect(schema.status.type).toEqual({ kind: "enum", values: ["todo", "doing", "done"] });
});

test("getVaultSchema returns only the built-in properties when there is no settings.yaml", async () => {
  const vault = await emptyVault();
  const schema = await getVaultSchema(vault);
  // Built-ins are always known (tags/aliases/cssclasses/icon); no user properties.
  expect(Object.keys(schema).sort()).toEqual(["aliases", "cssclasses", "icon", "tags"]);
  expect(schema.tags.type).toEqual({ kind: "list", item: "string" });
});

test("icon is a built-in known property of type 'icon'", async () => {
  const vault = await emptyVault();
  const schema = await getVaultSchema(vault);
  expect(schema.icon).toBeDefined();
  expect(schema.icon.type).toBe("icon");
});

test("keySuggestions includes the built-in icon key for prefix 'ic' and ''", async () => {
  const vault = await emptyVault();
  const schema = await getVaultSchema(vault);
  expect(keySuggestions(schema, "ic")).toContain("icon");
  expect(keySuggestions(schema, "")).toContain("icon");
});

test("an icon frontmatter value (emoji OR arbitrary string) validates with zero diagnostics", async () => {
  const vault = await emptyVault();
  const schema = await getVaultSchema(vault);
  expect(validateDocument({ icon: "🪶" }, schema, { mode: "frontmatter" })).toEqual([]);
  expect(validateDocument({ icon: "House" }, schema, { mode: "frontmatter" })).toEqual([]);
});

import { initializeSettings } from "../src/settings";
import { parse as parseYaml } from "yaml";

test("initializeSettings writes a clean (comment-free) defaults file when missing", async () => {
  const vault = await emptyVault();
  await initializeSettings(vault);
  const res = await readSettings(vault);
  expect(res).not.toBeNull();
  // No comment LINES — discovery is via the editor's Ctrl-Space autocomplete.
  // (The accent value "#6496ff" contains '#' but isn't a comment, so match line-start.)
  expect(res!.raw).not.toMatch(/^\s*#/m);
  // The materialized defaults parse back to the DEFAULTS object shape.
  const parsed = parseYaml(res!.raw) as Record<string, any>;
  expect(parsed.appearance.theme).toBe("dark");
  expect(parsed.graph.viewMode).toBe("3d");
  expect(parsed.calendar.defaultView).toBe("week");
});

test("initializeSettings does not clobber an existing file", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", "appearance:\n  theme: light\n");
  await initializeSettings(vault);
  const res = await readSettings(vault);
  expect(res!.data).toEqual({ appearance: { theme: "light" } });
});

import { readFolderIcons, setFolderIcon } from "../src/settings";

test("readFolderIcons returns {} when settings.yaml is absent", async () => {
  const vault = await emptyVault();
  expect(await readFolderIcons(vault)).toEqual({});
});

test("setFolderIcon persists a folder icon into settings.yaml", async () => {
  const vault = await emptyVault();
  await setFolderIcon(vault, "projects", "Folder");
  expect(await readFolderIcons(vault)).toEqual({ projects: "Folder" });
  const res = await readSettings(vault);
  expect((res!.data.folderIcons as Record<string, unknown>).projects).toBe("Folder");
});

test("setFolderIcon with an empty icon deletes the entry", async () => {
  const vault = await emptyVault();
  await setFolderIcon(vault, "projects", "Folder");
  await setFolderIcon(vault, "projects", "");
  expect(await readFolderIcons(vault)).toEqual({});
});

test("initializeSettings seeds folderIcons as an empty map", async () => {
  const vault = await emptyVault();
  await initializeSettings(vault);
  const parsed = parseYaml((await readSettings(vault))!.raw) as Record<string, any>;
  expect(parsed.folderIcons).toEqual({});
});

test("serializeSettingsForFrontend includes the folderIcons map", async () => {
  const vault = await emptyVault();
  await setFolderIcon(vault, "projects", "Folder");
  const data = await serializeSettingsForFrontend(vault);
  expect(data.folderIcons).toEqual({ projects: "Folder" });
});

import { serializeSettingsForFrontend } from "../src/settings";

test("serializeSettingsForFrontend returns defaults when no file exists", async () => {
  const vault = await emptyVault();
  const data = await serializeSettingsForFrontend(vault);
  expect((data.appearance as any).theme).toBe("dark");
  expect((data.graph as any).viewMode).toBe("3d");
});

test("serializeSettingsForFrontend overlays valid keys, ignoring wrong types", async () => {
  const vault = await emptyVault();
  await writeNote(
    vault,
    "settings.yaml",
    "appearance:\n  theme: light\n  accent: 42\ngraph:\n  nodeSize: 9\n",
  );
  const data = await serializeSettingsForFrontend(vault);
  expect((data.appearance as any).theme).toBe("light");   // valid string, applied
  expect((data.appearance as any).accent).toBe("#6496ff"); // 42 is wrong type → default
  expect((data.graph as any).nodeSize).toBe(9);            // valid number, applied
});

test("serializeSettingsForFrontend omits the properties registry section", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", "properties:\n  due: date\n");
  const data = await serializeSettingsForFrontend(vault);
  expect(data.properties).toBeUndefined();
});
