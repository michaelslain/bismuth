// app/src/export/formats.ts
import type { ExportFormat } from "./types";

// Inlined (was imported from ./exporters) so this module stays a pure leaf.
// exporters.ts statically pulls in `marked` (../bases/markdown) + jspdf, and App.tsx
// imports `isExportable` from here for render-time gating — importing exporters here
// dragged that whole export stack toward the entry bundle. `ext` is trivial + pure.
function ext(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

const MATRIX: Record<string, ExportFormat[]> = {
  md: ["html", "pdf", "md"],
  base: ["html", "pdf", "md"],
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
