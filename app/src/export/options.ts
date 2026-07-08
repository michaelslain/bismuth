// app/src/export/options.ts
// Default export options. Kept out of types.ts so that file stays type-only and the
// default lives in one place (used by the CLI, the in-app ExportView, and tests).
import type { ExportOptions, RenderMode } from "./types";

/** Default PDF body font size, in points — a standard document body size. */
export const DEFAULT_PDF_FONT_SIZE = 12;

/** The font sizes (pt) offered in the PDF export UI. */
export const PDF_FONT_SIZES: readonly number[] = [9, 10, 11, 12, 14, 16, 18];

/** Clamp an arbitrary font-size request into the supported range (guards CLI/headless input). */
export function clampPdfFontSize(pt: number): number {
  if (!Number.isFinite(pt)) return DEFAULT_PDF_FONT_SIZE;
  return Math.max(6, Math.min(48, pt));
}

export function defaultExportOptions(): ExportOptions {
  return {
    viewIndex: 0,
    mode: "data",
    calSpan: "month",
    calStart: "",
    weekStartsOnMonday: true,
    militaryTime: false,
    pdfFontSize: DEFAULT_PDF_FONT_SIZE,
    includeFrontmatter: true,
  };
}

// View kinds that have a bespoke static "visual" renderer (calendarHtml / cardsHtml /
// kanbanHtml / listHtml). Everything else degrades to the flat data table when "visual"
// is requested, so the export never throws on an unsupported kind.
const VISUAL_KINDS: ReadonlySet<string> = new Set(["calendar", "cards", "kanban", "list", "bullets"]);

/** The mode a view kind should default to when the export tab first sees it. */
export function defaultModeForView(kind: string | undefined): RenderMode {
  return kind && VISUAL_KINDS.has(kind) ? "visual" : "data";
}

export function hasVisualRenderer(kind: string | undefined): boolean {
  return !!kind && VISUAL_KINDS.has(kind);
}
