// app/src/export/exporters.ts
import { renderMarkdown } from "../bases/markdown";
import { wrapHtmlDocument, escapeHtml } from "./htmlTemplate";
import { tableToMarkdown } from "./mdTable";
import { tableToHtml } from "./rowsHtml";
import { baseToTable } from "./baseTable";
import { snapshotToHtmlTable } from "./sheetHtml";
import { formatsFor, ext } from "./formats";
import { parseFrontmatter } from "../../../core/src/frontmatter";
import { whenMathReady } from "../editor/katexLoader";
import type { ExportFormat, ExportResult, ExportPreview, ExportDeps, ExportTheme } from "./types";

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

// The canonical rendered-HTML body for a text-ish file (drives html + pdf). Drawings
// are raster and don't go through here.
async function bodyHtml(path: string, deps: ExportDeps): Promise<string> {
  const kind = ext(path);
  if (kind === "sheet") return snapshotToHtmlTable(JSON.parse((await deps.read(path)) || "{}"));
  const text = await deps.read(path);
  // A `type: base` md file renders as its query's table; any other md is prose.
  if (isBaseText(text)) return tableToHtml(await baseToTable(path, deps));
  if (kind === "md") return renderMarkdown(text);
  throw new Error(`No HTML body for ${kind || "this file"}`);
}

// Render a file's HTML body, guaranteeing math is actually rendered (not blank). The
// shared renderMath returns "" until the lazy KaTeX chunk loads and relies on a live-DOM
// upgrade — which can't reach a static export string / off-screen iframe. So if the first
// render left unrendered math placeholders (`data-math=`), wait for KaTeX and re-render.
// Matches an UNRENDERED math placeholder span (precise — a bare "data-math=" substring
// would also trip on prose/code that mentions the attribute).
const UNRENDERED_MATH = /<span class="oa-math[^"]*" data-math=/;
async function renderedBody(path: string, deps: ExportDeps): Promise<string> {
  const html = await bodyHtml(path, deps);
  if (!UNRENDERED_MATH.test(html)) return html; // no math, or already rendered
  await whenMathReady();
  return bodyHtml(path, deps);
}

// Wrap a rendered body in a standalone document, inlining a self-contained KaTeX
// stylesheet (fonts as data: URIs) when the body contains rendered math. The .html
// download and the off-screen iframe the PDF/PNG rasterizers snapshot can't reach the
// app's loaded KaTeX CSS/fonts, so math would otherwise render with broken metrics. The
// heavy inline-CSS module is dynamic-imported ONLY when math is actually present.
async function wrapBody(body: string, name: string, theme: ExportTheme, deps: ExportDeps): Promise<string> {
  // `class="katex` is the marker KaTeX emits around rendered math (display or inline) —
  // far more precise than a bare "katex" substring, which the word "katex" in prose would
  // wrongly trip, embedding ~368KB of fonts into a math-free export. The inline CSS comes
  // from deps.katexCss() (env-specific; see ExportDeps) so this module stays bun-compilable
  // for headless consumers (the cli binary) that can't resolve katexCss.ts's Vite imports.
  const extraHead = body.includes('class="katex')
    ? `<style>${await deps.katexCss()}</style>`
    : "";
  return wrapHtmlDocument(body, name, theme, extraHead);
}

// The exact markdown text a `md` export would write — also shown (in a <pre>) as the
// md-format preview so it isn't blank.
async function markdownText(path: string, deps: ExportDeps): Promise<string> {
  const text = await deps.read(path);
  // A `type: base` md exports its table as a markdown table; any other md is its own text.
  return isBaseText(text) ? tableToMarkdown(await baseToTable(path, deps)) : text;
}

/**
 * Compute ONLY what the export tab displays for (path, format, theme). Never produces
 * export bytes and never runs html->pdf — so flipping formats in the UI is instant and
 * has no DOM side effects. The PDF preview is just the HTML the PDF will be rendered from.
 */
export async function renderPreview(
  path: string,
  format: ExportFormat,
  deps: ExportDeps,
  theme: ExportTheme = "dark",
): Promise<ExportPreview> {
  const kind = ext(path);
  const name = baseName(path);

  if (kind === "draw") {
    const { dataUrl } = await deps.drawingToPng(await deps.read(path), theme);
    return { previewImg: dataUrl };
  }
  if (format === "md") {
    const pre = `<pre>${escapeHtml(await markdownText(path, deps))}</pre>`;
    return { previewHtml: wrapHtmlDocument(pre, name, theme) };
  }
  // html + pdf + png share the same rendered HTML body.
  return { previewHtml: await wrapBody(await renderedBody(path, deps), name, theme, deps) };
}

/** Render a file to the chosen format, producing downloadable bytes. Impure I/O via `deps`. */
export async function renderExport(
  path: string,
  format: ExportFormat,
  deps: ExportDeps,
  theme: ExportTheme = "dark",
): Promise<ExportResult> {
  if (!formatsFor(path).includes(format)) {
    throw new Error(`Cannot export ${ext(path) || "this file"} as ${format}`);
  }
  const name = baseName(path);
  const kind = ext(path);

  switch (format) {
    case "md": {
      const md = await markdownText(path, deps);
      return { bytes: TEXT.encode(md), mime: "text/markdown", filename: `${name}.md` };
    }
    case "html": {
      const doc = await wrapBody(await renderedBody(path, deps), name, theme, deps);
      return { bytes: TEXT.encode(doc), mime: "text/html", filename: `${name}.html`, previewHtml: doc };
    }
    case "pdf": {
      if (kind === "draw") {
        const { dataUrl } = await deps.drawingToPng(await deps.read(path), theme);
        const pdf = await deps.htmlToPdf(wrapHtmlDocument(`<img src="${dataUrl}">`, name, theme));
        return { bytes: pdf, mime: "application/pdf", filename: `${name}.pdf`, previewImg: dataUrl };
      }
      const doc = await wrapBody(await renderedBody(path, deps), name, theme, deps);
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
      const doc = await wrapBody(await renderedBody(path, deps), name, theme, deps);
      const { bytes, dataUrl } = await deps.htmlToPng(doc);
      return { bytes, mime: "image/png", filename: `${name}.png`, previewImg: dataUrl };
    }
  }
}
