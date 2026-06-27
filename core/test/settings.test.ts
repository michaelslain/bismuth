// core/test/settings.test.ts
import { test, expect, describe, it, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { readSettings, getVaultSchema, reconcileSettings } from "../src/settings";
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
  await writeNote(vault, ".settings/settings.yaml", "appearance:\n  theme: light\n");
  const res = await readSettings(vault);
  expect(res).not.toBeNull();
  expect(res!.raw).toContain("theme: light");
  expect(res!.data).toEqual({ appearance: { theme: "light" } });
});

test("readSettings tolerates malformed YAML by returning empty data", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", "appearance:\n  theme: : : broken\n");
  const res = await readSettings(vault);
  expect(res).not.toBeNull();
  expect(res!.data).toEqual({});
});

test("getVaultSchema parses the properties section into a registry", async () => {
  const vault = await emptyVault();
  await writeNote(
    vault,
    ".settings/settings.yaml",
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
  expect(parsed.appearance.theme).toBe("oxide-duotone");
  expect(parsed.graph.nodeSize).toBe(6);
  expect(parsed.calendar.defaultView).toBe("week");
});

test("initializeSettings does not clobber an existing file", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", "appearance:\n  theme: light\n");
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

import { serializeSettingsForFrontend, SETTINGS_FILE } from "../src/settings";

test("serializeSettingsForFrontend returns defaults when no file exists", async () => {
  const vault = await emptyVault();
  const data = await serializeSettingsForFrontend(vault);
  expect((data.appearance as any).theme).toBe("oxide-duotone");
  expect((data.graph as any).nodeSize).toBe(6);
});

test("serializeSettingsForFrontend overlays valid keys, ignoring wrong types", async () => {
  const vault = await emptyVault();
  await writeNote(
    vault,
    ".settings/settings.yaml",
    "appearance:\n  editorFont: Georgia\n  editorFontSize: big\ngraph:\n  nodeSize: 9\n",
  );
  const data = await serializeSettingsForFrontend(vault);
  expect((data.appearance as any).editorFont).toBe("Georgia");   // valid string, applied
  expect((data.appearance as any).editorFontSize).toBe(16);      // "big" is wrong type → default
  expect((data.graph as any).nodeSize).toBe(9);                  // valid number, applied
});

test("serializeSettingsForFrontend clamps out-of-range numbers and invalid enums to defaults", async () => {
  const vault = await emptyVault();
  await writeNote(
    vault,
    ".settings/settings.yaml",
    // editorFontSize max is 28, theme is an enum — both stored values are invalid.
    "appearance:\n  editorFontSize: 999\n  theme: not-a-real-theme\n",
  );
  const data = await serializeSettingsForFrontend(vault);
  expect((data.appearance as any).editorFontSize).toBe(16);       // above max → default
  expect((data.appearance as any).theme).toBe("oxide-duotone");   // invalid enum → default
});

test("serializeSettingsForFrontend omits the properties registry section", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", "properties:\n  due: date\n");
  const data = await serializeSettingsForFrontend(vault);
  expect(data.properties).toBeUndefined();
});

import { readFileSync } from "node:fs";

test("reconcile fills a missing top-level section with its defaults", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", "appearance:\n  editorFont: Georgia\n");
  await reconcileSettings(vault);
  const { data } = (await readSettings(vault))!;
  expect((data.appearance as any).editorFont).toBe("Georgia"); // user value kept
  expect((data.appearance as any).theme).toBe("oxide-duotone"); // missing default added
  expect((data.graph as any).spin).toBe(true);                 // missing section added
});

test("reconcile preserves unknown keys", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", "appearance:\n  theme: oxide-duotone\n  myCustomKey: 42\n");
  await reconcileSettings(vault);
  const { data } = (await readSettings(vault))!;
  expect((data.appearance as any).myCustomKey).toBe(42);
});

test("reconcile preserves comments", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", "# my notes\nappearance:\n  theme: oxide-duotone # inline\n");
  await reconcileSettings(vault);
  const raw = readFileSync(join(vault, ".settings/settings.yaml"), "utf8");
  expect(raw).toContain("# my notes");
  expect(raw).toContain("# inline");
});

test("reconcile is a no-op write when nothing is missing", async () => {
  const vault = await emptyVault();
  await reconcileSettings(vault); // absent -> writes full defaults
  const before = readFileSync(join(vault, ".settings/settings.yaml"), "utf8");
  await reconcileSettings(vault); // second run must not rewrite
  const after = readFileSync(join(vault, ".settings/settings.yaml"), "utf8");
  expect(after).toBe(before);
});

