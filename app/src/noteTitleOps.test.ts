import { describe, it, expect } from "bun:test";
import { deriveTitle, renamedPath, sanitizeTitle } from "./noteTitleOps";

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

  // Markdown / path-ish titles are sanitized before becoming a filename.
  it("strips a leading markdown heading marker", () => {
    expect(renamedPath("a/Old.md", "# My Note")).toBe("a/My Note.md");
    expect(renamedPath("a/Old.md", "### Heading")).toBe("a/Heading.md");
  });
  it("does not create nested folders from slashes in the title", () => {
    expect(renamedPath("a/Old.md", "foo/bar")).toBe("a/foo bar.md");
    expect(renamedPath("a/Old.md", "foo\\bar")).toBe("a/foo bar.md");
  });
  it("drops filesystem-illegal characters (and bold/italic asterisks)", () => {
    expect(renamedPath("a/Old.md", "**bold**")).toBe("a/bold.md");
    expect(renamedPath("a/Old.md", 'q: "why?"')).toBe("a/q why.md");
    expect(renamedPath("a/Old.md", "a<b>c|d")).toBe("a/a b c d.md");
  });
  it("returns null when the title is only illegal/markup chars", () => {
    expect(renamedPath("a/Old.md", "***")).toBeNull(); // asterisks are illegal → stripped
    expect(renamedPath("a/Old.md", "///")).toBeNull(); // slashes → spaces → empty
    expect(renamedPath("a/Old.md", '"?"')).toBeNull();
  });
  it("treats an unchanged title as a no-op even after sanitizing", () => {
    expect(renamedPath("a/My Note.md", "# My Note")).toBeNull();
  });
});

describe("sanitizeTitle", () => {
  it("keeps a clean title intact", () => {
    expect(sanitizeTitle("My Note")).toBe("My Note");
  });
  it("strips a leading heading marker and collapses whitespace", () => {
    expect(sanitizeTitle("##   Spaced  Out")).toBe("Spaced Out");
  });
  it("replaces path separators with a space rather than nesting", () => {
    expect(sanitizeTitle("a/b\\c")).toBe("a b c");
  });
  it("drops leading dots so it can't become a hidden file", () => {
    expect(sanitizeTitle("...secret")).toBe("secret");
  });
  it("returns empty when nothing legal remains", () => {
    expect(sanitizeTitle("**")).toBe("");
    expect(sanitizeTitle("   ")).toBe("");
  });
});
