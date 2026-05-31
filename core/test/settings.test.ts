// core/test/settings.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { readSettings, getVaultSchema } from "../src/settings";

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
  // Built-ins are always known (tags/aliases/cssclasses); no user properties.
  expect(Object.keys(schema).sort()).toEqual(["aliases", "cssclasses", "tags"]);
  expect(schema.tags.type).toEqual({ kind: "list", item: "string" });
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

import { reconcileSettings } from "../src/settings";
import { readFileSync } from "node:fs";

test("reconcile fills a missing top-level section with its defaults", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", "appearance:\n  theme: light\n");
  await reconcileSettings(vault);
  const { data } = (await readSettings(vault))!;
  expect((data.appearance as any).theme).toBe("light");    // user value kept
  expect((data.appearance as any).accent).toBe("#6496ff");  // missing default added
  expect((data.graph as any).spin).toBe(true);              // missing section added
});

test("reconcile preserves unknown keys", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", "appearance:\n  theme: dark\n  myCustomKey: 42\n");
  await reconcileSettings(vault);
  const { data } = (await readSettings(vault))!;
  expect((data.appearance as any).myCustomKey).toBe(42);
});

test("reconcile preserves comments", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", "# my notes\nappearance:\n  theme: dark # inline\n");
  await reconcileSettings(vault);
  const raw = readFileSync(join(vault, "settings.yaml"), "utf8");
  expect(raw).toContain("# my notes");
  expect(raw).toContain("# inline");
});

test("reconcile is a no-op write when nothing is missing", async () => {
  const vault = await emptyVault();
  await reconcileSettings(vault); // absent -> writes full defaults
  const before = readFileSync(join(vault, "settings.yaml"), "utf8");
  await reconcileSettings(vault); // second run must not rewrite
  const after = readFileSync(join(vault, "settings.yaml"), "utf8");
  expect(after).toBe(before);
});

test("reconcile leaves a corrupt file untouched", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", ": : : not yaml\n[[[");
  const before = readFileSync(join(vault, "settings.yaml"), "utf8");
  await reconcileSettings(vault);
  expect(readFileSync(join(vault, "settings.yaml"), "utf8")).toBe(before);
});

import { setSettingInFile } from "../src/settings";

test("setSettingInFile updates a nested key, preserving siblings/comments/unknowns", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", "# hdr\nappearance:\n  theme: dark\n  myCustom: 1\ngraph:\n  spin: true\n");
  await setSettingInFile(vault, ["appearance", "theme"], "light");
  const raw = readFileSync(join(vault, "settings.yaml"), "utf8");
  const { data } = (await readSettings(vault))!;
  expect((data.appearance as any).theme).toBe("light");
  expect((data.appearance as any).myCustom).toBe(1);  // unknown preserved
  expect((data.graph as any).spin).toBe(true);          // sibling preserved
  expect(raw).toContain("# hdr");                        // comment preserved
});

test("setSettingInFile creates the file (via reconcile) when absent, then sets the key", async () => {
  const vault = await emptyVault();
  await setSettingInFile(vault, ["graph", "nodeSize"], 12);
  const { data } = (await readSettings(vault))!;
  expect((data.graph as any).nodeSize).toBe(12);
  expect((data.appearance as any).theme).toBe("dark"); // reconcile seeded the rest
});

test("setSettingInFile ignores an empty path", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", "appearance:\n  theme: dark\n");
  await setSettingInFile(vault, [], "x");
  const { data } = (await readSettings(vault))!;
  expect((data.appearance as any).theme).toBe("dark");
});
