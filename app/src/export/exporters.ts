// app/src/export/exporters.ts
import { renderMarkdown } from "../bases/markdown";
import { wrapHtmlDocument, escapeHtml } from "./htmlTemplate";
import { tableToMarkdown } from "./mdTable";
import { tableToCsv } from "./csvTable";
import { tableToHtml } from "./rowsHtml";
import { baseToTable } from "./baseTable";
import { baseViewHtml } from "./baseView";
import { snapshotToHtmlTable } from "./sheetHtml";
import { formatsFor, ext } from "./formats";
import { defaultExportOptions } from "./options";
import { paletteFor } from "./exportTheme";
import { parseFrontmatter } from "../../../core/src/frontmatter";
import { stripFrontmatter } from "../bases/cardBodySplit";
import { pageSections } from "./pageBreaks";
import { whenMathReady } from "../editor/katexLoader";
import type { ExportFormat, ExportResult, ExportPreview, ExportDeps, ExportTheme, ExportOptions, ThemePalette } from "./types";

const TEXT = new TextEncoder();

/** A base is a `type: base` md file — detected by frontmatter, not extension. */
function isBaseText(text: string): boolean {
  return parseFrontmatter(text).data?.type === "base";
}

function baseName(path: string): string {
  const file = path.split("/").pop() ?? path;
  const dot = file.lastIndexOf(".");
  return dot === -1 ? file : file.slice(0, dot);
}

// The rendered body of a text-ish file, plus any view-specific CSS to inject into the
// document head (empty for prose/sheet/data-table; populated for a visual base view).
// Drawings are raster and don't go through here.
async function bodyHtml(
  path: string,
  deps: ExportDeps,
  opts: ExportOptions,
  palette: ThemePalette,
): Promise<{ html: string; css: string }> {
  const kind = ext(path);
  if (kind === "sheet") return { html: snapshotToHtmlTable(JSON.parse((await deps.read(path)) || "{}")), css: "" };
  const text = await deps.read(path);
  // A `type: base` md file renders as its chosen view: "visual" → the view AS ITS KIND
  // (calendar grid / cards / kanban / list); "data" → the view's flat table. Any other
  // md is prose.
  if (isBaseText(text)) {
    if (opts.mode === "visual") {
      const v = await baseViewHtml(path, deps, opts, palette);
      return { html: v.body, css: v.css };
    }
    return { html: tableToHtml(await baseToTable(path, deps, opts.viewIndex)), css: "" };
  }
  if (kind === "md") {
    const body = opts.includeFrontmatter ? text : stripFrontmatter(text);
    return { html: renderMarkdown(body), css: "" };
  }
  throw new Error(`No HTML body for ${kind || "this file"}`);
}

// Render a file's HTML body, guaranteeing math is actually rendered (not blank). The
// shared renderMath returns "" until the lazy KaTeX chunk loads and relies on a live-DOM
// upgrade — which can't reach a static export string / off-screen iframe. So if the first
// render left unrendered math placeholders (`data-math=`), wait for KaTeX and re-render.
// Matches an UNRENDERED math placeholder span (precise — a bare "data-math=" substring
// would also trip on prose/code that mentions the attribute).
const UNRENDERED_MATH = /<span class="bismuth-math[^"]*" data-math=/;
async function renderedBody(
  path: string,
  deps: ExportDeps,
  opts: ExportOptions,
  palette: ThemePalette,
): Promise<{ html: string; css: string }> {
  const first = await bodyHtml(path, deps, opts, palette);
  if (!UNRENDERED_MATH.test(first.html)) return first; // no math, or already rendered
  await whenMathReady();
  return bodyHtml(path, deps, opts, palette);
}

