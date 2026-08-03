// core/test/upgrade/settingsUpgrade.test.ts
//
// UPGRADE SAFETY: what happens to a REAL user's persisted state when they update Bismuth.
//
// Every other settings test starts from a vault this era's code just created. These start from a
// vault an OLDER Bismuth wrote, and assert the one property that matters across a version jump:
// the user's own data survives. A settings regression is uniquely nasty because it is silent —
// the app still boots, it just boots as if the user had never configured anything.
//
// The three layouts below are real historical shapes, not hypotheticals (see
// core/src/settings.ts's migrateSettingsLocation):
//   1. vault-root `settings.yaml`      — the original
//   2. `.settings/settings.yaml` (DIR) — an interim layout
//   3. `.settings` (FILE)              — current
// migrateSettingsLocation had NO test coverage before this file, despite its own comment noting
// that a failed move "silently resets the vault to defaults".
import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, statSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SETTINGS_FILE,
  LEGACY_SETTINGS_FILE,
  migrateSettingsLocation,
  reconcileSettings,
  readSettings,
  serializeSettingsForFrontend,
} from "../../src/settings";

function emptyVault(): string {
  return mkdtempSync(join(tmpdir(), "bismuth-upgrade-"));
}

/** A settings file as a PRE-REDESIGN Bismuth would have written it: legacy theme + serif editor
 *  font, a hand-written comment, a key this era's schema no longer knows, and only a fraction of
 *  today's keys. Deliberately not generated from the current schema — the whole point is that it
 *  is stale. */
const OLD_ERA_SETTINGS = `# my own notes about this vault — must survive the upgrade
appearance:
  theme: rose-gold
  editorFont: Lora
  editorFontSize: 17
  accent: "#ff8800"
editor:
  autoSaveDelay: 1500
  # a comment nested inside a section
  defaultMode: source
graph:
  spin: false
aVanishedSection:
  someKeyNoCurrentSchemaKnows: keep-me
`;

describe("file-location migration (three historical layouts)", () => {
  test("a vault-root settings.yaml is moved to .settings with its contents intact", () => {
    const vault = emptyVault();
    writeFileSync(join(vault, LEGACY_SETTINGS_FILE), OLD_ERA_SETTINGS);

    migrateSettingsLocation(vault);

    const next = join(vault, SETTINGS_FILE);
    expect(existsSync(next)).toBe(true);
    expect(statSync(next).isFile()).toBe(true);
    // Byte-for-byte: the move must not reformat or drop anything.
    expect(readFileSync(next, "utf8")).toBe(OLD_ERA_SETTINGS);
    rmSync(vault, { recursive: true, force: true });
  });

  test("the interim .settings/settings.yaml DIRECTORY is collapsed into a .settings FILE", () => {
    const vault = emptyVault();
    mkdirSync(join(vault, ".settings"));
    writeFileSync(join(vault, ".settings", "settings.yaml"), OLD_ERA_SETTINGS);

    migrateSettingsLocation(vault);

    const next = join(vault, SETTINGS_FILE);
    expect(existsSync(next)).toBe(true);
    // A dir and a file cannot share the name, so this must end as a FILE, not a surviving dir.
    expect(statSync(next).isFile()).toBe(true);
    expect(readFileSync(next, "utf8")).toBe(OLD_ERA_SETTINGS);
    rmSync(vault, { recursive: true, force: true });
  });

  test("an already-current .settings file is left exactly alone (no re-migration)", () => {
    const vault = emptyVault();
    writeFileSync(join(vault, SETTINGS_FILE), OLD_ERA_SETTINGS);
    // A stale legacy file sitting alongside must NOT overwrite the current one.
    writeFileSync(join(vault, LEGACY_SETTINGS_FILE), "appearance:\n  theme: stale-loser\n");

    migrateSettingsLocation(vault);

    expect(readFileSync(join(vault, SETTINGS_FILE), "utf8")).toBe(OLD_ERA_SETTINGS);
    rmSync(vault, { recursive: true, force: true });
  });

  test("migration is idempotent — running it repeatedly never degrades the file", () => {
    const vault = emptyVault();
    writeFileSync(join(vault, LEGACY_SETTINGS_FILE), OLD_ERA_SETTINGS);

    migrateSettingsLocation(vault);
    const afterFirst = readFileSync(join(vault, SETTINGS_FILE), "utf8");
    migrateSettingsLocation(vault);
    migrateSettingsLocation(vault);

    expect(readFileSync(join(vault, SETTINGS_FILE), "utf8")).toBe(afterFirst);
    rmSync(vault, { recursive: true, force: true });
  });

  test("a vault with no settings at all is not given one by the location migration alone", () => {
    const vault = emptyVault();
    migrateSettingsLocation(vault);
    // Seeding defaults is reconcile's job, not the mover's — the mover must not invent a file.
    expect(existsSync(join(vault, SETTINGS_FILE))).toBe(false);
    rmSync(vault, { recursive: true, force: true });
  });
});

