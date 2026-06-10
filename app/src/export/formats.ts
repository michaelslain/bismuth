// app/src/export/formats.ts
import type { ExportFormat } from "./types";

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
  md: ["html", "pdf", "md"],
  sheet: ["html", "pdf"],
  draw: ["pdf", "png"],
};

/** Formats valid for a path's file type, in display order. Empty if not exportable. */
export function formatsFor(path: string): ExportFormat[] {
  if (path.startsWith("::")) return [];
  if (path === "settings.yaml") return [];   // settings is config, not a document
  return MATRIX[ext(path)] ?? [];
}

export function isExportable(path: string): boolean {
  return formatsFor(path).length > 0;
}
