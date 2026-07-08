import { describe, expect, test } from "bun:test";
import { buildEditorContextText } from "./chatEditorContext";

describe("buildEditorContextText", () => {
  test("returns '' when there's no active file and no selection", () => {
    expect(buildEditorContextText({ activeFile: null, openFiles: [], selection: "", hiddenPaths: new Set() })).toBe("");
  });

  test("includes the active file and open tabs when nothing is hidden", () => {
    const text = buildEditorContextText({
      activeFile: "a.md",
      openFiles: [{ path: "a.md", label: "a" }, { path: "b.md", label: "b" }],
      selection: "",
      hiddenPaths: new Set(),
    });
    expect(text).toContain("Active file: a.md");
    expect(text).toContain("Open tabs: a.md, b.md");
  });

  test("drops a hidden active file entirely (falls back to null, not leaked)", () => {
    const text = buildEditorContextText({
      activeFile: "secret.md",
      openFiles: [{ path: "secret.md", label: "secret" }],
      selection: "",
      hiddenPaths: new Set(["secret.md"]),
    });
    expect(text).toBe(""); // nothing left worth telling the model
    expect(text).not.toContain("secret.md");
  });

  test("drops only the hidden file from open tabs, keeps visible siblings", () => {
    const text = buildEditorContextText({
      activeFile: "a.md",
      openFiles: [{ path: "a.md", label: "a" }, { path: "secret.md", label: "secret" }],
      selection: "",
      hiddenPaths: new Set(["secret.md"]),
    });
    expect(text).toContain("Open tabs: a.md");
    expect(text).not.toContain("secret.md");
  });

  test("keeps a chat-only file IN — visibility filtering only drops 'hidden'", () => {
    const text = buildEditorContextText({
      activeFile: "draft.md",
      openFiles: [{ path: "draft.md", label: "draft" }],
      selection: "",
      hiddenPaths: new Set(), // chat-only files are never added to hiddenPaths
    });
    expect(text).toContain("Active file: draft.md");
  });

  test("drops a selection sourced from a hidden file, even if the active file is visible", () => {
    const text = buildEditorContextText({
      activeFile: "a.md",
      openFiles: [{ path: "a.md", label: "a" }],
      selection: "some secret text",
      selectionPath: "secret.md",
      hiddenPaths: new Set(["secret.md"]),
    });
    expect(text).not.toContain("some secret text");
    expect(text).not.toContain("secret.md");
    expect(text).toContain("Active file: a.md");
  });

  test("keeps a selection from a visible file", () => {
    const text = buildEditorContextText({
      activeFile: "a.md",
      openFiles: [{ path: "a.md", label: "a" }],
      selection: "hello world",
      selectionPath: "a.md",
      hiddenPaths: new Set(),
    });
    expect(text).toContain("Current selection (from a.md):");
    expect(text).toContain("hello world");
  });

  // ── Row 79: @-mention / drag references ──────────────────────────────────────────────────────
  test("lists referenced files, and emits a preamble even with no active file / selection", () => {
    const text = buildEditorContextText({
      activeFile: null,
      openFiles: [],
      selection: "",
      hiddenPaths: new Set(),
      referencedFiles: ["Projects/Gamma.md", "assets/diagram.png"],
    });
    expect(text).toContain("Referenced files: Projects/Gamma.md, assets/diagram.png");
  });

  test("drops a hidden referenced file (never leaked into the preamble)", () => {
    const text = buildEditorContextText({
      activeFile: null,
      openFiles: [],
      selection: "",
      hiddenPaths: new Set(["secret.md"]),
      referencedFiles: ["secret.md", "public.md"],
    });
    expect(text).toContain("Referenced files: public.md");
    expect(text).not.toContain("secret.md");
  });

  test("dedupes a referenced file already named as the active file or an open tab", () => {
    const text = buildEditorContextText({
      activeFile: "a.md",
      openFiles: [{ path: "a.md", label: "a" }, { path: "b.md", label: "b" }],
      selection: "",
      hiddenPaths: new Set(),
      referencedFiles: ["a.md", "b.md", "c.md"],
    });
    // a.md (active) + b.md (open tab) drop out; only c.md remains as a distinct reference.
    expect(text).toContain("Referenced files: c.md");
    expect(text).not.toContain("Referenced files: a.md");
  });

  test("no 'Referenced files' line when the only references were deduped/hidden away", () => {
    const text = buildEditorContextText({
      activeFile: "a.md",
      openFiles: [{ path: "a.md", label: "a" }],
      selection: "",
      hiddenPaths: new Set(),
      referencedFiles: ["a.md"],
    });
    expect(text).not.toContain("Referenced files:");
  });
});
