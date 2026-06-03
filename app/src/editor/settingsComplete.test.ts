// app/src/editor/settingsComplete.test.ts
import { describe, expect, it } from "bun:test";
import { rangeLabel, docInfo, dailyNoteIdsFromDoc } from "./settingsComplete";
import type { SchemaEntry } from "../../../core/src/schema/types";

describe("rangeLabel", () => {
  it("renders a numeric min–max range", () => {
    expect(rangeLabel({ type: "number", min: 11, max: 28 } as SchemaEntry)).toBe("11–28");
  });
  it("renders enum members joined by ' | '", () => {
    expect(rangeLabel({ type: { kind: "enum", values: ["dark", "light"] } } as SchemaEntry)).toBe("dark | light");
  });
  it("is empty for a plain boolean/string with no bounds", () => {
    expect(rangeLabel({ type: "boolean" } as SchemaEntry)).toBe("");
    expect(rangeLabel({ type: "string" } as SchemaEntry)).toBe("");
  });
  it("renders a one-sided numeric bound", () => {
    expect(rangeLabel({ type: "number", min: 0 } as SchemaEntry)).toBe("≥0");
    expect(rangeLabel({ type: "number", max: 10 } as SchemaEntry)).toBe("≤10");
  });
});

describe("docInfo", () => {
  it("returns the doc string", () => {
    expect(docInfo({ type: "number", doc: "Editor font size (px)." } as SchemaEntry)).toBe("Editor font size (px).");
  });
  it("returns empty string when no doc", () => {
    expect(docInfo({ type: "number" } as SchemaEntry)).toBe("");
  });
});

import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { settingsCompletionSource, rankPaths, type VaultPath } from "./settingsComplete";
import { SETTINGS_SCHEMA } from "../../../core/src/schema/settingsSchema";

const TEST_TREE: VaultPath[] = [
  { path: "Notes", kind: "dir" },
  { path: "Daily Notes", kind: "dir" },
  { path: "Projects", kind: "dir" },
  { path: "Projects/Alpha", kind: "dir" },
  { path: "Templates", kind: "dir" },
  { path: "Templates/Journal.md", kind: "file" },
  { path: "welcome.md", kind: "file" },
];

/** Drive the completion source at the end of `doc` (cursor at the last char). */
function complete(doc: string, explicit = true) {
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, explicit);
  return settingsCompletionSource(
    () => SETTINGS_SCHEMA,
    () => ["FilePlus", "FolderPlus", "Bug", "Settings"],
    () => ["Templates/Journal.md", "Templates/Meeting.md"],
    () => TEST_TREE,
  )(ctx);
}

describe("settings completion inside a toolbar list item", () => {
  it("completes command ids after `- command:`", () => {
    const res = complete("toolbar:\n  - command: term");
    const labels = res?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("terminal");
  });

  it("shows the command label as detail", () => {
    const res = complete("toolbar:\n  - command: term");
    const opt = res?.options.find((o) => o.label === "terminal");
    expect(opt?.detail).toBe("Open Terminal");
  });

  it("completes icon names after `icon:` inside a toolbar item", () => {
    const res = complete("toolbar:\n  - command: terminal\n    icon: File");
    const labels = res?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("FilePlus");
    expect(labels).not.toContain("Bug");
  });

  it("completes the item field keys (command/commands/icon/tooltip)", () => {
    const res = complete("toolbar:\n  - comm");
    const labels = res?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("command");
    expect(labels).toContain("commands");
  });

  it("completes command ids for a scalar item under a `commands:` list", () => {
    const res = complete("toolbar:\n  - commands:\n      - term");
    const labels = res?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("terminal");
  });

  it("shows the command label as detail inside a `commands:` list", () => {
    const res = complete("toolbar:\n  - commands:\n      - term");
    const opt = res?.options.find((o) => o.label === "terminal");
    expect(opt?.detail).toBe("Open Terminal");
  });

  it("does not offer schema keys for a bare item under `commands:`", () => {
    const res = complete("toolbar:\n  - commands:\n      - ");
    const labels = res?.options.map((o) => o.label) ?? [];
    // should be command ids, not toolbar field keys
    expect(labels).not.toContain("icon");
    expect(labels).toContain("new-note");
  });
});