// Wrap a rendered body in a standalone document, inlining a self-contained KaTeX
// stylesheet (fonts as data: URIs) when the body contains rendered math, plus any
// view-specific CSS (`extraCss`) for a visual base export. The .html download and the
// off-screen iframe the PDF/PNG rasterizers snapshot can't reach the app's loaded
// stylesheets, so both are inlined here.
async function wrapBody(
  body: string,
  name: string,
  palette: ThemePalette,
  deps: ExportDeps,
  extraCss = "",
  fontSizePt?: number,
): Promise<string> {
  // `class="katex` is the marker KaTeX emits around rendered math (display or inline) —
  // far more precise than a bare "katex" substring. The inline CSS comes from
  // deps.katexCss() (env-specific; see ExportDeps) so this module stays bun-compilable
  // for headless consumers (the cli binary).
  const katex = body.includes('class="katex') ? `<style>${await deps.katexCss()}</style>` : "";
  const view = extraCss ? `<style>${extraCss}</style>` : "";
  // `fontSizePt` is passed only by the PDF path (the user's chosen body size); other formats
  // leave it undefined so they keep their intrinsic sizing.
  return wrapHtmlDocument(body, name, palette, view + katex, fontSizePt);
}

// Render one `<!-- pagebreak -->`-delimited section (raw markdown, from pageSections) to an
// HTML fragment. Same math-guard as renderedBody: re-render once KaTeX is ready if the first
// pass left an unrendered placeholder. Shared by the PNG page-splitter (each fragment gets
// its own wrapped document) and the paged preview (fragments stack as visual "sheets").
async function renderSectionHtml(section: string): Promise<string> {
  const html = renderMarkdown(section);
  if (!UNRENDERED_MATH.test(html)) return html;
  await whenMathReady();
  return renderMarkdown(section);
}

// The paged-preview stylesheet: each page-break-delimited section renders inside its own
// bordered "sheet" with a small page label, so the pane VISUALIZES exactly where the export
// splits pages (PNG: one file per sheet; PDF: a forced page boundary at each gap; HTML: a
// forced break when the exported file is printed).
function previewPagesCss(p: ThemePalette): string {
  return `
  .bismuth-preview-page { border: 1px dashed ${p.border}; border-radius: 8px;
    padding: 1.1rem 1.4rem 1.3rem; margin: 0 0 1.6rem; }
  .bismuth-preview-page:last-child { margin-bottom: 0; }
  .bismuth-preview-pagelabel { font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; color: ${p.muted}; margin: 0 0 0.75rem; }
  .bismuth-preview-pagelabel + * { margin-top: 0; }
`;
}