describe("upgrading an old-era settings file through reconcile", () => {
  /** Put an old-era vault-root settings.yaml in place and run the real open-path upgrade. */
  async function upgradeOldVault(): Promise<{ vault: string; text: string }> {
    const vault = emptyVault();
    writeFileSync(join(vault, LEGACY_SETTINGS_FILE), OLD_ERA_SETTINGS);
    await reconcileSettings(vault); // reconcile calls migrateSettingsLocation itself
    return { vault, text: readFileSync(join(vault, SETTINGS_FILE), "utf8") };
  }

  test("the user's own still-valid values survive the upgrade", async () => {
    const { vault, text } = await upgradeOldVault();
    const data = (await readSettings(vault))!.data as Record<string, Record<string, unknown>>;

    expect(data.editor.autoSaveDelay).toBe(1500);
    expect(data.editor.defaultMode).toBe("source");
    expect(data.graph.spin).toBe(false);
    expect(data.appearance.accent).toBe("#ff8800");
    expect(text).toContain("1500");
    rmSync(vault, { recursive: true, force: true });
  });

  test("hand-written comments survive the upgrade", async () => {
    const { vault, text } = await upgradeOldVault();
    expect(text).toContain("# my own notes about this vault — must survive the upgrade");
    expect(text).toContain("# a comment nested inside a section");
    rmSync(vault, { recursive: true, force: true });
  });

  test("keys this era's schema no longer knows are PRESERVED, never silently dropped", async () => {
    const { vault, text } = await upgradeOldVault();
    // Data loss is the one unforgivable upgrade outcome: an unrecognised key might belong to a
    // newer Bismuth (a user downgrading) or to a feature that is coming back.
    expect(text).toContain("aVanishedSection");
    expect(text).toContain("keep-me");
    rmSync(vault, { recursive: true, force: true });
  });

  test("keys added to the schema SINCE the old version are seeded with their defaults", async () => {
    const { vault } = await upgradeOldVault();
    const data = (await readSettings(vault))!.data as Record<string, unknown>;
    // The old file had four sections; today's schema has many more. Every schema top-level key
    // must be present after reconcile, or the app reads undefined for a setting it relies on.
    const { SETTINGS_SCHEMA } = await import("../../src/schema/settingsSchema");
    for (const key of Object.keys(SETTINGS_SCHEMA)) {
      expect(data).toHaveProperty(key);
    }
    rmSync(vault, { recursive: true, force: true });
  });

  test("legacy theme + serif editor font are migrated to current-era values", async () => {
    const { vault } = await upgradeOldVault();
    const appearance = (await serializeSettingsForFrontend(vault)).appearance as Record<string, unknown>;
    expect(appearance.theme).toBe("ink"); // "rose-gold" is a retired dark theme
    expect(appearance.editorFont).toBe("Monaspace Xenon"); // "Lora" is a retired serif
    rmSync(vault, { recursive: true, force: true });
  });

  test("reconcile is idempotent — a second upgrade pass changes nothing", async () => {
    const { vault, text } = await upgradeOldVault();
    await reconcileSettings(vault);
    expect(readFileSync(join(vault, SETTINGS_FILE), "utf8")).toBe(text);
    rmSync(vault, { recursive: true, force: true });
  });
});

describe("upgrade resilience — a damaged or hostile old file must not make things worse", () => {
  test("a corrupt settings file is left untouched for the user to fix, not overwritten", async () => {
    const vault = emptyVault();
    const corrupt = "appearance:\n  theme: [unclosed\n   nope: : :\n";
    writeFileSync(join(vault, SETTINGS_FILE), corrupt);

    await reconcileSettings(vault);

    // Silently replacing this with defaults would destroy a config the user can still repair.
    expect(readFileSync(join(vault, SETTINGS_FILE), "utf8")).toBe(corrupt);
    rmSync(vault, { recursive: true, force: true });
  });

  test("out-of-range and wrong-typed values degrade to defaults at READ time without rewriting the file", async () => {
    const vault = emptyVault();
    const hostile = "appearance:\n  editorFontSize: 9999\n  theme: not-a-real-theme\n  accent: 12345\n";
    writeFileSync(join(vault, SETTINGS_FILE), hostile);

    const data = await serializeSettingsForFrontend(vault);
    const appearance = data.appearance as Record<string, unknown>;
    const { SETTINGS_SCHEMA } = await import("../../src/schema/settingsSchema");
    const fields = (SETTINGS_SCHEMA.appearance.type as { kind: "object"; fields: Record<string, { default?: unknown }> }).fields;

    // Read-time degradation keeps the app usable; it must not silently rewrite the user's file.
    expect(appearance.editorFontSize).toBe(fields.editorFontSize.default);
    expect(appearance.theme).toBe(fields.theme.default);
    expect(readFileSync(join(vault, SETTINGS_FILE), "utf8")).toBe(hostile);
    rmSync(vault, { recursive: true, force: true });
  });

  test("an empty settings file does not throw and does not lose the file", async () => {
    const vault = emptyVault();
    writeFileSync(join(vault, SETTINGS_FILE), "");
    await reconcileSettings(vault);
    expect(existsSync(join(vault, SETTINGS_FILE))).toBe(true);
    rmSync(vault, { recursive: true, force: true });
  });
});
