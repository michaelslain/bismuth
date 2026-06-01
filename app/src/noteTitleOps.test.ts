import { describe, it, expect } from "bun:test";
import { deriveTitle, renamedPath } from "./noteTitleOps";

describe("deriveTitle", () => {
  it("strips folder and .md extension", () => {
    expect(deriveTitle("reading/quotes/My Note.md")).toBe("My Note");
  });
  it("handles a top-level note", () => {
    expect(deriveTitle("Hello.md")).toBe("Hello");
  });
  it("is case-insensitive on the extension", () => {
    expect(deriveTitle("a/b.MD")).toBe("b");
  });
  it("leaves a name with no extension intact", () => {
    expect(deriveTitle("plain")).toBe("plain");
  });
});

describe("renamedPath", () => {
  it("preserves folder and re-applies .md", () => {
    expect(renamedPath("reading/Old.md", "New Title")).toBe("reading/New Title.md");
  });
  it("preserves a top-level note's (empty) folder", () => {
    expect(renamedPath("Old.md", "New")).toBe("New.md");
  });
  it("trims surrounding whitespace before renaming", () => {
    expect(renamedPath("a/Old.md", "  Trimmed  ")).toBe("a/Trimmed.md");
  });
  it("returns null for an empty title", () => {
    expect(renamedPath("a/Old.md", "")).toBeNull();
  });
  it("returns null for a whitespace-only title", () => {
    expect(renamedPath("a/Old.md", "   ")).toBeNull();
  });
  it("returns null when the title is unchanged", () => {
    expect(renamedPath("a/Old.md", "Old")).toBeNull();
  });
});