// The PDF preview document: the actual paginated Letter page images (from htmlToPdfPages —
// the SAME pages the downloaded PDF holds) stacked as sheets, so the preview shows the exact
// multi-page 8.5x11in / 1in-margin layout of the output rather than one long continuous page.
// Each image already bakes in the 1in margin band + Letter aspect, so it just displays at width.
function pdfPreviewDoc(pageDataUrls: string[], palette: ThemePalette): string {
  const n = pageDataUrls.length;
  // A neutral backdrop so the light/dark pages read as physical sheets floating on the pane.
  const backdrop = palette.scheme === "dark" ? "#17181d" : "#52545a";
  const label = palette.scheme === "dark" ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.8)";
  const body = pageDataUrls
    .map(
      (src, i) =>
        `<div class="pdfpage"><img src="${src}" alt="Page ${i + 1} of ${n}"><div class="pdflabel">Page ${i + 1} of ${n}</div></div>`,
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:${backdrop};}
    body{padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:22px;
      font-family:system-ui,-apple-system,sans-serif;}
    .pdfpage{width:100%;max-width:612px;}
    .pdfpage img{display:block;width:100%;height:auto;border-radius:2px;
      box-shadow:0 2px 14px rgba(0,0,0,0.45);}
    .pdflabel{margin-top:7px;text-align:center;font-size:10.5px;font-weight:600;
      letter-spacing:0.08em;text-transform:uppercase;color:${label};}
  </style></head><body>${body}</body></html>`;
}

// The <body> of the paged preview: one labeled sheet per rendered section. Pure over the
// already-rendered fragments; exercised via renderPreview in exporters.test.ts.
function previewPagesBody(sectionHtmls: string[]): string {
  const n = sectionHtmls.length;
  return sectionHtmls
    .map(
      (html, i) =>
        `<section class="bismuth-preview-page"><div class="bismuth-preview-pagelabel">Page ${i + 1} of ${n}</div>\n${html}</section>`,
    )
    .join("\n");
}

// The page-break section model for a path, or null when page-splitting doesn't apply (a
// non-md file, a base, or a note with no real page breaks). Single source for the PNG
// export's file-per-page split AND the preview's sheet-per-page rendering.
async function pageBreakSections(
  path: string,
  deps: ExportDeps,
  opts: ExportOptions,
): Promise<string[] | null> {
  if (ext(path) !== "md") return null;
  const raw = await deps.read(path);
  if (isBaseText(raw)) return null;
  const sections = pageSections(raw, opts.includeFrontmatter);
  return sections.length > 1 ? sections : null;
}

// The exact markdown text a `md` export would write — also shown (in a <pre>) as the
// md-format preview so it isn't blank.
async function markdownText(path: string, deps: ExportDeps, opts: ExportOptions): Promise<string> {
  const text = await deps.read(path);
  // A `type: base` md exports its chosen view's table as a markdown table (no frontmatter in
  // that output regardless); any other md is its own text, minus frontmatter when excluded.
  if (isBaseText(text)) return tableToMarkdown(await baseToTable(path, deps, opts.viewIndex));
  return opts.includeFrontmatter ? text : stripFrontmatter(text);
}

// CSV is base-only (a flat-table format). Non-base files have no sensible CSV form.
async function csvText(path: string, deps: ExportDeps, opts: ExportOptions): Promise<string> {
  const text = await deps.read(path);
  if (!isBaseText(text)) throw new Error("CSV export is only available for bases");
  return tableToCsv(await baseToTable(path, deps, opts.viewIndex));
}

/**
 * Compute what the export tab displays for (path, format, theme, options). Never produces
 * downloadable export bytes, so flipping formats/options stays cheap for the text formats.
 *
 * The PDF preview is the EXCEPTION: it rasterizes + paginates the document into real Letter
 * pages (via `deps.htmlToPdfPages`) so the preview shows the exact multi-page 8.5x11in /
 * 1in-margin layout the downloaded PDF has — a plain source-HTML preview never revealed the
 * pagination. (PNG/HTML previews stay the lightweight rendered HTML.)
 */
export async function renderPreview(
  path: string,
  format: ExportFormat,
  deps: ExportDeps,
  theme: ExportTheme = "dark",
  opts: ExportOptions = defaultExportOptions(),
): Promise<ExportPreview> {
  const kind = ext(path);
  const name = baseName(path);
  const palette = paletteFor(theme, opts.palette);

  if (kind === "draw") {
    const { dataUrl } = await deps.drawingToPng(await deps.read(path), theme);
    return { previewImg: dataUrl };
  }
  if (format === "md") {
    const pre = `<pre>${escapeHtml(await markdownText(path, deps, opts))}</pre>`;
    return { previewHtml: wrapHtmlDocument(pre, name, palette) };
  }
  if (format === "csv") {
    const pre = `<pre>${escapeHtml(await csvText(path, deps, opts))}</pre>`;
    return { previewHtml: wrapHtmlDocument(pre, name, palette) };
  }
  // PDF previews as the ACTUAL paginated Letter pages the export produces (draw handled above).
  // Rasterizing the rendered doc into fixed 8.5x11in / 1in-margin pages is the only way the
  // preview can show the auto-pagination (content overflowing onto page 2, 3, …) — the same
  // page images the downloaded PDF holds, so preview and output never disagree.
  if (format === "pdf") {
    const { html, css } = await renderedBody(path, deps, opts, palette);
    const doc = await wrapBody(html, name, palette, deps, css, opts.pdfFontSize);
    const pages = await deps.htmlToPdfPages(doc);
    return { previewHtml: pdfPreviewDoc(pages, palette) };
  }
  // A page-broken note previews as one visually distinct "sheet" per section — the same
  // pageSections model the PNG export writes files from and the PDF forces breaks at, so
  // what the preview separates is exactly what the export separates.
  const sections = await pageBreakSections(path, deps, opts);
  if (sections) {
    const htmls: string[] = [];
    for (const s of sections) htmls.push(await renderSectionHtml(s));
    return { previewHtml: await wrapBody(previewPagesBody(htmls), name, palette, deps, previewPagesCss(palette)) };
  }
  // html + pdf + png share the same rendered HTML body (+ view CSS).
  const { html, css } = await renderedBody(path, deps, opts, palette);
  return { previewHtml: await wrapBody(html, name, palette, deps, css) };
}

/** Render a file to the chosen format, producing downloadable bytes. Impure I/O via `deps`. */
export async function renderExport(
  path: string,
  format: ExportFormat,
  deps: ExportDeps,
  theme: ExportTheme = "dark",
  opts: ExportOptions = defaultExportOptions(),
): Promise<ExportResult> {
  // csv is base-conditional (not in the extension-keyed matrix); csvText enforces base-ness.
  if (format !== "csv" && !formatsFor(path).includes(format)) {
    throw new Error(`Cannot export ${ext(path) || "this file"} as ${format}`);
  }
  const name = baseName(path);
  const kind = ext(path);
  const palette = paletteFor(theme, opts.palette);

  switch (format) {
    case "md": {
      const md = await markdownText(path, deps, opts);
      return { bytes: TEXT.encode(md), mime: "text/markdown", filename: `${name}.md` };
    }
    case "csv": {
      const csv = await csvText(path, deps, opts);
      return { bytes: TEXT.encode(csv), mime: "text/csv", filename: `${name}.csv` };
    }
    case "html": {
      const { html, css } = await renderedBody(path, deps, opts, palette);
      const doc = await wrapBody(html, name, palette, deps, css);
      return { bytes: TEXT.encode(doc), mime: "text/html", filename: `${name}.html`, previewHtml: doc };
    }
    case "pdf": {
      if (kind === "draw") {
        const { dataUrl } = await deps.drawingToPng(await deps.read(path), theme);
        const pdf = await deps.htmlToPdf(wrapHtmlDocument(`<img src="${dataUrl}">`, name, palette));
        return { bytes: pdf, mime: "application/pdf", filename: `${name}.pdf`, previewImg: dataUrl };
      }
      const { html, css } = await renderedBody(path, deps, opts, palette);
      const doc = await wrapBody(html, name, palette, deps, css, opts.pdfFontSize);
      const pdf = await deps.htmlToPdf(doc);
      return { bytes: pdf, mime: "application/pdf", filename: `${name}.pdf`, previewHtml: doc };
    }
    case "png": {
      // Drawings rasterize directly; every other file type rasterizes its rendered HTML
      // body (same self-contained doc the PDF path uses) to a single PNG via html2canvas.
      if (kind === "draw") {
        const { bytes, dataUrl } = await deps.drawingToPng(await deps.read(path), theme);
        return { bytes, mime: "image/png", filename: `${name}.png`, previewImg: dataUrl };
      }
      // A plain (non-base) note with `<!-- pagebreak -->` markers can't fit more than one page
      // in a single raster image — PDF instead slices ONE document into many pages (htmlToPdf.ts
      // reads the same marker off the rendered canvas), but a PNG has no such "many pages, one
      // file" container, so each marker-delimited section renders + rasterizes to its OWN file
      // (`name-1.png`, `name-2.png`, …). A note with no markers takes the single-file path
      // below exactly as before (pageBreakSections returns null then). The section model is
      // shared with renderPreview's sheet-per-page rendering, so preview and export agree;
      // frontmatter rides page 1 when included but never becomes a page of its own.
      {
        const sections = await pageBreakSections(path, deps, opts);
        if (sections) {
          const files: { filename: string; bytes: Uint8Array }[] = [];
          let firstDataUrl: string | undefined;
          for (let i = 0; i < sections.length; i++) {
            const doc = await wrapBody(await renderSectionHtml(sections[i]), `${name} (page ${i + 1})`, palette, deps);
            const { bytes, dataUrl } = await deps.htmlToPng(doc);
            if (i === 0) firstDataUrl = dataUrl;
            files.push({ filename: `${name}-${i + 1}.png`, bytes });
          }
          return {
            bytes: files[0].bytes,
            mime: "image/png",
            filename: files[0].filename,
            previewImg: firstDataUrl,
            files,
          };
        }
      }
      const { html, css } = await renderedBody(path, deps, opts, palette);
      const doc = await wrapBody(html, name, palette, deps, css);
      const { bytes, dataUrl } = await deps.htmlToPng(doc);
      return { bytes, mime: "image/png", filename: `${name}.png`, previewImg: dataUrl };
    }
  }
}
