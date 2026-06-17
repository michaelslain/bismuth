// app/src/export/baseTable.ts
// Resolve a `type: base` md file to a flat table the SAME way the live BaseView does:
// parseBaseFile -> resolve the base's source (notes/tasks/base, defaulting to all
// notes) -> runView, which applies the base's filters, formulas, sort and column
// selection. We then flatten the resulting ViewResult to plain string cells so the
// HTML/Markdown exporters don't need the bases engine. This is why a filters-style
// base (filters: + views:, no source:) exports its real rows instead of nothing.
import { parseBaseFile } from "../../../core/src/bases/parse";
import { runView, resolveProperty } from "../../../core/src/bases/query";
import { isLink, type Link } from "../../../core/src/bases/values";
import { fileBasename } from "../../../core/src/pathUtils";
import { parseFrontmatter } from "../../../core/src/frontmatter";
import { columnLabel } from "../bases/columnLabel";
import type { ExportDeps } from "./types";
import type { Row, BaseConfig, ViewResult } from "../../../core/src/bases/types";

// A calendar base maps event `category` NAMES to colors via its frontmatter
// `categories: [{name, color}]` list (same as the live calendar). parseBaseFile drops
// these (they aren't part of BaseConfig), so the visual calendar export reads them off
// the raw frontmatter here.
export interface ExportCategory { name: string; color?: string; }

function categoriesOf(text: string): ExportCategory[] {
  const c = parseFrontmatter(text).data?.categories;
  return Array.isArray(c) ? (c as ExportCategory[]) : [];
}

export interface TableData {
  columns: string[];   // display labels (header row)
  rows: string[][];    // one string[] per data row, aligned to columns
}

// Mirror renderValue's value-to-text mapping (minus the JSX) so exported cells read
// the same as the on-screen table.
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (isLink(v)) return (v as Link).display ?? (v as Link).path;
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export function viewResultToTable(config: BaseConfig, vr: ViewResult): TableData {
  const ids = vr.columns;
  const rows = vr.groups.flatMap((g) => g.rows).map(
    (r: Row) => ids.map((id) => cellText(resolveProperty(id, r))),
  );
  return { columns: ids.map((id) => columnLabel(id, config)), rows };
}

// Read a `type: base` md file and resolve the chosen view to a ViewResult, mirroring
// BaseView: a base with an inline table renders its own rows; a query base
// (filters:/views:, no source:) defaults to all notes (kind: "notes"), which runView
// then narrows. `viewIndex` selects which of the base's views to run (default 0 = the
// first view, the historical behavior). Shared by the data (table) and visual paths.
export async function baseToViewResult(
  path: string,
  deps: ExportDeps,
  viewIndex = 0,
): Promise<{ config: BaseConfig; vr: ViewResult; categories: ExportCategory[] }> {
  const name = fileBasename(path);
  const text = await deps.read(path);
  const { config, rows } = parseBaseFile(text, { name, path });
  const spec = config.source ?? (rows.length ? { kind: "base" as const } : { kind: "notes" as const });
  const allRows = spec.kind === "base" && rows.length ? rows : await deps.resolveRows(spec);
  return { config, vr: runView(config, allRows, viewIndex), categories: categoriesOf(text) };
}

// Read a `type: base` md file and resolve it to a flat table (the "data" export mode).
export async function baseToTable(path: string, deps: ExportDeps, viewIndex = 0): Promise<TableData> {
  const { config, vr } = await baseToViewResult(path, deps, viewIndex);
  return viewResultToTable(config, vr);
}
