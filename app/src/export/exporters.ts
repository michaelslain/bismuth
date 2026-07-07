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
): Promise<string> {
  // `class="katex` is the marker KaTeX emits around rendered math (display or inline) —
  // far more precise than a bare "katex" substring. The inline CSS comes from
  // deps.katexCss() (env-specific; see ExportDeps) so this module stays bun-compilable
  // for headless consumers (the cli binary).
  const katex = body.includes('class="katex') ? `<style>${await deps.katexCss()}</style>` : "";
  const view = extraCss ? `<style>${extraCss}</style>` : "";
  return wrapHtmlDocument(body, name, palette, view + katex);
}

// Render one `<!-- pagebreak -->`-delimited section (raw markdown, already frontmatter-stripped
// by pageSections) to a self-contained HTML document — the per-page analogue of
// renderedBody+wrapBody for a plain path, used by the PNG page-splitter below. Same math-guard
// as renderedBody: re-render once KaTeX is ready if the first pass left an unrendered placeholder.
async function renderSectionDoc(
  section: string,
  name: string,
  deps: ExportDeps,
  palette: ThemePalette,
): Promise<string> {
  let html = renderMarkdown(section);
  if (UNRENDERED_MATH.test(html)) {
    await whenMathReady();
    html = renderMarkdown(section);
  }
  return wrapBody(html, name, palette, deps);
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
 * Compute ONLY what the export tab displays for (path, format, theme, options). Never
 * produces export bytes and never runs html->pdf — so flipping formats/options in the UI
 * is instant and has no DOM side effects. The PDF/PNG preview is just the source HTML.
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
      const doc = await wrapBody(html, name, palette, deps, css);
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
      // (`name-1.png`, `name-2.png`, …). A note with no markers takes the single-file path below
      // exactly as before (pageSections returns one section, so `sections.length > 1` is false).
      // Note: pageSections ALWAYS strips frontmatter when computing pages (see its doc comment),
      // independent of `opts.includeFrontmatter` — frontmatter is never a page of its own.
      if (kind === "md") {
        const raw = await deps.read(path);
        if (!isBaseText(raw)) {
          const sections = pageSections(raw);
          if (sections.length > 1) {
            const files: { filename: string; bytes: Uint8Array }[] = [];
            let firstDataUrl: string | undefined;
            for (let i = 0; i < sections.length; i++) {
              const doc = await renderSectionDoc(sections[i], `${name} (page ${i + 1})`, deps, palette);
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
      }
      const { html, css } = await renderedBody(path, deps, opts, palette);
      const doc = await wrapBody(html, name, palette, deps, css);
      const { bytes, dataUrl } = await deps.htmlToPng(doc);
      return { bytes, mime: "image/png", filename: `${name}.png`, previewImg: dataUrl };
    }
  }
}
