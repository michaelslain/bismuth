// app/src/export/formats.ts
import type { ExportFormat, RenderMode } from "./types";
import { SETTINGS_FILE } from "../tabIds";

// Defined here (the pure leaf), not in ./exporters, and re-used by exporters.ts.
// exporters.ts statically pulls in `marked` (../bases/markdown) + jspdf, and App.tsx
// imports `isExportable` from here for render-time gating — importing exporters here
// would drag that whole export stack toward the entry bundle. `ext` is trivial + pure.
export function ext(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

// A base is a `type: base` md file, so it falls under `md` (same formats) — there is
// no separate `base` extension.
const MATRIX: Record<string, ExportFormat[]> = {
  md: ["html", "pdf", "png", "md"],
  sheet: ["html", "pdf", "png"],
  draw: ["pdf", "png"],
};

/** Formats valid for a path's file type, in display order. Empty if not exportable. */
export function formatsFor(path: string): ExportFormat[] {
  if (path.startsWith("::")) return [];
  if (path === SETTINGS_FILE) return [];   // settings is config, not a document
  return MATRIX[ext(path)] ?? [];
}

export function isExportable(path: string): boolean {
  return formatsFor(path).length > 0;
}

// Options-aware format list for the export UI. `formatsFor` is extension-keyed and can't
// see file contents, so a base (a `.md`) needs this contents-aware refinement:
//  - non-base: unchanged (the extension matrix).
//  - base + "data": the flat-table forms (md + csv added — both only meaningful as data).
//  - base + "visual": only the rendered forms (html/pdf/png); md/csv have no sensible
//    form for a calendar grid / kanban board.
export function formatsForOptions(path: string, isBase: boolean, mode: RenderMode): ExportFormat[] {
  if (!isBase) return formatsFor(path);
  return mode === "data" ? ["html", "pdf", "png", "md", "csv"] : ["html", "pdf", "png"];
}
