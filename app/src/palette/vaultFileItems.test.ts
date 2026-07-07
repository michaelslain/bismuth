import { describe, expect, test } from "bun:test";
import { vaultFileItems } from "./vaultFileItems";
import type { TreeEntry } from "../../../core/src/graph";

// A `.settings`-shaped tree entry (as `listTree` emits it: a hidden, extensionless FILE).
const entry = (path: string, extra: Partial<TreeEntry> = {}): TreeEntry => ({
  path,
  kind: "file",
  ...extra,
});

describe("vaultFileItems", () => {
  test("includes the REAL hidden .settings file, clearly labeled as Settings", () => {
    // Regression: `.settings` is extensionless, so the old OPENABLE_EXTS filter dropped it —
    // the real settings file (the one with schema autocomplete) was unreachable via Cmd+O.
    const items = vaultFileItems([
      entry(".settings", { label: "settings", icon: "Settings2" }),
      entry("note.md"),
    ]);
    const settings = items.find((i) => i.id === ".settings");
    expect(settings).toBeDefined();
    expect(settings!.label).toBe("Settings");
    expect(settings!.icon).toBe("Settings");
  });

  test("the real Settings file is distinguishable from a random settings.yaml note", () => {
    const items = vaultFileItems([
      entry(".settings"),
      entry("geoguessr/settings.yaml"),
    ]);
    const real = items.find((i) => i.id === ".settings")!;
    const note = items.find((i) => i.id === "geoguessr/settings.yaml")!;
    // Real settings: capital "Settings" + descriptive sublabel + gear icon.
    expect(real.label).toBe("Settings");
    expect(real.sublabel).toBe("App configuration");
    // The note stays a normal note row: label "settings" (extension stripped), folder as sublabel.
    expect(note.label).not.toBe("Settings");
    expect(note.sublabel).toBe("geoguessr");
  });

  test("excludes folders and internal .daemon files", () => {
    const ids = vaultFileItems([
      { path: "folder", kind: "dir" },
      entry(".daemon/memory/settings.yaml"),
      entry("keep.md"),
    ]).map((i) => i.id);
    expect(ids).toEqual(["keep.md"]);
  });

  test("keeps normal openable files (notes, sheets, drawings, yaml)", () => {
    const ids = vaultFileItems([
      entry("a.md"),
      entry("b.sheet"),
      entry("c.draw"),
      entry("d.yaml"),
      entry("skip.png"),
    ]).map((i) => i.id);
    expect(ids).toEqual(["a.md", "b.sheet", "c.draw", "d.yaml"]);
  });
});
