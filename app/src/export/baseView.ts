// app/src/export/baseView.ts
// "Visual" base export: resolve a base's chosen view and render it AS ITS KIND (calendar
// grid / cards / kanban / list). Unsupported kinds (table, map, charts, stat, heatmap,
// flashcards) degrade to the flat data table so the export never throws. Returns an HTML
// body fragment + a scoped CSS block the exporter injects into the document head.
import { baseToViewResult, viewResultToTable } from "./baseTable";
import { tableToHtml } from "./rowsHtml";
import { calendarHtml } from "./calendarHtml";
import { cardsHtml, kanbanHtml, listHtml } from "./viewHtml";
import type { ExportDeps, ExportOptions, ThemePalette } from "./types";

export interface VisualHtml { body: string; css: string; }

export async function baseViewHtml(
  path: string,
  deps: ExportDeps,
  opts: ExportOptions,
  palette: ThemePalette,
): Promise<VisualHtml> {
  const { config, vr, categories } = await baseToViewResult(path, deps, opts.viewIndex);
  switch (vr.view.type) {
    case "calendar":
      return calendarHtml(config, vr, opts, palette, categories);
    case "cards":
      return cardsHtml(config, vr, palette);
    case "kanban":
      return kanbanHtml(config, vr, palette);
    case "list":
    case "bullets":
      return listHtml(config, vr, palette);
    default:
      // table / map / bar / line / stat / heatmap / flashcards → flat table fallback.
      return { body: tableToHtml(viewResultToTable(config, vr)), css: "" };
  }
}
