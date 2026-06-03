// app/src/export/formats.ts
import type { ExportFormat } from "./types";
import { ext } from "./exporters";

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
