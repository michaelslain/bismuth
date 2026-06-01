// app/src/editor/settingsComplete.test.ts
import { describe, expect, it } from "bun:test";
import { rangeLabel, docInfo } from "./settingsComplete";
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
import { settingsCompletionSource } from "./settingsComplete";
import { SETTINGS_SCHEMA } from "../../../core/src/schema/settingsSchema";

/** Drive the completion source at the end of `doc` (cursor at the last char). */
function complete(doc: string, explicit = true) {
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, explicit);
  return settingsCompletionSource(() => SETTINGS_SCHEMA, () => ["FilePlus", "FolderPlus", "Bug", "Settings"])(ctx);
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
