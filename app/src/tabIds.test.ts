// app/src/tabIds.test.ts
import { test, expect, describe } from "bun:test";
import { EXPORT_PREFIX, SETTINGS_FILE, ANNOTATE_PREFIX, annotatePath, isSettingsFile, contentLabel, contentIcon, isSentinel } from "./tabIds";

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

describe(".settings is a first-class app tab", () => {
  test("isSettingsFile matches the root .settings (and a nested one)", () => {
    expect(SETTINGS_FILE).toBe(".settings");
    expect(isSettingsFile(SETTINGS_FILE)).toBe(true);
    expect(isSettingsFile("sub/dir/.settings")).toBe(true);
    expect(isSettingsFile("settings.yaml")).toBe(false); // the legacy name is no longer the settings file
    expect(isSettingsFile("notes/my.settings")).toBe(false);
  });
  test("label is 'settings' (no extension)", () => {
    expect(contentLabel(SETTINGS_FILE)).toBe("settings");
    expect(contentLabel("sub/.settings")).toBe("settings");
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

describe("preview tabs (images / PDFs / code / binary)", () => {
  test("plain preview paths keep their filename (with extension) as the label", () => {
    expect(contentLabel("attachments/diagram.png")).toBe("diagram.png");
    expect(contentLabel("docs/spec.pdf")).toBe("spec.pdf");
    expect(contentLabel("src/main.ts")).toBe("main.ts");
  });
  test("kind-specific tab icons", () => {
    expect(contentIcon("a/b/photo.png")).toBe("Image");
    expect(contentIcon("a/b/doc.pdf")).toBe("FileText");
    expect(contentIcon("a/b/app.ts")).toBe("Code");
    expect(contentIcon("a/b/art.psd")).toBe("File");
    expect(contentIcon("a/b/Note.md")).toBeUndefined(); // notes keep the default (no icon)
  });
});

describe("annotate (markup) tab id", () => {
  test("ANNOTATE_PREFIX is a sentinel; annotatePath composes it", () => {
    expect(annotatePath("photo.png")).toBe(ANNOTATE_PREFIX + "photo.png");
    expect(isSentinel(annotatePath("photo.png"))).toBe(true);
  });
  test("label is the bare filename (with extension)", () => {
    expect(contentLabel(annotatePath("a/b/photo.png"))).toBe("photo.png");
    expect(contentLabel(annotatePath("doc.pdf"))).toBe("doc.pdf");
  });
  test("icon is the pen (markup surface), NOT the preview image icon", () => {
    expect(contentIcon(annotatePath("photo.png"))).toBe("PenTool");
  });
});
