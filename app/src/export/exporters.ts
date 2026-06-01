// app/src/export/exporters.ts
import { renderMarkdown } from "../bases/markdown";
import { wrapHtmlDocument } from "./htmlTemplate";
import { rowsToMarkdownTable } from "./mdTable";
import { rowsToHtmlTable } from "./rowsHtml";
import { snapshotToHtmlTable } from "./sheetHtml";
import { formatsFor } from "./formats";
import type { ExportFormat, ExportResult, ExportDeps } from "./types";

const TEXT = new TextEncoder();

function baseName(path: string): string {
  const file = path.split("/").pop() ?? path;
  const dot = file.lastIndexOf(".");
  return dot === -1 ? file : file.slice(0, dot);
}

function ext(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

const htmlResult = (name: string, body: string, title: string): ExportResult => {
  const doc = wrapHtmlDocument(body, title);
  return { bytes: TEXT.encode(doc), mime: "text/html", filename: `${name}.html`, previewHtml: doc };
};

/** Render a file to the chosen format. Impure I/O comes from `deps`. */
export async function renderExport(
  path: string,
  format: ExportFormat,
  deps: ExportDeps,
): Promise<ExportResult> {
  if (!formatsFor(path).includes(format)) {
    throw new Error(`Cannot export ${ext(path) || "this file"} as ${format}`);
  }
  const name = baseName(path);
  const kind = ext(path);

  async function bodyHtml(): Promise<string> {
    if (kind === "md") return renderMarkdown(await deps.read(path));
    if (kind === "base") return rowsToHtmlTable(await deps.resolveRows(path));
    if (kind === "sheet") return snapshotToHtmlTable(JSON.parse((await deps.read(path)) || "{}"));
    throw new Error(`No HTML body for ${kind}`);
  }

  switch (format) {
    case "md": {
      if (kind === "md") {
        const src = await deps.read(path);
        return { bytes: TEXT.encode(src), mime: "text/markdown", filename: `${name}.md` };
      }
      const md = rowsToMarkdownTable(await deps.resolveRows(path));
      return { bytes: TEXT.encode(md), mime: "text/markdown", filename: `${name}.md` };
    }
    case "html":
      return htmlResult(name, await bodyHtml(), name);
    case "pdf": {
      if (kind === "draw") {
        const { bytes, dataUrl } = await deps.drawingToPng(await deps.read(path));
        const pdf = await deps.htmlToPdf(`<img src="${dataUrl}">`);
        return { bytes: pdf, mime: "application/pdf", filename: `${name}.pdf`, previewImg: dataUrl };
      }
      const body = await bodyHtml();
      const doc = wrapHtmlDocument(body, name);
      const pdf = await deps.htmlToPdf(doc);
      return { bytes: pdf, mime: "application/pdf", filename: `${name}.pdf`, previewHtml: doc };
    }
    case "png": {
      const { bytes, dataUrl } = await deps.drawingToPng(await deps.read(path));
      return { bytes, mime: "image/png", filename: `${name}.png`, previewImg: dataUrl };
    }
  }
}
