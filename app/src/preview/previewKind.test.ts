// app/src/preview/previewKind.test.ts
import { describe, expect, test } from "bun:test";
import { extOf, previewKind, isPreviewPath, isAnnotatable } from "./previewKind";

describe("extOf", () => {
  test("takes the basename's extension, lowercased", () => {
    expect(extOf("a/b/Photo.PNG")).toBe("png");
    expect(extOf("deep/dir/report.final.pdf")).toBe("pdf");
    expect(extOf("script.TS")).toBe("ts");
  });
  test("extensionless files return the whole basename (Makefile/Dockerfile)", () => {
    expect(extOf("build/Makefile")).toBe("makefile");
    expect(extOf("Dockerfile")).toBe("dockerfile");
  });
  test("leading-dot dotfiles keep their name", () => {
    expect(extOf(".gitignore")).toBe(".gitignore");
  });
});

describe("previewKind", () => {
  test("images", () => {
    for (const p of ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.svg", "g.bmp", "h.ico", "i.avif"]) {
      expect(previewKind(p)).toBe("image");
    }
  });
  test("pdf", () => {
    expect(previewKind("doc.pdf")).toBe("pdf");
    expect(previewKind("exported.draw.pdf")).toBe("pdf"); // a real PDF; preview creates no sidecar
  });
  test("code / text", () => {
    for (const p of ["main.ts", "app.js", "style.css", "index.html", "data.json", "run.sh", "lib.rs", "q.sql", "notes.txt", "Makefile"]) {
      expect(previewKind(p)).toBe("code");
    }
  });
  test("external / binary formats", () => {
    for (const p of ["art.psd", "design.fig", "wire.sketch", "mock.xd", "deck.pptx", "song.mp3", "clip.mp4", "bundle.zip"]) {
      expect(previewKind(p)).toBe("external");
    }
  });
  test("vault-native editable formats never preview", () => {
    for (const p of ["Note.md", ".settings", "sub/.settings", "config.yaml", "settings.yml", "Budget.sheet", "Sketch.draw", "photo.png.draw"]) {
      expect(previewKind(p)).toBeNull();
    }
  });
});

describe("isPreviewPath / isAnnotatable", () => {
  test("isPreviewPath mirrors previewKind !== null", () => {
    expect(isPreviewPath("a.png")).toBe(true);
    expect(isPreviewPath("a.pdf")).toBe(true);
    expect(isPreviewPath("a.ts")).toBe(true);
    expect(isPreviewPath("a.psd")).toBe(true);
    expect(isPreviewPath("a.md")).toBe(false);
  });
  test("only images + pdfs are annotatable (code/external are not)", () => {
    expect(isAnnotatable("a.png")).toBe(true);
    expect(isAnnotatable("a.pdf")).toBe(true);
    expect(isAnnotatable("a.ts")).toBe(false);
    expect(isAnnotatable("a.psd")).toBe(false);
    expect(isAnnotatable("a.md")).toBe(false);
  });
});
