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
import { columnLabel } from "../bases/columnLabel";
import type { ExportDeps } from "./types";
import type { Row, BaseConfig, ViewResult } from "../../../core/src/bases/types";

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

// Read a `type: base` md file and resolve it to a flat table, mirroring BaseView:
// a base with an inline table renders its own rows; a query base (filters:/views:,
// no source:) defaults to all notes (kind: "notes"), which runView then narrows.
export async function baseToTable(path: string, deps: ExportDeps): Promise<TableData> {
  const name = path.split("/").pop()!.replace(/\.md$/, "");
  const { config, rows } = parseBaseFile(await deps.read(path), { name, path });
  const spec = config.source ?? (rows.length ? { kind: "base" as const } : { kind: "notes" as const });
  const allRows = spec.kind === "base" && rows.length ? rows : await deps.resolveRows(spec);
  return viewResultToTable(config, runView(config, allRows, 0));
}