describe("dailyNoteIdsFromDoc", () => {
  it("extracts ids + labels from a dailyNotes block", () => {
    const doc = ["dailyNotes:", "  - id: journal", "    label: Journal", "  - id: work", "toolbar: []"].join("\n");
    expect(dailyNoteIdsFromDoc(doc)).toEqual([
      { id: "journal", label: "Journal" },
      { id: "work", label: "" },
    ]);
  });
  it("returns [] for absent or malformed YAML", () => {
    expect(dailyNoteIdsFromDoc("toolbar: []")).toEqual([]);
    expect(dailyNoteIdsFromDoc("dailyNotes: : :")).toEqual([]);
  });
});

describe("daily-note settings completion", () => {
  // A document with one configured daily note, so the command value can reference it.
  const withJournal = (tail: string) =>
    ["dailyNotes:", "  - id: journal", "    label: Journal", "    fileName: \"{{date}} journal\"", tail].join("\n");

  it("offers daily-note:<id> after a toolbar `- command:` value", () => {
    const res = complete(withJournal("toolbar:\n  - command: daily-note:"));
    const labels = res?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("daily-note:journal");
    const opt = res?.options.find((o) => o.label === "daily-note:journal");
    expect(opt?.detail).toBe("Journal"); // the config's label
  });

  it("still offers static catalog command ids alongside daily-note ids", () => {
    const res = complete(withJournal("toolbar:\n  - command: term"));
    const labels = res?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("terminal");
  });

  it("offers {{ template tokens inside a dailyNotes fileName value", () => {
    const res = complete("dailyNotes:\n  - id: journal\n    fileName: \"{{da");
    const labels = res?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("{{date}}");
  });

  it("offers template paths for a dailyNotes template value", () => {
    const res = complete("dailyNotes:\n  - id: journal\n    fileName: x\n    template: Templ");
    const labels = res?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("Templates/Journal.md");
  });
});

describe("rankPaths", () => {
  it("returns all candidates for an empty query", () => {
    expect(rankPaths(TEST_TREE, "")).toEqual(TEST_TREE);
  });

  it("matches case-insensitively (lowercase query finds a Capitalized path)", () => {
    // The exact regression: typing 'notes' must surface 'Notes' (and 'Daily Notes').
    const out = rankPaths(TEST_TREE, "notes").map((e) => e.path);
    expect(out).toContain("Notes");
    expect(out).toContain("Daily Notes");
  });

  it("ranks full-path prefix before basename prefix before substring", () => {
    const out = rankPaths(TEST_TREE, "templates").map((e) => e.path);
    expect(out.slice(0, 2)).toEqual(["Templates", "Templates/Journal.md"]);
  });

  it("matches a nested path by its last segment (basename)", () => {
    expect(rankPaths(TEST_TREE, "jour").map((e) => e.path)).toEqual(["Templates/Journal.md"]);
  });

  it("matches a path containing a space across the space", () => {
    expect(rankPaths(TEST_TREE, "daily no").map((e) => e.path)).toEqual(["Daily Notes"]);
  });

  it("yields an empty list when nothing matches", () => {
    expect(rankPaths(TEST_TREE, "zzz")).toEqual([]);
  });
});

describe("path-typed value completion", () => {
  it("completes folders only for a dailyNotes `folder:` (dir-scoped path)", () => {
    const res = complete("dailyNotes:\n  - id: journal\n    folder: no");
    const labels = res?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("Notes");        // lowercase query → Capitalized dir
    expect(labels).toContain("Daily Notes");  // folder name with a space
    expect(labels).not.toContain("welcome.md"); // files excluded by only:"dir"
  });

  it("tags folder rows with a Folder icon and is unfiltered (filter:false)", () => {
    const res = complete("dailyNotes:\n  - id: journal\n    folder: no");
    expect(res?.filter).toBe(false);
    const opt = res?.options.find((o) => o.label === "Notes") as { lucideIcon?: string } | undefined;
    expect(opt?.lucideIcon).toBe("Folder");
  });

  it("offers an 'Open icon gallery' action plus per-row icons for an icon field", () => {
    const res = complete("toolbar:\n  - command: terminal\n    icon: File");
    const opts = res?.options ?? [];
    expect(opts[0]?.label).toBe("Open icon gallery");
    expect((opts[0] as { lucideIcon?: string }).lucideIcon).toBe("Grip");
    const fileOpt = opts.find((o) => o.label === "FilePlus") as { lucideIcon?: string } | undefined;
    expect(fileOpt?.lucideIcon).toBe("FilePlus"); // each row shows its own icon
  });
});