test("reconcile leaves a corrupt file untouched", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", ": : : not yaml\n[[[");
  const before = readFileSync(join(vault, ".settings/settings.yaml"), "utf8");
  await reconcileSettings(vault);
  expect(readFileSync(join(vault, ".settings/settings.yaml"), "utf8")).toBe(before);
});

import { setSettingInFile } from "../src/settings";

test("setSettingInFile updates a nested key, preserving siblings/comments/unknowns", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", "# hdr\nappearance:\n  theme: oxide-duotone\n  myCustom: 1\ngraph:\n  spin: true\n");
  await setSettingInFile(vault, ["appearance", "theme"], "light");
  const raw = readFileSync(join(vault, ".settings/settings.yaml"), "utf8");
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
  expect((data.appearance as any).theme).toBe("oxide-duotone"); // reconcile seeded the rest
});

test("setSettingInFile ignores an empty path", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", "appearance:\n  theme: oxide-duotone\n");
  await setSettingInFile(vault, [], "x");
  const { data } = (await readSettings(vault))!;
  expect((data.appearance as any).theme).toBe("oxide-duotone");
});

test("setSettingInFile leaves a corrupt file's bytes unchanged", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", ": : : not yaml\n[[[");
  const before = readFileSync(join(vault, ".settings/settings.yaml"), "utf8");
  await setSettingInFile(vault, ["appearance", "theme"], "light");
  expect(readFileSync(join(vault, ".settings/settings.yaml"), "utf8")).toBe(before);
});

test("setFolderIcon leaves a corrupt file's bytes unchanged (never clobbers content)", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", ": : : not yaml\n[[[");
  const before = readFileSync(join(vault, ".settings/settings.yaml"), "utf8");
  await setFolderIcon(vault, "projects", "Folder");
  expect(readFileSync(join(vault, ".settings/settings.yaml"), "utf8")).toBe(before);
});

import { loadAppConfig } from "../src/settings";

test("loadAppConfig returns file values merged over defaults, typed", async () => {
  const vault = await emptyVault();
  await writeNote(vault, ".settings/settings.yaml", "graph:\n  repulsion: -22\n");
  const cfg = await loadAppConfig(vault);
  expect((cfg.graph as any).repulsion).toBe(-22);    // from file
  expect((cfg.graph as any).linkDistance).toBe(5);   // schema default
  expect((cfg.appearance as any).theme).toBe("oxide-duotone"); // schema default
});

// --- toolbar serialization ---

function freshVault(): string {
  return mkdtempSync(join(tmpdir(), "oa-toolbar-"));
}

describe("toolbar serialization", () => {
  it("seeds the default toolbar into a fresh settings.yaml and serializes it", async () => {
    const vault = freshVault();
    await reconcileSettings(vault); // writes a fresh settings.yaml with defaults
    const out = await serializeSettingsForFrontend(vault);
    expect(out.toolbar).toEqual([
      { command: "create-menu", icon: "Plus" },
      { command: "search", icon: "Search" },
    ]);
  });

  it("passes a user-defined toolbar list through, dropping malformed items", async () => {
    const vault = freshVault();
    await Bun.write(
      join(vault, SETTINGS_FILE),
      [
        "toolbar:",
        "  - command: settings",
        "    icon: Settings",
        "    tooltip: Preferences",
        "  - command: graph-both",
        "  - icon: Bug",
        "  - command: terminal",
        "    icon: SquareTerminal",
      ].join("\n"),
    );
    const out = await serializeSettingsForFrontend(vault);
    expect(out.toolbar).toEqual([
      { command: "settings", icon: "Settings", tooltip: "Preferences" },
      { command: "terminal", icon: "SquareTerminal" },
    ]);
  });

  it("honors an explicit empty toolbar", async () => {
    const vault = freshVault();
    await Bun.write(join(vault, SETTINGS_FILE), "toolbar: []\n");
    const out = await serializeSettingsForFrontend(vault);
    expect(out.toolbar).toEqual([]);
  });

  it("passes a multi-command button (commands list) through", async () => {
    const vault = freshVault();
    await Bun.write(
      join(vault, SETTINGS_FILE),
      [
        "toolbar:",
        "  - commands:",
        "      - new-note",
        "      - terminal",
        "    icon: Rocket",
        "    tooltip: Note + terminal",
      ].join("\n"),
    );
    const out = await serializeSettingsForFrontend(vault);
    expect(out.toolbar).toEqual([
      { commands: ["new-note", "terminal"], icon: "Rocket", tooltip: "Note + terminal" },
    ]);
  });

  it("drops a button that has neither command nor a non-empty commands list", async () => {
    const vault = freshVault();
    await Bun.write(
      join(vault, SETTINGS_FILE),
      [
        "toolbar:",
        "  - commands: []",
        "    icon: Empty",
        "  - command: terminal",
        "    icon: SquareTerminal",
      ].join("\n"),
    );
    const out = await serializeSettingsForFrontend(vault);
    expect(out.toolbar).toEqual([
      { command: "terminal", icon: "SquareTerminal" },
    ]);
  });
});

// --- dailyNotes serialization ---

describe("dailyNotes serialization", () => {
  it("seeds the default journal config into a fresh settings.yaml", async () => {
    const vault = mkdtempSync(join(tmpdir(), "oa-daily-"));
    await reconcileSettings(vault);
    const out = await serializeSettingsForFrontend(vault);
    expect(out.dailyNotes).toEqual([
      { id: "journal", label: "Journal", icon: "BookOpen", folder: "Journal", fileName: "{{date}} journal", template: "Templates/Journal.md" },
    ]);
  });

  it("drops malformed items and fills field defaults", async () => {
    const vault = mkdtempSync(join(tmpdir(), "oa-daily-"));
    await Bun.write(join(vault, SETTINGS_FILE), [
      "dailyNotes:",
      "  - id: work",
      '    fileName: "{{date}} work"',
      "  - label: NoId",
      "  - id: noFile",
    ].join("\n"));
    const out = await serializeSettingsForFrontend(vault);
    expect(out.dailyNotes).toEqual([
      { id: "work", label: "work", icon: "CalendarDays", folder: "", fileName: "{{date}} work", template: "" },
    ]);
  });

  it("honors an explicit empty list", async () => {
    const vault = mkdtempSync(join(tmpdir(), "oa-daily-"));
    await Bun.write(join(vault, SETTINGS_FILE), "dailyNotes: []\n");
    const out = await serializeSettingsForFrontend(vault);
    expect(out.dailyNotes).toEqual([]);
  });
});

// --- concurrent mutation safety ---

describe("concurrent setSettingInFile", () => {
  it("serializes concurrent requests so none clobber each other", async () => {
    const vault = await emptyVault();
    // Set up initial settings with multiple keys
    await writeNote(vault, ".settings/settings.yaml", "appearance:\n  theme: oxide-duotone\n  editorFont: Lora\ngraph:\n  nodeSize: 5\n");

    // Fire 3 concurrent requests that each modify a different key
    const results = await Promise.all([
      setSettingInFile(vault, ["appearance", "theme"], "indigo-oxide"),
      setSettingInFile(vault, ["appearance", "editorFont"], "Georgia"),
      setSettingInFile(vault, ["graph", "nodeSize"], 10),
    ]);

    // All requests should complete successfully
    expect(results).toHaveLength(3);

    // Verify all three changes were persisted (none clobbered)
    const { data } = (await readSettings(vault))!;
    expect((data.appearance as any).theme).toBe("indigo-oxide");
    expect((data.appearance as any).editorFont).toBe("Georgia");
    expect((data.graph as any).nodeSize).toBe(10);
  });

  it("preserves file integrity across concurrent mutations", async () => {
    const vault = await emptyVault();
    const comment = "# important settings\n";
    const custom = "myCustomKey: 42\n";
    await writeNote(vault, ".settings/settings.yaml", `${comment}appearance:\n  theme: oxide-duotone\n${custom}graph:\n  spin: true\n`);

    // Fire multiple concurrent mutations
    await Promise.all([
      setSettingInFile(vault, ["appearance", "theme"], "light"),
      setSettingInFile(vault, ["graph", "spin"], false),
    ]);

    const raw = readFileSync(join(vault, ".settings/settings.yaml"), "utf8");

    // Comments and unknown keys must survive concurrent mutations
    expect(raw).toContain(comment);
    expect(raw).toContain(custom);

    // And the updated values must be present
    const { data } = (await readSettings(vault))!;
    expect((data.appearance as any).theme).toBe("light");
    expect((data.graph as any).spin).toBe(false);
  });

  it("handles high-concurrency scenarios (10+ requests)", async () => {
    const vault = await emptyVault();
    await reconcileSettings(vault); // set up a fresh settings.yaml

    // Fire 20 concurrent mutations to different keys
    const promises = Array.from({ length: 20 }, (_, i) =>
      setSettingInFile(vault, ["graph", "nodeSize"], i),
    );
    await Promise.all(promises);

    // The final value should be one of the submitted values (deterministic last write)
    const { data } = (await readSettings(vault))!;
    const final = (data.graph as any).nodeSize;
    expect(final).toBeGreaterThanOrEqual(0);
    expect(final).toBeLessThan(20);
  });

  it("should handle 100+ concurrent mutations atomically", async () => {
    const vault = await emptyVault();
    await reconcileSettings(vault); // set up a fresh settings.yaml

    // Fire 100 concurrent mutations, each to a different key
    // Using a nested structure to avoid key collisions
    const promises = Array.from({ length: 100 }, (_, i) => {
      const keyPath = ["graph", `testKey${i}`];
      const value = `value_${i}`;
      return setSettingInFile(vault, keyPath, value);
    });

    await Promise.all(promises);

    // Verify all 100 changes persisted correctly
    const { data } = (await readSettings(vault))!;
    const graphData = data.graph as Record<string, unknown>;

    let successCount = 0;
    for (let i = 0; i < 100; i++) {
      const key = `testKey${i}`;
      const expected = `value_${i}`;
      if (graphData[key] === expected) {
        successCount++;
      }
    }

    // All 100 mutations must have persisted successfully
    expect(successCount).toBe(100);
    expect(graphData.nodeSize).toBe(6); // Original field from reconcile must be preserved (schema default)
  });

  it("should not bottleneck under 100+ concurrent mutations with different key paths", async () => {
    const vault = await emptyVault();
    await reconcileSettings(vault); // set up a fresh settings.yaml

    const startTime = Date.now();

    // Fire 150 concurrent mutations across different sections
    const promises = Array.from({ length: 150 }, (_, i) => {
      let keyPath: string[];
      const section = i % 3;
      if (section === 0) {
        keyPath = ["appearance", `concurrKey${i}`];
      } else if (section === 1) {
        keyPath = ["graph", `concurrKey${i}`];
      } else {
        keyPath = ["calendar", `concurrKey${i}`];
      }
      return setSettingInFile(vault, keyPath, i);
    });

    await Promise.all(promises);
    const duration = Date.now() - startTime;

    // Verify all changes persisted
    const { data } = (await readSettings(vault))!;
    let totalPersistedChanges = 0;

    for (let i = 0; i < 150; i++) {
      const section = i % 3;
      const key = `concurrKey${i}`;
      let sectionData: Record<string, unknown>;

      if (section === 0) {
        sectionData = data.appearance as Record<string, unknown>;
      } else if (section === 1) {
        sectionData = data.graph as Record<string, unknown>;
      } else {
        sectionData = data.calendar as Record<string, unknown>;
      }

      if (sectionData[key] === i) {
        totalPersistedChanges++;
      }
    }

    // All 150 mutations must persist
    expect(totalPersistedChanges).toBe(150);
    // Should complete in reasonable time (not severely bottlenecked)
    // Allowing 5s for 150 mutations on typical hardware
    expect(duration).toBeLessThan(5000);
  });
});

describe("reconcileSettings daemon migration (now a no-op)", () => {
  let prevDir: string | undefined;
  let tmpDir: string | undefined;

  afterEach(() => {
    if (prevDir === undefined) delete process.env.BISMUTH_DAEMON_DIR;
    else process.env.BISMUTH_DAEMON_DIR = prevDir;
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ } tmpDir = undefined; }
  });

  // The daemon is bundled now: home is fixed (not a setting) and there is no
  // adopt-on-reconcile. Reconcile fills the new `name` key but never re-adds the
  // obsolete `home`, and never flips `enabled` even when a device is installed.
  it("does NOT adopt (enable) an installed daemon and never writes daemon.home", async () => {
    const vault = await emptyVault();
    await writeNote(vault, ".settings/settings.yaml", "daemon:\n  enabled: false\n");
    prevDir = process.env.BISMUTH_DAEMON_DIR;
    tmpDir = mkdtempSync(join(tmpdir(), "bismuth-daemon-"));
    writeFileSync(join(tmpDir, "device-id"), "dev-x\n"); // looks installed on this machine
    process.env.BISMUTH_DAEMON_DIR = tmpDir;
    await reconcileSettings(vault);
    const res = await readSettings(vault);
    const daemon = (res!.data as any).daemon;
    expect(daemon.enabled).toBe(false);  // no adoption — the master switch stays as written
    expect(daemon.name).toBeUndefined(); // name moved to .daemon/identity.md — not a settings key
    expect(daemon.home).toBeUndefined(); // home is gone — migration never re-adds it
  });
});
