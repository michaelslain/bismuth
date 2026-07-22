import { expect, test, describe } from "bun:test";
import {
  baseName,
  isImagePath,
  isImageFile,
  imageEmbed,
  attachmentTarget,
  appendEmbedToValue,
  markdownDropTarget,
} from "./kanbanImageDrop";

describe("baseName", () => {
  test("posix + windows separators", () => {
    expect(baseName("/Users/me/Desktop/photo.png")).toBe("photo.png");
    expect(baseName("C:\\Users\\me\\photo.png")).toBe("photo.png");
    expect(baseName("photo.png")).toBe("photo.png");
    expect(baseName("a/b\\c/d.jpg")).toBe("d.jpg");
  });
});

describe("isImagePath", () => {
  test("accepts known image extensions, case-insensitive", () => {
    for (const p of ["a.png", "a.JPG", "a.jpeg", "b/c.gif", "d.webp", "e.svg", "f.avif", "g.bmp", "h.ico"]) {
      expect(isImagePath(p)).toBe(true);
    }
  });
  test("rejects non-images and extension-less paths", () => {
    for (const p of ["a.pdf", "a.mp4", "a.txt", "a.md", "noext", "/dir/", "a.docx"]) {
      expect(isImagePath(p)).toBe(false);
    }
  });
});

describe("isImageFile", () => {
  test("MIME first", () => {
    expect(isImageFile({ name: "x", type: "image/png" })).toBe(true);
    expect(isImageFile({ name: "x.txt", type: "text/plain" })).toBe(false);
  });
  test("extension fallback for empty MIME", () => {
    expect(isImageFile({ name: "photo.PNG", type: "" })).toBe(true);
    expect(isImageFile({ name: "doc.pdf", type: "" })).toBe(false);
  });
});

describe("imageEmbed", () => {
  test("wraps a basename as a wikilink embed", () => {
    expect(imageEmbed("photo.png")).toBe("![[photo.png]]");
  });
});

describe("attachmentTarget", () => {
  test("named folder", () => {
    expect(attachmentTarget("attachments", "a.png", "board/card.md")).toBe("attachments/a.png");
  });
  test("empty folder = vault root", () => {
    expect(attachmentTarget("", "a.png", "board/card.md")).toBe("a.png");
  });
  test('"." = the card note\'s own folder', () => {
    expect(attachmentTarget(".", "a.png", "board/sub/card.md")).toBe("board/sub/a.png");
    expect(attachmentTarget(".", "a.png", "card.md")).toBe("a.png"); // note at vault root
    expect(attachmentTarget(".", "a.png", null)).toBe("a.png");
  });
  test("strips stray leading/trailing slashes on the folder", () => {
    expect(attachmentTarget("/attachments/", "a.png", "x.md")).toBe("attachments/a.png");
  });
});

describe("appendEmbedToValue", () => {
  test("appends to existing description prose with a blank-line boundary", () => {
    expect(appendEmbedToValue("Some description text.", "![[photo.png]]")).toBe(
      "Some description text.\n\n![[photo.png]]",
    );
  });
  test("empty description becomes just the embed", () => {
    expect(appendEmbedToValue("", "![[a.png]]")).toBe("![[a.png]]");
    expect(appendEmbedToValue("   \n\n", "![[a.png]]")).toBe("![[a.png]]");
  });
  test("multi-embed block stays on consecutive lines", () => {
    expect(appendEmbedToValue("body", "![[a.png]]\n![[b.png]]")).toBe("body\n\n![[a.png]]\n![[b.png]]");
  });
  test("collapses pre-existing trailing whitespace to one blank line", () => {
    expect(appendEmbedToValue("body\n\n\n", "![[a.png]]")).toBe("body\n\n![[a.png]]");
  });
  // The value is written into YAML frontmatter and must match what the modal's Milkdown surface
  // serializes (createDocEditor.normalizeTrailing strips trailing newlines) — otherwise a card's
  // description would differ depending on WHERE the image was dropped.
  test("never emits a trailing newline (frontmatter round-trip parity)", () => {
    expect(appendEmbedToValue("body", "![[a.png]]").endsWith("\n")).toBe(false);
    expect(appendEmbedToValue("", "![[a.png]]").endsWith("\n")).toBe(false);
  });
  test("tolerates a nullish value (an unset description property)", () => {
    expect(appendEmbedToValue(undefined as unknown as string, "![[a.png]]")).toBe("![[a.png]]");
  });
});

describe("markdownDropTarget", () => {
  const writable = (id: string) => !id.startsWith("file.");
  const kinds: Record<string, { kind: string }> = {
    "file.name": { kind: "text" },
    status: { kind: "select" },
    description: { kind: "markdown" },
    notes: { kind: "markdown" },
  };
  const kindOf = (id: string) => kinds[id] ?? { kind: "text" };

  test("picks the first writable markdown property", () => {
    expect(markdownDropTarget(["status", "description", "notes"], kindOf, writable)).toBe("description");
  });
  test("skips non-markdown properties", () => {
    expect(markdownDropTarget(["status"], kindOf, writable)).toBe(null);
  });
  test("skips a read-only (file./formula.) column even if markdown-kind", () => {
    expect(markdownDropTarget(["file.name"], () => ({ kind: "markdown" }), writable)).toBe(null);
  });
  test("no columns at all → nowhere visible to drop", () => {
    expect(markdownDropTarget([], kindOf, writable)).toBe(null);
  });
});
