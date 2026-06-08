// Universal `export` — note / base / sheet / drawing → md | html | png | pdf.
// Reuses the app's own exporter (app/src/export/exporters.ts) so CLI output matches
// the in-app export exactly, injecting headless deps. md/html/png are fully headless;
// PDF of notes/sheets is browser-only (html2canvas/jsPDF), so that one path errors
// with a clear message. Drawings go straight through the headless core renderer.
import { readFileSync, writeFileSync } from "node:fs";
import type { CommandMap } from "../types";
import { flag, requireVault, fail } from "../args";
import { readNote } from "../../../core/src/files";
import { resolveSource } from "../../../core/src/bases/source";
import { parseDoc } from "../../../core/src/drawing/model";
import { renderDocToPng, renderDocToPdf } from "../../../core/src/drawing/export";
import { renderExport } from "../../../app/src/export/exporters";
import type { ExportFormat, ExportDeps } from "../../../app/src/export/types";

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function run(args: string[]): Promise<void> {
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) fail("usage: bismuth export <file> [--format md|html|png|pdf] [--out FILE]");
  const fmt = (flag(args, "format") ?? (file.endsWith(".draw") ? "png" : "md")) as ExportFormat;

  // Drawings: headless core renderer (both png + pdf work without a browser).
  if (file.endsWith(".draw")) {
    const doc = parseDoc(readFileSync(file, "utf8"));
    if (fmt !== "png" && fmt !== "pdf") fail("a .draw file exports to png or pdf");
    const bytes = fmt === "pdf" ? await renderDocToPdf(doc, "dark") : await renderDocToPng(doc, "dark");
    const outPath = flag(args, "out") ?? `${file}.${fmt}`;
    writeFileSync(outPath, bytes);
    console.log(`wrote ${outPath}`);
    return;
  }

  // Notes / bases / sheets: reuse the app exporter with headless deps.
  const vault = requireVault(args);
  const deps: ExportDeps = {
    read: (p) => readNote(vault, p),
    resolveRows: (spec) => resolveSource(spec, { root: vault, today: todayISO() }),
    htmlToPdf: () => {
      throw new Error(
        "pdf export of notes/bases/sheets is browser-only (html2canvas) — open the file in the app and export from there, or export --format html|md",
      );
    },
    drawingToPng: async (docText, theme) => {
      const bytes = await renderDocToPng(parseDoc(docText), theme);
      return { bytes, dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` };
    },
  };
  const res = await renderExport(file, fmt, deps, "dark");
  const outPath = flag(args, "out") ?? res.filename;
  writeFileSync(outPath, res.bytes);
  console.log(`wrote ${outPath}`);
}

export const commands: CommandMap = {
  export: {
    summary: "Export a note/base/sheet/drawing to md|html|png|pdf (pdf of notes is app-only)",
    usage: "<file> [--format md|html|png|pdf] [--out FILE] [--vault <dir>]",
    run,
  },
};
