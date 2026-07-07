// Universal `export` — note / base / sheet / drawing → md | html | png | pdf.
// Reuses the app's own exporter (app/src/export/exporters.ts) so CLI output matches
// the in-app export exactly, injecting headless deps. md/html/png are fully headless;
// PDF of notes/sheets is browser-only (html2canvas/jsPDF), so that one path errors
// with a clear message. Drawings go straight through the headless core renderer.
import { readFileSync, writeFileSync } from "node:fs";
import type { CommandMap } from "../types";
import { flag, bool, requireVault, fail, today, out } from "../args";
import { readNote } from "../../../core/src/files";
import { resolveSource } from "../../../core/src/bases/source";
import { parseDoc } from "../../../core/src/drawing/model";
import { renderDocToPng, renderDocToPdf } from "../../../core/src/drawing/export";
import { renderExport } from "../../../app/src/export/exporters";
import { defaultExportOptions } from "../../../app/src/export/options";
import type { ExportFormat, ExportDeps, ExportOptions, RenderMode, CalSpan } from "../../../app/src/export/types";

// Base-export options from flags (no-ops for non-base files). `--view` picks which view,
// `--mode data|visual` flat-table vs rendered view, `--cal-start`/`--cal-span` the calendar
// grid anchor + span. Visual png/pdf of a base is browser-only (see deps below); html works.
function optionsFrom(args: string[]): ExportOptions {
  const o = defaultExportOptions();
  const view = flag(args, "view");
  if (view !== undefined) o.viewIndex = Math.max(0, parseInt(view, 10) || 0);
  const mode = flag(args, "mode");
  if (mode === "visual" || mode === "data") o.mode = mode as RenderMode;
  const start = flag(args, "cal-start");
  if (start) o.calStart = start;
  const span = flag(args, "cal-span");
  if (span === "month" || span === "week" || span === "3day" || span === "day") o.calSpan = span as CalSpan;
  if (bool(args, "no-frontmatter")) o.includeFrontmatter = false;
  return o;
}

async function run(args: string[]): Promise<void> {
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) fail("usage: bismuth export <file> [--format md|html|png|pdf|csv] [--out FILE] [--view N] [--mode data|visual] [--cal-start YYYY-MM-DD] [--cal-span month|week|3day|day] [--no-frontmatter]");
  const fmt = (flag(args, "format") ?? (file.endsWith(".draw") ? "png" : "md")) as ExportFormat;

  // Drawings: headless core renderer (both png + pdf work without a browser).
  if (file.endsWith(".draw")) {
    const doc = parseDoc(readFileSync(file, "utf8"));
    if (fmt !== "png" && fmt !== "pdf") fail("a .draw file exports to png or pdf");
    const bytes = fmt === "pdf" ? await renderDocToPdf(doc, "dark") : await renderDocToPng(doc, "dark");
    const outPath = flag(args, "out") ?? `${file}.${fmt}`;
    writeFileSync(outPath, bytes);
    out(`wrote ${outPath}`, args);
    return;
  }

  // Notes / bases / sheets: reuse the app exporter with headless deps.
  const vault = requireVault(args);
  const deps: ExportDeps = {
    read: (p) => readNote(vault, p),
    resolveRows: (spec) => resolveSource(spec, { root: vault, today: today() }),
    htmlToPdf: () => {
      throw new Error(
        "pdf export of notes/bases/sheets is browser-only (html2canvas) — open the file in the app and export from there, or export --format html|md",
      );
    },
    htmlToPng: () => {
      throw new Error(
        "png export of notes/bases/sheets is browser-only (html2canvas) — open the file in the app and export from there, or export --format html|md",
      );
    },
    // No inline KaTeX CSS from the headless cli: the app's katexCss module is Vite-only
    // (`?inline` fonts), unresolvable in a bun-compiled binary. cli html exports of math
    // still carry the math markup, just without embedded fonts — export from the app for
    // full-fidelity math. (Returning "" keeps the build self-contained.)
    katexCss: async () => "",
    drawingToPng: async (docText, theme) => {
      const bytes = await renderDocToPng(parseDoc(docText), theme);
      return { bytes, dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` };
    },
  };
  const res = await renderExport(file, fmt, deps, "dark", optionsFrom(args));
  // A `<!-- pagebreak -->`-split PNG note (see app/src/export/pageBreaks.ts) yields several
  // files, one per page — `--out` (a single path) doesn't apply, so each writes to its own
  // computed name. Unreachable today for the app-only png/pdf-of-notes paths above (they throw
  // before producing bytes), kept for when a headless PNG rasterizer lands.
  if (res.files && res.files.length > 1) {
    for (const f of res.files) writeFileSync(f.filename, f.bytes);
    out(`wrote ${res.files.map((f) => f.filename).join(", ")}`, args);
    return;
  }
  const outPath = flag(args, "out") ?? res.filename;
  writeFileSync(outPath, res.bytes);
  out(`wrote ${outPath}`, args);
}

export const commands: CommandMap = {
  export: {
    summary: "Export a note/base/sheet/drawing to md|html|png|pdf|csv (pdf/png of notes is app-only)",
    usage: "<file> [--format md|html|png|pdf|csv] [--out FILE] [--view N] [--mode data|visual] [--cal-start YYYY-MM-DD] [--cal-span month|week|3day|day] [--no-frontmatter] [--vault <dir>]",
    run,
  },
};
