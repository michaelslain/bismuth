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
    htmlToPdfPages: async (html) => [`data:image/jpeg;base64,PAGE1:${html.length}`, "data:image/jpeg;base64,PAGE2"],
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

describe("renderPreview (no downloadable bytes; PDF paginates for fidelity)", () => {
  test("note pdf preview shows the ACTUAL paginated Letter page images (via htmlToPdfPages), never a raw source page", async () => {
    let pagesCalls = 0;
    let pdfBytesCalls = 0;
    const r = await renderPreview(
      "a/note.md",
      "pdf",
      deps({
        htmlToPdf: async (h) => { pdfBytesCalls++; return new TextEncoder().encode(h); },
        htmlToPdfPages: async () => { pagesCalls++; return ["data:image/jpeg;base64,PG1", "data:image/jpeg;base64,PG2"]; },
      }),
    );
    expect(pdfBytesCalls).toBe(0);                   // never generates downloadable pdf bytes for a preview
    expect(pagesCalls).toBe(1);                      // it DOES paginate the doc into real pages
    // The preview embeds each paginated page image + a "Page N of M" label (2 pages here), so
    // the pane shows the exact multi-page layout — not one long continuous source page.
    expect(r.previewHtml).toContain("data:image/jpeg;base64,PG1");
    expect(r.previewHtml).toContain("data:image/jpeg;base64,PG2");
    expect(r.previewHtml).toContain("Page 1 of 2");
    expect(r.previewHtml).toContain("Page 2 of 2");
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

describe("include/exclude frontmatter", () => {
  const FM_NOTE = "---\ntitle: Foo\ntags: [a]\n---\n# Title\n\nbody text";
  const withFm = (over: Partial<ExportDeps> = {}) => deps({ read: async () => FM_NOTE, ...over });

  test("md export includes frontmatter by default (unchanged historical behavior)", async () => {
    const r = await renderExport("note.md", "md", withFm());
    expect(enc.decode(r.bytes)).toBe(FM_NOTE);
  });

  test("md export strips frontmatter when includeFrontmatter is false", async () => {
    const r = await renderExport("note.md", "md", withFm(), "dark", opts({ includeFrontmatter: false }));
    const text = enc.decode(r.bytes);
    expect(text).toBe("# Title\n\nbody text");
    expect(text).not.toContain("title: Foo");
  });

  test("html export renders frontmatter (as literal prose text) by default", async () => {
    const r = await renderExport("note.md", "html", withFm());
    expect(r.previewHtml).toContain("title: Foo");
    expect(r.previewHtml).toContain("<h1>Title</h1>");
  });

  test("html export excludes frontmatter from the rendered body when off", async () => {
    const r = await renderExport("note.md", "html", withFm(), "dark", opts({ includeFrontmatter: false }));
    expect(r.previewHtml).not.toContain("title: Foo");
    expect(r.previewHtml).toContain("<h1>Title</h1>");
  });

  test("a note with no frontmatter is unaffected by the toggle either way", async () => {
    const on = await renderExport("a/note.md", "md", deps(), "dark", opts({ includeFrontmatter: true }));
    const off = await renderExport("a/note.md", "md", deps(), "dark", opts({ includeFrontmatter: false }));
    expect(enc.decode(on.bytes)).toBe(enc.decode(off.bytes));
  });

  test("a base file's frontmatter (config, not content) never appears regardless of the toggle", async () => {
    const r = await renderExport("Reading.md", "md", deps(), "dark", opts({ includeFrontmatter: false }));
    expect(enc.decode(r.bytes)).toContain("| name | author |");
  });
});

describe("PNG export split by page-break markers", () => {
  const MARK = "<!-- pagebreak -->";

  test("no markers -> a single png, filename unchanged", async () => {
    const r = await renderExport("note.md", "png", deps());
    expect(r.filename).toBe("note.png");
    expect(r.files).toBeUndefined();
  });

  test("one marker -> two numbered png files; the single-result fields mirror page 1", async () => {
    const d = deps({ read: async () => `Page one\n${MARK}\nPage two` });
    const r = await renderExport("note.md", "png", d);
    expect(r.files?.map((f) => f.filename)).toEqual(["note-1.png", "note-2.png"]);
    expect(r.filename).toBe("note-1.png");
    expect(r.previewImg).toStartWith("data:image/png");
  });

  test("many markers -> that many files, each rasterized independently", async () => {
    let calls = 0;
    const d = deps({
      read: async () => `one\n${MARK}\ntwo\n${MARK}\nthree`,
      htmlToPng: async (html) => {
        calls++;
        return { bytes: new TextEncoder().encode("PNG:" + html.length), dataUrl: "data:image/png;base64,AQI=" };
      },
    });
    const r = await renderExport("note.md", "png", d);
    expect(calls).toBe(3);
    expect(r.files?.map((f) => f.filename)).toEqual(["note-1.png", "note-2.png", "note-3.png"]);
  });

  test("frontmatter never becomes its own page, even with includeFrontmatter: true", async () => {
    const d = deps({ read: async () => `---\ntitle: Foo\n---\nPage one\n${MARK}\nPage two` });
    const r = await renderExport("note.md", "png", d, "dark", opts({ includeFrontmatter: true }));
    expect(r.files).toHaveLength(2); // not 3 — the frontmatter never counts as a page
  });

  test("includeFrontmatter: true puts the frontmatter (as prose) on page 1's rendered doc; false omits it", async () => {
    const rendered: string[] = [];
    const d = deps({
      read: async () => `---\ntitle: Foo\n---\nPage one\n${MARK}\nPage two`,
      htmlToPng: async (html) => {
        rendered.push(html);
        return { bytes: new Uint8Array([1]), dataUrl: "data:image/png;base64,AQI=" };
      },
    });
    await renderExport("note.md", "png", d, "dark", opts({ includeFrontmatter: true }));
    expect(rendered[0]).toContain("title: Foo"); // page 1 carries the fm as prose
    expect(rendered[1]).not.toContain("title: Foo");
    rendered.length = 0;
    await renderExport("note.md", "png", d, "dark", opts({ includeFrontmatter: false }));
    expect(rendered[0]).not.toContain("title: Foo");
  });

  test("a base file's rendered table is never split into pages", async () => {
    const d = deps({ read: async () => BASE_MD });
    const r = await renderExport("Reading.md", "png", d);
    expect(r.files).toBeUndefined();
    expect(r.filename).toBe("Reading.png");
  });

  test("PDF export of a page-break note is a single result — page slicing happens at the canvas level in htmlToPdf.ts, not here", async () => {
    const d = deps({ read: async () => `Page one\n${MARK}\nPage two` });
    const r = await renderExport("note.md", "pdf", d);
    expect(r.files).toBeUndefined();
    expect(r.filename).toBe("note.pdf");
  });
});

describe("preview shows page separation (sheet per section)", () => {
  const MARK = "<!-- pagebreak -->";
  const PAGED = `Page one body\n${MARK}\nPage two body\n${MARK}\nPage three body`;

  // png/html preview a marker-split note as one bordered "sheet" per section. (PDF instead
  // shows the ACTUAL paginated Letter pages — see the pdf-specific test below — because it
  // auto-paginates by height, not just at markers.)
  for (const fmt of ["png", "html"] as const) {
    test(`${fmt} preview of a page-broken note renders one labeled sheet per section`, async () => {
      const r = await renderPreview("note.md", fmt, deps({ read: async () => PAGED }));
      const html = r.previewHtml!;
      expect(html.match(/class="bismuth-preview-page"/g)).toHaveLength(3);
      expect(html).toContain("Page 1 of 3");
      expect(html).toContain("Page 3 of 3");
      expect(html).toContain("Page two body");
      expect(html).toContain(".bismuth-preview-page"); // the sheet CSS is inlined
    });
  }

  test("pdf preview of a page-broken note shows the paginated page images, NOT the sheet-per-section wrappers", async () => {
    const r = await renderPreview("note.md", "pdf", deps({ read: async () => PAGED }));
    const html = r.previewHtml!;
    // Real page rasters from htmlToPdfPages (the mock returns 2), never the marker-section sheets.
    expect(html).not.toContain("bismuth-preview-page");
    expect(html).toContain("data:image/jpeg;base64,PAGE1");
    expect(html).toContain("Page 1 of 2");
  });

  test("a note with no page breaks previews WITHOUT sheet wrappers (unchanged)", async () => {
    const r = await renderPreview("a/note.md", "png", deps());
    expect(r.previewHtml).not.toContain("bismuth-preview-page");
  });

  test("preview sections mirror the export's frontmatter handling (fm on sheet 1 when included, absent when excluded)", async () => {
    const d = deps({ read: async () => `---\ntitle: Foo\n---\nPage one\n${MARK}\nPage two` });
    const on = await renderPreview("note.md", "png", d, "dark", opts({ includeFrontmatter: true }));
    expect(on.previewHtml!.match(/class="bismuth-preview-page"/g)).toHaveLength(2); // fm is not a page
    expect(on.previewHtml).toContain("title: Foo");
    const off = await renderPreview("note.md", "png", d, "dark", opts({ includeFrontmatter: false }));
    expect(off.previewHtml).not.toContain("title: Foo");
  });

  test("a base preview never gets sheet wrappers", async () => {
    const r = await renderPreview("Reading.md", "html", deps());
    expect(r.previewHtml).not.toContain("bismuth-preview-page");
  });
});
