// app/src/tabIds.test.ts
import { test, expect, describe } from "bun:test";
import { EXPORT_PREFIX, SETTINGS_FILE, isSettingsFile, contentLabel, contentIcon, isSentinel } from "./tabIds";

describe("export tab id", () => {
  test("EXPORT_PREFIX is a sentinel", () => {
    expect(isSentinel(EXPORT_PREFIX + "a/b/note.md")).toBe(true);
  });
  test("label is 'Export: <name>'", () => {
    expect(contentLabel(EXPORT_PREFIX + "a/b/note.md")).toBe("Export: note");
    expect(contentLabel(EXPORT_PREFIX + "Reading.md")).toBe("Export: Reading");
  });
  test("icon is Download", () => {
    expect(contentIcon(EXPORT_PREFIX + "a/note.md")).toBe("Download");
  });
});

describe("settings.yaml is a first-class app tab", () => {
  test("isSettingsFile matches root and nested settings.yaml", () => {
    expect(isSettingsFile(SETTINGS_FILE)).toBe(true);
    expect(isSettingsFile("sub/dir/settings.yaml")).toBe(true);
    expect(isSettingsFile("settings.md")).toBe(false);
    expect(isSettingsFile("mysettings.yaml")).toBe(false);
  });
  test("label is 'settings' (no extension)", () => {
    expect(contentLabel(SETTINGS_FILE)).toBe("settings");
    expect(contentLabel("sub/settings.yaml")).toBe("settings");
  });
  test("icon is the gear (Settings)", () => {
    expect(contentIcon(SETTINGS_FILE)).toBe("Settings");
  });
  test("other yaml/app files drop their extension in the label", () => {
    expect(contentLabel("config.yaml")).toBe("config");
    expect(contentLabel("notes/todo.yml")).toBe("todo");
    expect(contentLabel("Sketch.draw")).toBe("Sketch");
    expect(contentLabel("Budget.sheet")).toBe("Budget");
  });
});
