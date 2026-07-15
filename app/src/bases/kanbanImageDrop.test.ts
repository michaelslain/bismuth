import { expect, test, describe } from "bun:test";
import {
  baseName,
  isImagePath,
  isImageFile,
  imageEmbed,
  attachmentTarget,
  appendEmbedToNote,
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

describe("appendEmbedToNote", () => {
  test("appends after frontmatter+body with a blank-line boundary", () => {
    const note = "---\ntitle: Card\n---\nSome body text.";
    expect(appendEmbedToNote(note, "![[photo.png]]")).toBe(
      "---\ntitle: Card\n---\nSome body text.\n\n![[photo.png]]\n",
    );
  });
  test("frontmatter-only note", () => {
    const note = "---\nstatus: todo\n---\n";
    expect(appendEmbedToNote(note, "![[a.png]]")).toBe("---\nstatus: todo\n---\n\n![[a.png]]\n");
  });
  test("empty note gets just the embed", () => {
    expect(appendEmbedToNote("", "![[a.png]]")).toBe("![[a.png]]\n");
    expect(appendEmbedToNote("   \n\n", "![[a.png]]")).toBe("![[a.png]]\n");
  });
  test("multi-embed block stays on consecutive lines", () => {
    expect(appendEmbedToNote("body", "![[a.png]]\n![[b.png]]")).toBe("body\n\n![[a.png]]\n![[b.png]]\n");
  });
  test("collapses pre-existing trailing whitespace to one blank line", () => {
    expect(appendEmbedToNote("body\n\n\n", "![[a.png]]")).toBe("body\n\n![[a.png]]\n");
  });
});
