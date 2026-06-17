// app/src/export/exporters.test.ts
import { test, expect, describe } from "bun:test";
import { renderExport, renderPreview } from "./exporters";
import { defaultExportOptions } from "./options";
import type { ExportDeps, ExportOptions } from "./types";

const opts = (o: Partial<ExportOptions>): ExportOptions => ({ ...defaultExportOptions(), ...o });

const enc = new TextDecoder();

// A base is a `type: base` md file whose view orders name + author; everything else is a
// markdown note. Export detects a base by its frontmatter (not extension), parses the file
// and runs the view (mirroring the live BaseView), so the fixture is a type:base md.
const BASE_MD = "---\ntype: base\nviews:\n  - type: table\n    order:\n      - file.name\n      - author\n---\n";

function deps(over: Partial<ExportDeps> = {}): ExportDeps {
  return {
    // "Reading.md" is the base fixture; any other .md is a plain note.
    read: async (p: string) => (p.includes("Reading") ? BASE_MD : "# Title\n\nbody"),
    resolveRows: async () => [{ file: { name: "Dune", path: "Dune.md" } as any, note: { author: "H" }, formula: {} }],
    htmlToPdf: async (html) => new TextEncoder().encode("PDF:" + html.length),
    htmlToPng: async (html) => ({ bytes: new TextEncoder().encode("PNG:" + html.length), dataUrl: "data:image/png;base64,AQI=" }),
    drawingToPng: async () => ({ bytes: new Uint8Array([1, 2]), dataUrl: "data:image/png;base64,AQI=" }),
    katexCss: async () => "",
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
    const r = await renderExport("Reading.md", "md", deps());
    expect(r.filename).toBe("Reading.md");
    expect(enc.decode(r.bytes)).toContain("| name | author |");
  });

  test("base -> html builds a styled html table", async () => {
    const r = await renderExport("Reading.md", "html", deps());
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

describe("renderPreview (never generates bytes / never runs html->pdf)", () => {
  test("note pdf preview is the HTML body, NOT a pdf — htmlToPdf is never called", async () => {
    let pdfCalls = 0;
    const r = await renderPreview("a/note.md", "pdf", deps({ htmlToPdf: async (h) => { pdfCalls++; return new TextEncoder().encode(h); } }));
    expect(pdfCalls).toBe(0);                       // the whole point: no pdf work for preview
    expect(r.previewHtml).toContain("<h1>Title</h1>");
    expect(r.previewImg).toBeUndefined();
  });

  test("note md preview shows the raw source in a <pre>", async () => {
    const r = await renderPreview("a/note.md", "md", deps());
    expect(r.previewHtml).toContain("<pre>");
    expect(r.previewHtml).toContain("# Title");      // escaped markdown source
  });

  test("base html preview is the rendered table", async () => {
    const r = await renderPreview("Reading.md", "html", deps());
    expect(r.previewHtml).toContain("<th>name</th>");
  });

  test("drawing preview is an image, never a pdf", async () => {
    let pdfCalls = 0;
    const r = await renderPreview("s.draw", "pdf", deps({ htmlToPdf: async () => { pdfCalls++; return new Uint8Array(); } }));
    expect(pdfCalls).toBe(0);
    expect(r.previewImg).toStartWith("data:image/png");
    expect(r.previewHtml).toBeUndefined();
  });

  test("theme threads through to the preview document", async () => {
    const dark = await renderPreview("a/note.md", "html", deps(), "dark");
    const light = await renderPreview("a/note.md", "html", deps(), "light");
    expect(dark.previewHtml).not.toBe(light.previewHtml);   // different theme styles
    expect(light.previewHtml).toContain("#ffffff");
  });
});

// Fixtures for the export-options paths: a calendar base + a two-view base.
const CAL_MD = "---\ntype: base\nviews:\n  - type: calendar\n    name: Cal\n---\n";
const TWOVIEW_MD =
  "---\ntype: base\nviews:\n  - type: table\n    order:\n      - file.name\n  - type: table\n    order:\n      - author\n---\n";

function optDeps(text: string, rows: any[]): ExportDeps {
  return deps({ read: async () => text, resolveRows: async () => rows });
}

describe("export options — view selection / data vs visual / csv", () => {
  test("data mode + viewIndex selects which view's columns export", async () => {
    const d = optDeps(TWOVIEW_MD, [{ file: { name: "Dune", path: "Dune.md" } as any, note: { author: "Herbert" }, formula: {} }]);
    const v0 = await renderExport("Two.md", "md", d, "dark", opts({ viewIndex: 0 }));
    const v1 = await renderExport("Two.md", "md", d, "dark", opts({ viewIndex: 1 }));
    expect(enc.decode(v0.bytes)).toContain("| name |");
    expect(enc.decode(v1.bytes)).toContain("| author |");
  });

  test("base -> csv builds a CSV from the resolved rows", async () => {
    const d = optDeps(BASE_MD, [{ file: { name: "Dune", path: "Dune.md" } as any, note: { author: "Herbert" }, formula: {} }]);
    const r = await renderExport("Reading.md", "csv", d);
    expect(r.filename).toBe("Reading.csv");
    expect(r.mime).toBe("text/csv");
    expect(enc.decode(r.bytes)).toContain("name,author");
  });

  test("csv export of a non-base file is rejected", async () => {
    await expect(renderExport("a/note.md", "csv", deps())).rejects.toThrow(/only available for bases/);
  });

  test("calendar base + visual mode renders the calendar grid (not a table)", async () => {
    const d = optDeps(CAL_MD, [{ file: { name: "", path: "" } as any, note: { title: "Dentist", date: "2026-06-10" }, formula: {} }]);
    const r = await renderExport("Cal.md", "html", d, "dark", opts({ mode: "visual", calStart: "2026-06-15" }));
    expect(r.previewHtml).toContain("exp-cal-month");   // calendar grid markup
    expect(r.previewHtml).toContain("Dentist");
    expect(r.previewHtml).toContain(".exp-cal-cell");    // injected calendar CSS
    expect(r.previewHtml).not.toContain("<th>");          // NOT the flat table
  });

  test("calendar base + data mode still exports the flat table", async () => {
    const d = optDeps(CAL_MD, [{ file: { name: "", path: "" } as any, note: { title: "Dentist", date: "2026-06-10" }, formula: {} }]);
    const r = await renderExport("Cal.md", "html", d, "dark", opts({ mode: "data" }));
    expect(r.previewHtml).toContain("<th>");             // flat table
    expect(r.previewHtml).not.toContain("exp-cal-month");
  });
});
