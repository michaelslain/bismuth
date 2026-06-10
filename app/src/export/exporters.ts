// app/src/export/exporters.ts
import { renderMarkdown } from "../bases/markdown";
import { wrapHtmlDocument, escapeHtml } from "./htmlTemplate";
import { tableToMarkdown } from "./mdTable";
import { tableToHtml } from "./rowsHtml";
import { baseToTable } from "./baseTable";
import { snapshotToHtmlTable } from "./sheetHtml";
import { formatsFor, ext } from "./formats";
import { parseFrontmatter } from "../../../core/src/frontmatter";
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
  // html + pdf share the same rendered HTML body.
  return { previewHtml: wrapHtmlDocument(await bodyHtml(path, deps), name, theme) };
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
      const doc = wrapHtmlDocument(await bodyHtml(path, deps), name, theme);
      return { bytes: TEXT.encode(doc), mime: "text/html", filename: `${name}.html`, previewHtml: doc };
    }
    case "pdf": {
      if (kind === "draw") {
        const { dataUrl } = await deps.drawingToPng(await deps.read(path), theme);
        const pdf = await deps.htmlToPdf(wrapHtmlDocument(`<img src="${dataUrl}">`, name, theme));
        return { bytes: pdf, mime: "application/pdf", filename: `${name}.pdf`, previewImg: dataUrl };
      }
      const doc = wrapHtmlDocument(await bodyHtml(path, deps), name, theme);
      const pdf = await deps.htmlToPdf(doc);
      return { bytes: pdf, mime: "application/pdf", filename: `${name}.pdf`, previewHtml: doc };
    }
    case "png": {
      const { bytes, dataUrl } = await deps.drawingToPng(await deps.read(path), theme);
      return { bytes, mime: "image/png", filename: `${name}.png`, previewImg: dataUrl };
    }
  }
}
