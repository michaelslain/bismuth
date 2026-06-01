// app/src/export/exporters.test.ts
import { test, expect, describe } from "bun:test";
import { renderExport } from "./exporters";
import type { ExportDeps } from "./types";

const enc = new TextDecoder();

function deps(over: Partial<ExportDeps> = {}): ExportDeps {
  return {
    read: async () => "# Title\n\nbody",
    resolveRows: async () => [{ file: { name: "Dune" } as any, note: { author: "H" }, formula: {} }],
    htmlToPdf: async (html) => new TextEncoder().encode("PDF:" + html.length),
    drawingToPng: async () => ({ bytes: new Uint8Array([1, 2]), dataUrl: "data:image/png;base64,AQI=" }),
    ...over,
  };
}

describe("renderExport", () => {
  test("note -> html wraps rendered markdown", async () => {
    const r = await renderExport("a/note.md", "html", deps());
    expect(r.filename).toBe("note.html");
    expect(r.mime).toBe("text/html");
    const text = enc.decode(r.bytes);
    expect(text).toContain("<!doctype html>");
    expect(text).toContain("<h1>Title</h1>");
    expect(r.previewHtml).toBe(text);
  });

  test("note -> md returns the raw source", async () => {
    const r = await renderExport("a/note.md", "md", deps());
    expect(r.filename).toBe("note.md");
    expect(r.mime).toBe("text/markdown");
    expect(enc.decode(r.bytes)).toBe("# Title\n\nbody");
  });

  test("note -> pdf runs htmlToPdf on the wrapped html", async () => {
    const r = await renderExport("a/note.md", "pdf", deps());
    expect(r.filename).toBe("note.pdf");
    expect(r.mime).toBe("application/pdf");
    expect(enc.decode(r.bytes)).toStartWith("PDF:");
    expect(r.previewHtml).toContain("<h1>Title</h1>");
  });

  test("base -> md builds a markdown table from resolved rows", async () => {
    const r = await renderExport("Reading.base", "md", deps());
    expect(r.filename).toBe("Reading.md");
    expect(enc.decode(r.bytes)).toContain("| name | author |");
  });

  test("base -> html builds a styled html table", async () => {
    const r = await renderExport("Reading.base", "html", deps());
    expect(r.previewHtml).toContain("<th>name</th>");
    expect(r.previewHtml).toContain("<!doctype html>");
  });

  test("drawing -> png returns image bytes + preview img", async () => {
    const r = await renderExport("s.draw", "png", deps());
    expect(r.filename).toBe("s.png");
    expect(r.mime).toBe("image/png");
    expect(r.previewImg).toStartWith("data:image/png");
    expect(Array.from(r.bytes)).toEqual([1, 2]);
  });

  test("throws on a format not valid for the type", async () => {
    await expect(renderExport("s.draw", "md", deps())).rejects.toThrow();
  });
});
