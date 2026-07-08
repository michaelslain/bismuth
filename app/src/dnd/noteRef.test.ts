// app/src/dnd/noteRef.test.ts
import { describe, it, expect } from "bun:test";
import {
  isMarkdown,
  noteNameFromPath,
  wikilinkFor,
  descriptorMovePath,
  descriptorNotePath,
} from "./noteRef";
import type { DragDescriptor } from "./viewDrag";

describe("isMarkdown", () => {
  it("accepts .md / .markdown case-insensitively", () => {
    expect(isMarkdown("Beta.md")).toBe(true);
    expect(isMarkdown("Notes/Deep/Thing.MD")).toBe(true);
    expect(isMarkdown("readme.markdown")).toBe(true);
  });
  it("rejects non-markdown files and folders", () => {
    expect(isMarkdown("Budget.sheet")).toBe(false);
    expect(isMarkdown("Sketch.draw")).toBe(false);
    expect(isMarkdown("Projects")).toBe(false);
    expect(isMarkdown("notes.md.bak")).toBe(false);
  });
});

describe("noteNameFromPath", () => {
  it("strips folders and the markdown extension (wikilinks resolve by filename)", () => {
    expect(noteNameFromPath("Projects/Gamma.md")).toBe("Gamma");
    expect(noteNameFromPath("Beta.md")).toBe("Beta");
    expect(noteNameFromPath("a/b/c/Deep Note.markdown")).toBe("Deep Note");
  });
  it("keeps a non-markdown basename intact", () => {
    expect(noteNameFromPath("Budget.sheet")).toBe("Budget.sheet");
  });
});

describe("wikilinkFor", () => {
  it("wraps the note name in [[ ]]", () => {
    expect(wikilinkFor("Projects/Gamma.md")).toBe("[[Gamma]]");
    expect(wikilinkFor("Beta.md")).toBe("[[Beta]]");
  });
});

const note = (path: string): DragDescriptor => ({ kind: "note", path, label: path, width: 10 });
const folder = (path: string): DragDescriptor => ({ kind: "folder", path, label: path, width: 10 });
const tab = (path?: string): DragDescriptor => ({ kind: "tab", tabId: "t1", label: "T", width: 10, path });
const pane = (path?: string): DragDescriptor => ({ kind: "pane", tabId: "t1", leafId: "l1", label: "P", width: 10, path });

describe("descriptorMovePath", () => {
  it("returns the path for notes, folders, and path-backed tabs/panes", () => {
    expect(descriptorMovePath(note("Beta.md"))).toBe("Beta.md");
    expect(descriptorMovePath(folder("Archive"))).toBe("Archive");
    expect(descriptorMovePath(tab("Beta.md"))).toBe("Beta.md");
    expect(descriptorMovePath(pane("x/Gamma.md"))).toBe("x/Gamma.md");
  });
  it("returns null for a pathless tab/pane (chat/terminal/graph) and for null", () => {
    expect(descriptorMovePath(tab(undefined))).toBeNull();
    expect(descriptorMovePath(pane(undefined))).toBeNull();
    expect(descriptorMovePath(null)).toBeNull();
  });
});

describe("descriptorNotePath", () => {
  it("returns a markdown note path from notes and note-backed tabs/panes", () => {
    expect(descriptorNotePath(note("Beta.md"))).toBe("Beta.md");
    expect(descriptorNotePath(tab("Projects/Gamma.md"))).toBe("Projects/Gamma.md");
    expect(descriptorNotePath(pane("Beta.md"))).toBe("Beta.md");
  });
  it("returns null for folders, non-markdown files, and pathless descriptors", () => {
    expect(descriptorNotePath(folder("Archive"))).toBeNull();
    expect(descriptorNotePath(note("Budget.sheet"))).toBeNull();
    expect(descriptorNotePath(tab(undefined))).toBeNull();
    expect(descriptorNotePath(null)).toBeNull();
  });
});
